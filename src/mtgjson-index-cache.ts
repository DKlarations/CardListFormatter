import { validateMtgjsonCardIndex, type MtgjsonCardIndex } from "./mtgjson-resolution-index.js";

export const MTGJSON_RESOLUTION_CACHE_NAME = "pullsmith-resolution-index-v1";
const VERSIONED_MAX_AGE_MS = 60 * 60 * 1000;
const MUTABLE_MAX_AGE_MS = 5 * 60 * 1000;
const STALE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 20_000;

export type MtgjsonIndexSource = "memory" | "persistent-cache" | "network" | "stale-fallback";
export type MtgjsonIndexLoadDiagnostics = {
  source: MtgjsonIndexSource;
  manifestMs: number;
  indexLoadMs: number;
  indexParseValidationMs: number;
  manifestRequests: number;
  indexRequests: number;
  cacheHits: number;
  failureStage?: "manifest" | "index";
};
export type MtgjsonIndexLoadResult = { index: MtgjsonCardIndex; diagnostics: MtgjsonIndexLoadDiagnostics };
type LoadOptions = { signal?: AbortSignal | null; onProgress?: (message: string) => void };
type LoaderDependencies = {
  fetch?: typeof fetch;
  now?: () => number;
  wallNow?: () => number;
  yieldToUi?: () => Promise<void>;
  cacheStorage?: CacheStorage | null;
  timeoutMs?: number;
  maxVersions?: number;
  setTimer?: (callback: () => void, milliseconds: number) => unknown;
  clearTimer?: (timer: unknown) => void;
};
type Manifest = { version: number; indexUrl: string; versioned: boolean };
type CacheEntry = { request: Request; response: Response; savedAt: number; manifestUrl: string; indexUrl: string; manifestVersion: number; indexVersion: number };

function clockNow() {
  return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
}

function browserCacheStorage() {
  try {
    return typeof window !== "undefined" && typeof caches !== "undefined" ? caches : null;
  } catch {
    return null;
  }
}

function abortError() {
  const error = new Error("Card-name index wait canceled.");
  error.name = "AbortError";
  return error;
}

function waitForShared<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener("abort", abort); reject(abortError()); };
    signal.addEventListener("abort", abort, { once: true });
    promise.then((value) => {
      signal.removeEventListener("abort", abort);
      resolve(value);
    }, (error) => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
  });
}

function safeIndexUrl(value: unknown, manifestUrl: string) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value, manifestUrl);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}

function parseManifest(value: unknown, manifestUrl: string): Manifest {
  const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const versionedUrl = safeIndexUrl(data.versionedUrl, manifestUrl);
  const indexUrl = versionedUrl || safeIndexUrl(data.indexUrl, manifestUrl);
  if (!indexUrl || (data.version !== undefined && (!Number.isInteger(data.version) || Number(data.version) < 1))) {
    throw new Error("Card-name index manifest is invalid.");
  }
  return { version: Number(data.version) || 0, indexUrl, versioned: Boolean(versionedUrl) };
}

function emptyDiagnostics(source: MtgjsonIndexSource = "network"): MtgjsonIndexLoadDiagnostics {
  return { source, manifestMs: 0, indexLoadMs: 0, indexParseValidationMs: 0, manifestRequests: 0, indexRequests: 0, cacheHits: 0 };
}

export class MtgjsonIndexLoadError extends Error {
  diagnostics: MtgjsonIndexLoadDiagnostics;

  constructor(stage: "manifest" | "index", diagnostics: MtgjsonIndexLoadDiagnostics) {
    super(stage === "manifest" ? "Card-name index manifest is unavailable." : "Card-name index is unavailable.");
    this.name = "MtgjsonIndexLoadError";
    this.diagnostics = { ...diagnostics, failureStage: stage };
  }
}

// Only public resolution-index bytes are persisted. Lists and pricing work never enter this module.
export function createMtgjsonIndexLoader(dependencies: LoaderDependencies = {}) {
  const now = dependencies.now || clockNow;
  const wallNow = dependencies.wallNow || (() => Date.now());
  const fetcher: typeof fetch = dependencies.fetch || ((input, init) => fetch(input, init));
  const maxVersions = Math.max(1, Math.min(2, dependencies.maxVersions || 2));
  const timeoutMs = Math.max(1, dependencies.timeoutMs || REQUEST_TIMEOUT_MS);
  const setTimer = dependencies.setTimer || ((callback, delay) => setTimeout(callback, delay));
  const clearTimer = dependencies.clearTimer || ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  const yieldToUi = dependencies.yieldToUi || (() => typeof window === "undefined" ? Promise.resolve() : new Promise<void>((resolve) => setTimeout(resolve, 0)));
  const memory = new Map<string, { result: MtgjsonIndexLoadResult; savedAt: number; maxAge: number }>();
  const inFlight = new Map<string, { promise: Promise<MtgjsonIndexLoadResult>; listeners: Set<(message: string) => void> }>();
  let generation = 0;

  async function openCache(): Promise<Cache | null> {
    try {
      const storage = dependencies.cacheStorage === undefined ? browserCacheStorage() : dependencies.cacheStorage;
      return storage ? await storage.open(MTGJSON_RESOLUTION_CACHE_NAME) : null;
    } catch {
      return null;
    }
  }

  async function fetchText(url: string) {
    const controller = new AbortController();
    let timer: unknown;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimer(() => {
        controller.abort();
        reject(new Error("Card-name index request timed out."));
      }, timeoutMs);
    });
    try {
      return await Promise.race([
        (async () => {
          const response = await fetcher(url, { headers: { Accept: "application/json;q=0.9,*/*;q=0.8" }, signal: controller.signal });
          if (!response.ok) throw new Error("Card-name index request failed.");
          return response.text();
        })(),
        timeout,
      ]);
    } finally {
      clearTimer(timer);
    }
  }

  async function parseIndex(text: string, diagnostics: MtgjsonIndexLoadDiagnostics) {
    await yieldToUi();
    const start = now();
    try {
      const index: unknown = JSON.parse(text);
      if (!validateMtgjsonCardIndex(index)) throw new Error("Card-name index payload is invalid.");
      return index;
    } finally {
      diagnostics.indexParseValidationMs += Math.max(0, now() - start);
      await yieldToUi();
    }
  }

  async function evict(cache: Cache, request: Request) {
    try { await cache.delete(request); } catch { /* Storage restrictions must not prevent formatting. */ }
  }

  async function cacheEntries(cache: Cache): Promise<CacheEntry[]> {
    try {
      const entries: CacheEntry[] = [];
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        if (!response) continue;
        const savedAt = Number(response.headers.get("x-pullsmith-saved-at"));
        const manifestUrl = response.headers.get("x-pullsmith-manifest-url") || "";
        const indexUrl = response.headers.get("x-pullsmith-index-url") || "";
        const manifestVersion = Number(response.headers.get("x-pullsmith-manifest-version"));
        const indexVersion = Number(response.headers.get("x-pullsmith-index-version"));
        const age = wallNow() - savedAt;
        if (!Number.isFinite(savedAt) || savedAt <= 0 || age < 0 || age > STALE_MAX_AGE_MS || !manifestUrl || !indexUrl || !Number.isInteger(manifestVersion) || !Number.isInteger(indexVersion)) {
          await evict(cache, request);
          continue;
        }
        entries.push({ request, response, savedAt, manifestUrl, indexUrl, manifestVersion, indexVersion });
      }
      entries.sort((left, right) => right.savedAt - left.savedAt);
      for (const entry of entries.slice(maxVersions)) await evict(cache, entry.request);
      return entries.slice(0, maxVersions);
    } catch {
      return [];
    }
  }

  async function readEntry(cache: Cache, entry: CacheEntry, diagnostics: MtgjsonIndexLoadDiagnostics) {
    try {
      const start = now();
      const text = await entry.response.text();
      diagnostics.indexLoadMs += Math.max(0, now() - start);
      const index = await parseIndex(text, diagnostics);
      if ((index.version || 0) !== entry.indexVersion) throw new Error("Cached index schema does not match.");
      return index;
    } catch {
      await evict(cache, entry.request);
      return null;
    }
  }

  async function persist(cache: Cache, manifestUrl: string, manifest: Manifest, text: string, index: MtgjsonCardIndex) {
    try {
      const indexVersion = index.version || 0;
      const key = `https://pullsmith-index-cache.invalid/v1/${manifest.version}/${indexVersion}/${encodeURIComponent(manifest.indexUrl)}`;
      await cache.put(key, new Response(text, { headers: {
        "content-type": "application/json",
        "x-pullsmith-saved-at": String(wallNow()),
        "x-pullsmith-manifest-url": manifestUrl,
        "x-pullsmith-index-url": manifest.indexUrl,
        "x-pullsmith-manifest-version": String(manifest.version),
        "x-pullsmith-index-version": String(indexVersion),
      } }));
      await cacheEntries(cache);
    } catch { /* Quota and private-browsing failures use the in-memory/network path. */ }
  }

  async function performLoad(manifestUrl: string, onProgress?: LoadOptions["onProgress"]): Promise<{ result: MtgjsonIndexLoadResult; savedAt: number; maxAge: number }> {
    const diagnostics = emptyDiagnostics();
    const cache = await openCache();
    const entries = cache ? (await cacheEntries(cache)).filter((entry) => entry.manifestUrl === manifestUrl) : [];
    const staleFallback = async (stage: "manifest" | "index") => {
      if (cache) {
        for (const entry of entries) {
          const index = await readEntry(cache, entry, diagnostics);
          if (index) {
            diagnostics.source = "stale-fallback";
            diagnostics.failureStage = stage;
            diagnostics.cacheHits += 1;
            onProgress?.("Using the last available card-name index from browser cache...");
            return { result: { index, diagnostics }, savedAt: entry.savedAt, maxAge: 0 };
          }
        }
      }
      const remembered = memory.get(manifestUrl);
      if (remembered && wallNow() - remembered.savedAt >= 0 && wallNow() - remembered.savedAt <= STALE_MAX_AGE_MS) {
        diagnostics.source = "stale-fallback";
        diagnostics.failureStage = stage;
        diagnostics.cacheHits += 1;
        onProgress?.("Using the last available card-name index...");
        return { result: { index: remembered.result.index, diagnostics }, savedAt: remembered.savedAt, maxAge: 0 };
      }
      throw new MtgjsonIndexLoadError(stage, diagnostics);
    };

    let manifest: Manifest;
    const manifestStart = now();
    diagnostics.manifestRequests += 1;
    try {
      manifest = parseManifest(JSON.parse(await fetchText(manifestUrl)), manifestUrl);
    } catch {
      diagnostics.manifestMs = Math.max(0, now() - manifestStart);
      return staleFallback("manifest");
    }
    diagnostics.manifestMs = Math.max(0, now() - manifestStart);
    const maxAge = manifest.versioned ? VERSIONED_MAX_AGE_MS : MUTABLE_MAX_AGE_MS;

    if (cache) {
      for (const entry of entries) {
        if (entry.indexUrl !== manifest.indexUrl || entry.manifestVersion !== manifest.version || wallNow() - entry.savedAt > maxAge) continue;
        onProgress?.("Loading card-name index from browser cache...");
        const index = await readEntry(cache, entry, diagnostics);
        if (index) {
          diagnostics.source = "persistent-cache";
          diagnostics.cacheHits += 1;
          return { result: { index, diagnostics }, savedAt: entry.savedAt, maxAge };
        }
      }
    }

    onProgress?.("Loading card-name index...");
    let text: string;
    const indexStart = now();
    diagnostics.indexRequests += 1;
    try {
      text = await fetchText(manifest.indexUrl);
    } catch {
      diagnostics.indexLoadMs += Math.max(0, now() - indexStart);
      return staleFallback("index");
    }
    diagnostics.indexLoadMs += Math.max(0, now() - indexStart);
    let index: MtgjsonCardIndex;
    try {
      index = await parseIndex(text, diagnostics);
      if (manifest.version && index.version !== manifest.version) throw new Error("Index and manifest schemas differ.");
    } catch {
      return staleFallback("index");
    }
    if (cache) await persist(cache, manifestUrl, manifest, text, index);
    return { result: { index, diagnostics }, savedAt: wallNow(), maxAge };
  }

  function load(manifestUrl: string, options: LoadOptions = {}): Promise<MtgjsonIndexLoadResult> {
    if (options.signal?.aborted) return Promise.reject(abortError());
    const remembered = memory.get(manifestUrl);
    if (remembered && remembered.maxAge > 0 && wallNow() - remembered.savedAt >= 0 && wallNow() - remembered.savedAt <= remembered.maxAge) {
      return Promise.resolve({ index: remembered.result.index, diagnostics: { ...emptyDiagnostics("memory"), cacheHits: 1 } });
    }
    let flight = inFlight.get(manifestUrl);
    if (!flight) {
      const loadGeneration = generation;
      const listeners = new Set<(message: string) => void>();
      const shared = performLoad(manifestUrl, (message) => {
        if (generation !== loadGeneration) return;
        for (const listener of listeners) {
          try { listener(message); } catch { /* UI callbacks cannot fail the shared index load. */ }
        }
      }).then(({ result, savedAt, maxAge }) => {
        if (generation === loadGeneration) {
          memory.delete(manifestUrl);
          memory.set(manifestUrl, { result, savedAt, maxAge });
          while (memory.size > maxVersions) memory.delete(memory.keys().next().value);
        }
        return result;
      }).finally(() => {
        if (inFlight.get(manifestUrl)?.promise === shared) inFlight.delete(manifestUrl);
      });
      flight = { promise: shared, listeners };
      inFlight.set(manifestUrl, flight);
    }
    const listener = (message: string) => { if (!options.signal?.aborted) options.onProgress?.(message); };
    flight.listeners.add(listener);
    return waitForShared(flight.promise, options.signal)
      .then((result) => ({ index: result.index, diagnostics: { ...result.diagnostics } }))
      .finally(() => flight.listeners.delete(listener));
  }

  return {
    load,
    // Optional prefetch failures remain silent, and rejected requests are removed before the next attempt.
    prefetch: (manifestUrl: string) => load(manifestUrl).then(() => undefined, () => undefined),
    clearMemory() { generation += 1; memory.clear(); inFlight.clear(); },
  };
}

const sharedResolutionIndexLoader = createMtgjsonIndexLoader();
export const loadMtgjsonResolutionIndex = sharedResolutionIndexLoader.load;
export const prefetchMtgjsonResolutionIndex = sharedResolutionIndexLoader.prefetch;
export const clearMtgjsonResolutionIndexMemory = sharedResolutionIndexLoader.clearMemory;

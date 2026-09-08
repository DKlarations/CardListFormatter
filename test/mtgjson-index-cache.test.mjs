import assert from "node:assert/strict";
import test from "node:test";
import { importBundledModule } from "./test-module-bundle.mjs";

const { createMtgjsonIndexLoader, MTGJSON_RESOLUTION_CACHE_NAME } = await importBundledModule("src/mtgjson-index-cache.ts", "mtgjson-index-cache");
const { hasSufficientLocalPaperEvidence, resolutionIndexReadiness } = await importBundledModule("src/mtgjson-resolution-index.ts", "cache-resolution-readiness");
const manifestUrl = "https://formatter.test/manifest";
const indexUrl = "https://index.test/card-index-2026-09-07.json";
const latestUrl = "https://index.test/card-index-latest.json";
const fixture = () => ({
  version: 3,
  rarityHistoryComplete: true,
  cards: { "test card": { name: "Test Card", rarities: ["rare"], hasPlayablePaperPrinting: true, paperRarities: ["rare"] } },
  aliases: { "test card": "test card" },
});
const jsonResponse = (value) => new Response(JSON.stringify(value));
const manifest = (overrides = {}) => ({ version: 3, versionedUrl: indexUrl, indexUrl: latestUrl, ...overrides });
const flush = async () => { for (let i = 0; i < 16; i += 1) await Promise.resolve(); };
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fakeStorage() {
  const entries = new Map();
  const deleted = [];
  const key = (request) => typeof request === "string" ? request : request.url;
  const cache = {
    keys: async () => [...entries.keys()].map((url) => new Request(url)),
    match: async (request) => entries.get(key(request))?.clone(),
    put: async (request, response) => { entries.set(key(request), response.clone()); },
    delete: async (request) => { deleted.push(key(request)); return entries.delete(key(request)); },
  };
  return { entries, deleted, cache, open: async (name) => {
    assert.equal(name, MTGJSON_RESOLUTION_CACHE_NAME);
    return cache;
  } };
}

function environment(overrides = {}) {
  let timestamp = 1_800_000_000_000;
  let elapsed = 0;
  const requests = [];
  const storage = fakeStorage();
  const dependencies = {
    cacheStorage: storage,
    now: () => elapsed,
    wallNow: () => timestamp,
    yieldToUi: async () => {},
    fetch: async (url) => {
      requests.push(String(url));
      elapsed += String(url) === manifestUrl ? 20 : 80;
      return jsonResponse(String(url) === manifestUrl ? manifest() : fixture());
    },
    ...overrides,
  };
  return {
    dependencies, requests, storage,
    advance: (milliseconds) => { timestamp += milliseconds; },
    loader: () => createMtgjsonIndexLoader(dependencies),
  };
}

test("network load prefers the versioned URL and reports deterministic provider durations", async () => {
  const env = environment();
  const loader = env.loader();
  const first = await loader.load(manifestUrl);
  assert.deepEqual(env.requests, [manifestUrl, indexUrl]);
  assert.equal(first.diagnostics.source, "network");
  assert.equal(first.diagnostics.manifestMs, 20);
  assert.equal(first.diagnostics.indexLoadMs, 80);
  assert.equal(first.diagnostics.manifestRequests, 1);
  assert.equal(first.diagnostics.indexRequests, 1);
  const second = await loader.load(manifestUrl);
  assert.equal(second.index, first.index);
  assert.deepEqual(second.diagnostics, { source: "memory", manifestMs: 0, indexLoadMs: 0, indexParseValidationMs: 0, manifestRequests: 0, indexRequests: 0, cacheHits: 1 });
  assert.equal(env.requests.length, 2);
  assert.equal(JSON.stringify(first.diagnostics).includes("https:"), false);
});

test("a new page loader validates the persistent versioned bytes without another index request", async () => {
  const env = environment();
  await env.loader().load(manifestUrl);
  env.requests.length = 0;
  const result = await env.loader().load(manifestUrl);
  assert.deepEqual(env.requests, [manifestUrl]);
  assert.equal(result.diagnostics.source, "persistent-cache");
  assert.equal(result.diagnostics.indexRequests, 0);
  assert.equal(result.diagnostics.cacheHits, 1);
  assert.deepEqual(result.index, fixture());
  const keys = [...env.storage.entries.keys()];
  assert.equal(keys.length, 1);
  assert.ok(keys[0].includes("/3/3/"));
  assert.ok(keys[0].endsWith(encodeURIComponent(indexUrl)));
});

test("an active prefetch is shared and canceling one waiter preserves the download", async () => {
  const pending = deferred();
  let requests = 0;
  let sharedSignal;
  const env = environment({ fetch: async (url, options) => {
    requests += 1;
    if (String(url) === manifestUrl) { sharedSignal = options.signal; await pending.promise; return jsonResponse(manifest()); }
    return jsonResponse(fixture());
  } });
  const loader = env.loader();
  const prefetch = loader.prefetch(manifestUrl);
  const controller = new AbortController();
  const canceled = loader.load(manifestUrl, { signal: controller.signal });
  const progress = [];
  const continuing = loader.load(manifestUrl, { onProgress: (message) => progress.push(message) });
  controller.abort();
  await assert.rejects(canceled, { name: "AbortError" });
  pending.resolve();
  await prefetch;
  assert.equal((await continuing).diagnostics.source, "network");
  assert.equal(sharedSignal.aborted, false);
  assert.equal(requests, 2);
  assert.ok(progress.includes("Loading card-name index..."));
  assert.equal((await loader.load(manifestUrl)).diagnostics.source, "memory");
});

test("concurrent consumers share a failed prefetch and a later processing attempt retries", async () => {
  const pending = deferred();
  let requests = 0;
  let failing = true;
  const env = environment({ cacheStorage: null, fetch: async (url) => {
    requests += 1;
    if (failing) { await pending.promise; throw new Error("Provider failed at https://secret.test/?token=secret"); }
    return jsonResponse(String(url) === manifestUrl ? manifest() : fixture());
  } });
  const loader = env.loader();
  const prefetch = loader.prefetch(manifestUrl);
  const processing = loader.load(manifestUrl);
  pending.resolve();
  await prefetch;
  await assert.rejects(processing, (error) => {
    assert.equal(error.diagnostics.failureStage, "manifest");
    assert.equal(error.message.includes("secret"), false);
    return true;
  });
  assert.equal(requests, 1);
  failing = false;
  assert.equal((await loader.load(manifestUrl)).diagnostics.source, "network");
  assert.equal(requests, 3);
});

test("corrupt persistent bytes are evicted and replaced by validated network data", async () => {
  const env = environment();
  await env.loader().load(manifestUrl);
  const [key, cached] = [...env.storage.entries.entries()][0];
  env.storage.entries.set(key, new Response("{broken", { headers: cached.headers }));
  env.requests.length = 0;
  const result = await env.loader().load(manifestUrl);
  assert.equal(result.diagnostics.source, "network");
  assert.deepEqual(env.requests, [manifestUrl, indexUrl]);
  assert.deepEqual(env.storage.deleted, [key]);
  assert.deepEqual(await env.storage.entries.get(key).clone().json(), fixture());
});

test("structurally corrupt cached evidence is evicted even when its JSON parses", async () => {
  const env = environment();
  await env.loader().load(manifestUrl);
  const [key, cached] = [...env.storage.entries.entries()][0];
  // Preserve the cache metadata so this exercises payload validation, not header cleanup.
  env.storage.entries.set(key, new Response(JSON.stringify({ version: 3, rarityHistoryComplete: "true", cards: fixture().cards }), { headers: cached.headers }));
  assert.equal((await env.loader().load(manifestUrl)).diagnostics.source, "network");
  assert.ok(env.storage.deleted.includes(key));
});

test("manifest outage uses a validated last-known-good index and expires it after seven days", async () => {
  const env = environment();
  await env.loader().load(manifestUrl);
  env.advance(2 * 60 * 60 * 1000);
  env.dependencies.fetch = async () => { throw new Error("offline"); };
  const result = await env.loader().load(manifestUrl);
  assert.equal(result.diagnostics.source, "stale-fallback");
  assert.equal(result.diagnostics.failureStage, "manifest");
  assert.equal(result.diagnostics.indexRequests, 0);
  assert.deepEqual(result.index, fixture());
  env.advance(7 * 24 * 60 * 60 * 1000);
  await assert.rejects(env.loader().load(manifestUrl), { name: "MtgjsonIndexLoadError" });
  assert.equal(env.storage.entries.size, 0);
});

test("index outage can use last-known-good data and a failed index without fallback is retryable", async () => {
  const env = environment();
  await env.loader().load(manifestUrl);
  env.advance(2 * 60 * 60 * 1000);
  env.dependencies.fetch = async (url) => String(url) === manifestUrl ? jsonResponse(manifest()) : new Response("offline", { status: 503 });
  assert.equal((await env.loader().load(manifestUrl)).diagnostics.source, "stale-fallback");
  const loader = createMtgjsonIndexLoader({ ...env.dependencies, cacheStorage: null });
  await assert.rejects(loader.load(manifestUrl), (error) => error.diagnostics.failureStage === "index");
  env.dependencies.fetch = async (url) => jsonResponse(String(url) === manifestUrl ? manifest() : fixture());
  assert.equal((await env.loader().load(manifestUrl)).diagnostics.source, "network");
});

test("same-day versioned URLs refresh after one hour and mutable fallback URLs after five minutes", async () => {
  for (const versioned of [true, false]) {
    const env = environment();
    env.dependencies.fetch = async (url) => {
      env.requests.push(String(url));
      return jsonResponse(String(url) === manifestUrl ? manifest({ versionedUrl: versioned ? indexUrl : "javascript:bad" }) : fixture());
    };
    const loader = env.loader();
    await loader.load(manifestUrl);
    assert.equal(env.requests[1], versioned ? indexUrl : latestUrl);
    env.advance((versioned ? 60 : 5) * 60 * 1000 + 1);
    await loader.load(manifestUrl);
    assert.equal(env.requests.length, 4);
  }
});

test("persistent storage retains at most two versions and keeps the newest valid fallback", async () => {
  const env = environment();
  for (let version = 1; version <= 3; version += 1) {
    env.advance(1000);
    env.dependencies.fetch = async (url) => jsonResponse(String(url) === manifestUrl ? manifest({ versionedUrl: `https://index.test/version-${version}.json` }) : fixture());
    await env.loader().load(manifestUrl);
  }
  assert.equal(env.storage.entries.size, 2);
  assert.equal([...env.storage.entries.keys()].some((key) => key.includes("version-1")), false);
  env.dependencies.fetch = async () => { throw new Error("offline"); };
  assert.equal((await env.loader().load(manifestUrl)).diagnostics.source, "stale-fallback");
});

test("CacheStorage rejection and quota errors preserve normal network processing", async () => {
  const unavailable = environment({ cacheStorage: { open: async () => { throw new Error("Storage denied"); } } });
  assert.equal((await unavailable.loader().load(manifestUrl)).diagnostics.source, "network");
  const quota = environment();
  quota.storage.cache.put = async () => { throw new Error("Quota exceeded"); };
  const loader = quota.loader();
  assert.equal((await loader.load(manifestUrl)).diagnostics.source, "network");
  assert.equal((await loader.load(manifestUrl)).diagnostics.source, "memory");
});

test("manifest and index response-body timeouts abort shared requests and clear rejected entries", async () => {
  for (const stage of ["manifest", "index"]) {
    let timeoutCallback;
    let hanging = true;
    let requestSignal;
    const loader = createMtgjsonIndexLoader({
      cacheStorage: null, yieldToUi: async () => {},
      setTimer: (callback) => { timeoutCallback = callback; return callback; },
      clearTimer: (timer) => { if (timeoutCallback === timer) timeoutCallback = undefined; },
      fetch: async (url, options) => {
        if (hanging && (stage === "manifest" || String(url) !== manifestUrl)) {
          requestSignal = options.signal;
          return { ok: true, text: () => new Promise(() => {}) };
        }
        return jsonResponse(String(url) === manifestUrl ? manifest() : fixture());
      },
    });
    const timedOut = loader.load(manifestUrl);
    await flush();
    assert.equal(typeof timeoutCallback, "function");
    timeoutCallback();
    await assert.rejects(timedOut, (error) => error.diagnostics.failureStage === stage);
    assert.equal(requestSignal.aborted, true);
    hanging = false;
    assert.equal((await loader.load(manifestUrl)).diagnostics.source, "network");
  }
});

test("canceling a run suppresses its late progress without poisoning later processing", async () => {
  const pending = deferred();
  const progress = [];
  const env = environment({ fetch: async (url) => {
    if (String(url) === manifestUrl) await pending.promise;
    return jsonResponse(String(url) === manifestUrl ? manifest() : fixture());
  } });
  const loader = env.loader();
  const controller = new AbortController();
  const first = loader.load(manifestUrl, { signal: controller.signal, onProgress: (message) => progress.push(message) });
  controller.abort();
  await assert.rejects(first, { name: "AbortError" });
  const second = loader.load(manifestUrl);
  pending.resolve();
  await second;
  assert.deepEqual(progress, []);
});

test("mismatched manifest/index schemas remain canonical compatibility evidence through every cache path", async () => {
  for (const payload of [{ ...fixture(), version: 2 }, { ...fixture(), version: 99 }, fixture()]) {
    const manifestVersion = payload.version === 3 ? 2 : 3;
    let offline = false;
    const env = environment({ fetch: async (url) => { if (offline) throw new Error("Offline"); return jsonResponse(String(url) === manifestUrl ? manifest({ version: manifestVersion }) : payload); } });
    const loader = env.loader();
    const network = await loader.load(manifestUrl);
    const memory = await loader.load(manifestUrl);
    const persisted = await env.loader().load(manifestUrl);
    offline = true;
    const stale = await env.loader().load(manifestUrl);
    for (const result of [network, memory, persisted, stale]) {
      assert.equal(result.index.cards["test card"].name, "Test Card");
      assert.equal(result.index.manifestSchemaMismatch, true);
      assert.equal(result.index.manifestSchemaVersion, manifestVersion);
      assert.equal(hasSufficientLocalPaperEvidence(result.index.cards["test card"], result.index), false);
      assert.equal(resolutionIndexReadiness(result.index).compatibilityMode, true);
    }
    assert.equal(network.diagnostics.source, "network");
    assert.equal(memory.diagnostics.source, "memory");
    assert.equal(persisted.diagnostics.source, "persistent-cache");
    assert.equal(stale.diagnostics.source, "stale-fallback");
    assert.equal(env.storage.entries.size, 1);
  }
});

test("explicit incomplete manifest metadata never grants complete-index trust through caches or fallback", async () => {
  for (const metadata of [{ rarityHistoryComplete: false }, { failedSetCount: 1 }]) {
    let offline = false;
    const env = environment({ fetch: async (url) => { if (offline) throw new Error("Offline"); return jsonResponse(String(url) === manifestUrl ? manifest(metadata) : fixture()); } });
    const loader = env.loader();
    for (const result of [await loader.load(manifestUrl), await loader.load(manifestUrl), await env.loader().load(manifestUrl)]) {
      assert.equal(result.index.requiresCompatibilityVerification, true);
      assert.equal(hasSufficientLocalPaperEvidence(result.index.cards["test card"], result.index), false);
    }
    offline = true;
    const stale = await env.loader().load(manifestUrl);
    assert.equal(stale.diagnostics.source, "stale-fallback");
    assert.equal(stale.index.requiresCompatibilityVerification, true);
  }
});

test("legacy schema indexes load conservatively and remain cacheable during rollout", async () => {
  const legacy = { version: 2, cards: { old: { name: "Old Card", nonSecretRarities: ["rare"] } }, aliases: { old: "old" } };
  const env = environment({ fetch: async (url) => jsonResponse(String(url) === manifestUrl ? manifest({ version: 2 }) : legacy) });
  assert.deepEqual((await env.loader().load(manifestUrl)).index, legacy);
  assert.equal((await env.loader().load(manifestUrl)).diagnostics.source, "persistent-cache");
});

// src/printing-normalization.ts
function treatmentsForRawPrinting(print) {
  const frameEffectValues = [
    ...Array.isArray(print.frameEffects) ? print.frameEffects : [],
    ...Array.isArray(print.frame_effects) ? print.frame_effects : []
  ];
  const promoTypeValues = [
    ...Array.isArray(print.promoTypes) ? print.promoTypes : [],
    ...Array.isArray(print.promo_types) ? print.promo_types : []
  ];
  const normalizeValues = (values) => new Set(
    values.map((value) => String(value).toLowerCase().replace(/[^a-z]/g, ""))
  );
  const frameEffects = normalizeValues(frameEffectValues);
  const promoTypes = normalizeValues(promoTypeValues);
  const effects = /* @__PURE__ */ new Set([...frameEffects, ...promoTypes]);
  const frameVersion = String(print.frameVersion ?? print.frame_version ?? print.frame ?? "").trim();
  const borderless = String(print.borderColor ?? print.border_color ?? "").toLowerCase() === "borderless" || effects.has("borderless");
  const explicitlyRetro = effects.has("retroframe") || effects.has("oldframe") || effects.has("oldborder") || effects.has("retro");
  if (explicitlyRetro || frameVersion === "1997" && promoTypes.has("boosterfun")) return ["retro"];
  if (effects.has("extendedart")) return ["extended-art"];
  if (effects.has("showcase")) return ["showcase"];
  if (borderless) return ["borderless"];
  if (print.isFullArt || print.full_art || effects.has("fullart")) return ["full-art"];
  return ["standard"];
}

// src/customer.ts
var EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
var PHONE_PATTERN = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/;
function cleanText(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}
function normalizePhoneForSearch(value) {
  const digits = cleanText(value).replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}
function formatCustomerPhone(value) {
  const raw = cleanText(value);
  const digits = normalizePhoneForSearch(raw);
  if (digits.length !== 10) return raw;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}
function normalizeEmailForSearch(value) {
  return cleanText(value).toLowerCase();
}
function customerFromLegacyContact(contactValue) {
  const contact = cleanText(contactValue);
  if (!contact) return {};
  const phoneMatch = contact.match(PHONE_PATTERN)?.[0] || "";
  const emailMatch = contact.match(EMAIL_PATTERN)?.[0] || "";
  const remainder = cleanText(contact.replace(phoneMatch, " ").replace(emailMatch, " ").replace(/^\s*[\/|,;]+|[\/|,;]+\s*$/g, " ").replace(/\s*[\/|,;]+\s*/g, " "));
  return {
    ...phoneMatch ? { phone: formatCustomerPhone(phoneMatch) } : {},
    ...emailMatch ? { email: normalizeEmailForSearch(emailMatch) } : {},
    ...remainder ? { legacyContact: remainder } : {}
  };
}
function normalizeCustomer(value) {
  const raw = value && typeof value === "object" ? value : {};
  const legacy = customerFromLegacyContact(raw.contact);
  const phone = cleanText(raw.phone) || legacy.phone || "";
  const email = cleanText(raw.email) || legacy.email || "";
  const explicitLegacy = cleanText(raw.legacyContact);
  return {
    name: cleanText(raw.name),
    phone: formatCustomerPhone(phone),
    email: normalizeEmailForSearch(email),
    ...explicitLegacy || legacy.legacyContact ? { legacyContact: explicitLegacy || legacy.legacyContact } : {}
  };
}
function customerContactText(customerValue) {
  const customer = normalizeCustomer(customerValue);
  return Array.from(new Set([
    customer.phone,
    customer.email,
    customer.legacyContact
  ].filter(Boolean))).join(" / ");
}

// src/generated-sample.ts
var GENERATED_SAMPLE_CUSTOMER_NAMES = [
  "Mark Rosewater",
  "Bill Rose",
  "Skaff Elias",
  "Beth Moursund",
  "Tom Wylie",
  "Aaron Forsythe",
  "Erik Lauer",
  "Devin Low",
  "Mark Gottlieb",
  "Tom LaPille",
  "Dave Humpherys",
  "Sam Stoddard",
  "Gavin Verhey",
  "Ken Nagle",
  "Ethan Fleischer",
  "Melissa DeTora",
  "Jeremy Jarvis",
  "Carmen Klomparens",
  "Matt Cavotta"
];
function sampleCustomerNameKey(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").toLocaleLowerCase() : "";
}
var GENERATED_SAMPLE_CUSTOMER_NAME_KEYS = new Set(
  GENERATED_SAMPLE_CUSTOMER_NAMES.map(sampleCustomerNameKey)
);

// src/structured-export.ts
var EXPORT_LINE = /^(.+)\s+\(([A-Z0-9]{2,8})\)\s+([\p{L}\p{N}★☆*†‡∞][\p{L}\p{N}./★☆*†‡∞+\-]*)(?:\s+(\*F\*))?\s*$/iu;
function parseStructuredExportLine(value, quantityRemoved = false) {
  const line = quantityRemoved ? value.trim() : value.trim().replace(/^(?:\d+)\s*x?\s+/i, "");
  const match = line.match(EXPORT_LINE);
  if (!match || /^\*F\*$/i.test(match[3])) return null;
  return {
    name: match[1].trim(),
    setCode: match[2].toUpperCase(),
    collectorNumber: match[3],
    ...match[4] ? { finish: "foil", foilTreatment: "standard" } : {},
    sourceFormat: "set-collector-export"
  };
}
function detectStructuredExportSuffix(value) {
  return /\([A-Z0-9]{2,8}\)\s+[\p{L}\p{N}★☆*†‡∞][\p{L}\p{N}./★☆*†‡∞+\-]*(?:\s+[^\r\n]*)?\s*$/iu.test(value);
}
var CP1252_EXTRA = new Map(Array.from("\u20AC\x81\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\x8D\u017D\x8F\x90\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\x9D\u017E\u0178", (character, index) => [character, 128 + index]));
function byteFor(character) {
  const point = character.codePointAt(0);
  return point <= 255 ? point : CP1252_EXTRA.get(character);
}
function mojibakeScore(value) {
  const characters = Array.from(value);
  return characters.reduce((count, character, index) => {
    const next = characters[index + 1] && byteFor(characters[index + 1]);
    return count + (/[ÃÂâð]/u.test(character) && next >= 128 && next <= 191 ? 1 : 0);
  }, 0);
}
function repairMojibake(value) {
  let result = value;
  for (let pass = 0; pass < 3 && mojibakeScore(result); pass += 1) {
    const characters = Array.from(result);
    let repaired = "";
    for (let index = 0; index < characters.length; index += 1) {
      const first = characters[index];
      const lead = byteFor(first);
      const length = /[ÃÂâð]/u.test(first) ? lead >= 240 ? 4 : lead >= 224 ? 3 : 2 : 0;
      const bytes = characters.slice(index, index + length).map(byteFor);
      if (length && bytes.length === length && bytes.every((byte) => byte !== void 0)) {
        try {
          const decoded = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
          const roundTrip = new TextEncoder().encode(decoded);
          if (!/[\u0000-\u001f\u007f-\u009f\ufffd]/u.test(decoded) && roundTrip.length === bytes.length && roundTrip.every((byte, position) => byte === bytes[position])) {
            repaired += decoded;
            index += length - 1;
            continue;
          }
        } catch {
        }
      }
      repaired += first;
    }
    if (mojibakeScore(repaired) >= mojibakeScore(result)) break;
    result = repaired;
  }
  return result;
}

// src/mtgjson-resolution-index.ts
var MTGJSON_RESOLUTION_INDEX_VERSION = 3;
var RARITIES = /* @__PURE__ */ new Set(["common", "uncommon", "rare", "mythic"]);
var STRING_FIELDS = ["asciiName", "layout", "scryfallOracleId", "type"];
var ARRAY_FIELDS = ["colorIdentity", "printings", "subtypes", "supertypes", "rarities", "nonSecretRarities", "types"];
function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function stringArray(value) {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}
function validateMtgjsonCardIndex(value) {
  if (!isRecord(value) || !isRecord(value.cards)) return false;
  if (value.version !== void 0 && (!Number.isInteger(value.version) || value.version < 1)) return false;
  if (value.generatedAt !== void 0 && typeof value.generatedAt !== "string") return false;
  const currentSchema = value.version === MTGJSON_RESOLUTION_INDEX_VERSION;
  if (currentSchema && value.rarityHistoryComplete !== void 0 && typeof value.rarityHistoryComplete !== "boolean") return false;
  for (const [key, card] of Object.entries(value.cards)) {
    if (!key || !isRecord(card) || typeof card.name !== "string" || !card.name.trim()) return false;
    if (STRING_FIELDS.some((field) => card[field] !== void 0 && typeof card[field] !== "string")) return false;
    if (ARRAY_FIELDS.some((field) => card[field] !== void 0 && !stringArray(card[field]))) return false;
    if (Number(value.version) >= MTGJSON_RESOLUTION_INDEX_VERSION) {
      if (card.hasPlayablePaperPrinting !== void 0 && typeof card.hasPlayablePaperPrinting !== "boolean") return false;
      if (card.paperRarities !== void 0 && (!stringArray(card.paperRarities) || card.paperRarities.some((rarity) => !RARITIES.has(rarity)))) return false;
      if (card.hasPlayablePaperPrinting === false && card.paperRarities?.length) return false;
    }
  }
  if (value.aliases !== void 0) {
    if (!isRecord(value.aliases)) return false;
    for (const target of Object.values(value.aliases)) {
      if (typeof target !== "string" || !Object.hasOwn(value.cards, target)) return false;
    }
  }
  if (value.ambiguousAliases !== void 0) {
    if (!isRecord(value.ambiguousAliases)) return false;
    for (const [alias, targets] of Object.entries(value.ambiguousAliases)) {
      if (!stringArray(targets) || new Set(targets).size < 2 || targets.some((key) => !Object.hasOwn(value.cards, key))) return false;
      if (value.aliases && Object.hasOwn(value.aliases, alias)) return false;
    }
  }
  return true;
}
function hasSufficientLocalPaperEvidence(card, index) {
  return index.version === MTGJSON_RESOLUTION_INDEX_VERSION && index.requiresCompatibilityVerification !== true && !(index.failedSetCount > 0 || index.source?.mtgjsonMeta?.failedSetCount > 0) && index.rarityHistoryComplete === true && card.hasPlayablePaperPrinting === true && Array.isArray(card.paperRarities) && card.paperRarities.length > 0 && card.paperRarities.every((rarity) => RARITIES.has(rarity));
}
function resolutionIndexReadiness(value) {
  const data = isRecord(value) ? value : {};
  const schemaVersion = Number.isInteger(data.version) && data.version > 0 ? data.version : null;
  const rarityHistoryComplete = typeof data.rarityHistoryComplete === "boolean" ? data.rarityHistoryComplete : null;
  const rawFailedSets = data.failedSetCount ?? data.source?.mtgjsonMeta?.failedSetCount;
  const failedSetCount = Number.isInteger(rawFailedSets) && rawFailedSets >= 0 ? rawFailedSets : null;
  const timestamp = typeof data.generatedAt === "string" && /^\d{4}-\d{2}-\d{2}T/.test(data.generatedAt) ? Date.parse(data.generatedAt) : NaN;
  const generatedAt = Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  const manifestSchemaVersion = Number.isInteger(data.manifestSchemaVersion) && data.manifestSchemaVersion > 0 ? data.manifestSchemaVersion : null;
  const schemaMismatch = data.manifestSchemaMismatch === true;
  return {
    schemaVersion,
    expectedSchemaVersion: MTGJSON_RESOLUTION_INDEX_VERSION,
    rarityHistoryComplete,
    generatedAt,
    failedSetCount,
    manifestSchemaVersion,
    schemaMismatch,
    compatibilityMode: data.requiresCompatibilityVerification === true || schemaMismatch || schemaVersion !== MTGJSON_RESOLUTION_INDEX_VERSION || rarityHistoryComplete !== true || failedSetCount !== null && failedSetCount > 0
  };
}

// src/processing-performance.ts
function processingNow() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}
function createProcessingPerformance() {
  return {
    startedAt: processingNow(),
    totalMs: 0,
    stages: { parse: 0, manifest: 0, indexLoad: 0, indexParseValidation: 0, mtgjsonLookup: 0, scryfallExactBatch: 0, scryfallFuzzy: 0, printHistory: 0 },
    counts: { manifestRequests: 0, indexRequests: 0, indexCacheHits: 0, mtgjsonMatches: 0, mtgjsonMisses: 0, ambiguousMatches: 0, scryfallCollection: 0, scryfallExact: 0, scryfallFuzzy: 0, scryfallSearch: 0, scryfallPrintPages: 0, scryfallSets: 0, scryfallCacheHits: 0, retries: 0, remoteCards: 0, skippedCards: 0, logicalRemoteCards: 0, printHistoryCardsStarted: 0, printHistoryCardsCompleted: 0, printHistoryCardsFailed: 0, printHistoryCardsSkippedAfterCircuit: 0, requestRetries: 0, logicalCardRetries: 0, malformedRecordsDropped: 0, structuredExportRowsDetected: 0, structuredExportRowsParsed: 0, importedPrintingHints: 0, mojibakeCorrections: 0, fuzzyLookupsPrevented: 0 },
    resolutionIndexSchemaVersion: null,
    resolutionIndexManifestSchemaVersion: null,
    resolutionIndexSchemaMismatch: false,
    rarityHistoryComplete: null,
    resolutionIndexGeneratedAt: null,
    resolutionIndexFailedSetCount: null,
    legacyIndexCompatibilityMode: false,
    providerCircuitState: "closed",
    providerCircuitReason: null,
    providerBudgetMs: 0,
    providerElapsedMs: 0,
    providerAttemptBudget: 0,
    providerAttemptsUsed: 0,
    failuresByKind: {},
    failuresByHttpStatus: {},
    rateLimitRetryAfter: null,
    malformedRecordsDropped: 0,
    exactMissRatio: null,
    bulkMissGuardTriggered: false,
    reasons: {},
    indexSource: "unused",
    stage: "parse",
    outcome: "running"
  };
}
function recordParsingPerformance(report, diagnostics) {
  if (!report) return;
  for (const key of ["structuredExportRowsDetected", "structuredExportRowsParsed", "importedPrintingHints", "mojibakeCorrections"]) {
    const count = diagnostics?.[key];
    report.counts[key] = Number.isInteger(count) && count >= 0 ? count : 0;
  }
}
function recordResolutionIndexReadiness(report, index) {
  if (!report) return;
  const readiness = resolutionIndexReadiness(index);
  report.resolutionIndexSchemaVersion = readiness.schemaVersion;
  report.resolutionIndexManifestSchemaVersion = readiness.manifestSchemaVersion;
  report.resolutionIndexSchemaMismatch = readiness.schemaMismatch;
  report.rarityHistoryComplete = readiness.rarityHistoryComplete;
  report.resolutionIndexGeneratedAt = readiness.generatedAt;
  report.resolutionIndexFailedSetCount = readiness.failedSetCount;
  report.legacyIndexCompatibilityMode = readiness.compatibilityMode;
}
function snapshotProcessingPerformance(report) {
  return { ...report, stages: { ...report.stages }, counts: { ...report.counts }, reasons: { ...report.reasons }, failuresByKind: { ...report.failuresByKind }, failuresByHttpStatus: { ...report.failuresByHttpStatus } };
}
function countPerformance(report, name, amount = 1) {
  if (report) report.counts[name] = (report.counts[name] || 0) + amount;
}
function finishProcessingPerformance(report, outcome = "complete") {
  report.totalMs = processingNow() - report.startedAt;
  report.outcome = outcome;
  return snapshotProcessingPerformance(report);
}
var BULK_MISS_GUARD_MESSAGE = "Most card names failed exact matching. The pasted list may use an unsupported export format. Automatic provider lookups were stopped.";

// src/mtgjson-index-cache.ts
var MTGJSON_RESOLUTION_CACHE_NAME = "pullsmith-resolution-index-v1";
var VERSIONED_MAX_AGE_MS = 60 * 60 * 1e3;
var MUTABLE_MAX_AGE_MS = 5 * 60 * 1e3;
var STALE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1e3;
var REQUEST_TIMEOUT_MS = 2e4;
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
function waitForShared(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(abortError());
    };
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
function safeIndexUrl(value, manifestUrl) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value, manifestUrl);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : "";
  } catch {
    return "";
  }
}
function parseManifest(value, manifestUrl) {
  const data = value && typeof value === "object" ? value : {};
  const versionedUrl = safeIndexUrl(data.versionedUrl, manifestUrl);
  const indexUrl = versionedUrl || safeIndexUrl(data.indexUrl, manifestUrl);
  if (!indexUrl || data.version !== void 0 && (!Number.isInteger(data.version) || Number(data.version) < 1)) {
    throw new Error("Card-name index manifest is invalid.");
  }
  return {
    version: Number(data.version) || 0,
    indexUrl,
    versioned: Boolean(versionedUrl),
    rarityHistoryComplete: typeof data.rarityHistoryComplete === "boolean" ? data.rarityHistoryComplete : void 0,
    failedSetCount: Number.isInteger(data.failedSetCount) && Number(data.failedSetCount) >= 0 ? Number(data.failedSetCount) : void 0
  };
}
function applyManifestReadiness(index, manifest) {
  const mismatch = Boolean(manifest.version && manifest.version !== index.version);
  if (!mismatch && manifest.rarityHistoryComplete !== false && !(manifest.failedSetCount > 0)) return index;
  return { ...index, requiresCompatibilityVerification: true, manifestSchemaVersion: manifest.version || void 0, manifestSchemaMismatch: mismatch };
}
function emptyDiagnostics(source = "network") {
  return { source, manifestMs: 0, indexLoadMs: 0, indexParseValidationMs: 0, manifestRequests: 0, indexRequests: 0, cacheHits: 0 };
}
var MtgjsonIndexLoadError = class extends Error {
  diagnostics;
  constructor(stage, diagnostics) {
    super(stage === "manifest" ? "Card-name index manifest is unavailable." : "Card-name index is unavailable.");
    this.name = "MtgjsonIndexLoadError";
    this.diagnostics = { ...diagnostics, failureStage: stage };
  }
};
function createMtgjsonIndexLoader(dependencies = {}) {
  const now = dependencies.now || clockNow;
  const wallNow = dependencies.wallNow || (() => Date.now());
  const fetcher = dependencies.fetch || ((input, init) => fetch(input, init));
  const maxVersions = Math.max(1, Math.min(2, dependencies.maxVersions || 2));
  const timeoutMs = Math.max(1, dependencies.timeoutMs || REQUEST_TIMEOUT_MS);
  const setTimer = dependencies.setTimer || ((callback, delay) => setTimeout(callback, delay));
  const clearTimer = dependencies.clearTimer || ((timer) => clearTimeout(timer));
  const yieldToUi = dependencies.yieldToUi || (() => typeof window === "undefined" ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, 0)));
  const memory = /* @__PURE__ */ new Map();
  const inFlight = /* @__PURE__ */ new Map();
  let generation = 0;
  async function openCache() {
    try {
      const storage = dependencies.cacheStorage === void 0 ? browserCacheStorage() : dependencies.cacheStorage;
      return storage ? await storage.open(MTGJSON_RESOLUTION_CACHE_NAME) : null;
    } catch {
      return null;
    }
  }
  async function fetchText(url) {
    const controller = new AbortController();
    let timer;
    const timeout = new Promise((_, reject) => {
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
        timeout
      ]);
    } finally {
      clearTimer(timer);
    }
  }
  async function parseIndex(text, diagnostics) {
    await yieldToUi();
    const start = now();
    try {
      const index = JSON.parse(text);
      if (!validateMtgjsonCardIndex(index)) throw new Error("Card-name index payload is invalid.");
      return index;
    } finally {
      diagnostics.indexParseValidationMs += Math.max(0, now() - start);
      await yieldToUi();
    }
  }
  async function evict(cache, request) {
    try {
      await cache.delete(request);
    } catch {
    }
  }
  async function cacheEntries(cache) {
    try {
      const entries = [];
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        if (!response) continue;
        const savedAt = Number(response.headers.get("x-pullsmith-saved-at"));
        const manifestUrl = response.headers.get("x-pullsmith-manifest-url") || "";
        const indexUrl = response.headers.get("x-pullsmith-index-url") || "";
        const manifestVersion = Number(response.headers.get("x-pullsmith-manifest-version"));
        const indexVersion = Number(response.headers.get("x-pullsmith-index-version"));
        const completeHeader = response.headers.get("x-pullsmith-manifest-rarity-complete");
        const manifestRarityHistoryComplete = completeHeader === "true" ? true : completeHeader === "false" ? false : void 0;
        const failedHeader = response.headers.get("x-pullsmith-manifest-failed-sets");
        const manifestFailedSetCount = failedHeader !== null && Number.isInteger(Number(failedHeader)) && Number(failedHeader) >= 0 ? Number(failedHeader) : void 0;
        const age = wallNow() - savedAt;
        if (!Number.isFinite(savedAt) || savedAt <= 0 || age < 0 || age > STALE_MAX_AGE_MS || !manifestUrl || !indexUrl || !Number.isInteger(manifestVersion) || !Number.isInteger(indexVersion)) {
          await evict(cache, request);
          continue;
        }
        entries.push({ request, response, savedAt, manifestUrl, indexUrl, manifestVersion, indexVersion, manifestRarityHistoryComplete, manifestFailedSetCount });
      }
      entries.sort((left, right) => right.savedAt - left.savedAt);
      for (const entry of entries.slice(maxVersions)) await evict(cache, entry.request);
      return entries.slice(0, maxVersions);
    } catch {
      return [];
    }
  }
  async function readEntry(cache, entry, diagnostics) {
    try {
      const start = now();
      const text = await entry.response.text();
      diagnostics.indexLoadMs += Math.max(0, now() - start);
      const index = await parseIndex(text, diagnostics);
      if ((index.version || 0) !== entry.indexVersion) throw new Error("Cached index schema does not match.");
      return applyManifestReadiness(index, { version: entry.manifestVersion, rarityHistoryComplete: entry.manifestRarityHistoryComplete, failedSetCount: entry.manifestFailedSetCount });
    } catch {
      await evict(cache, entry.request);
      return null;
    }
  }
  async function persist(cache, manifestUrl, manifest, text, index) {
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
        ...manifest.rarityHistoryComplete !== void 0 ? { "x-pullsmith-manifest-rarity-complete": String(manifest.rarityHistoryComplete) } : {},
        ...manifest.failedSetCount !== void 0 ? { "x-pullsmith-manifest-failed-sets": String(manifest.failedSetCount) } : {}
      } }));
      await cacheEntries(cache);
    } catch {
    }
  }
  async function performLoad(manifestUrl, onProgress) {
    const diagnostics = emptyDiagnostics();
    let manifest;
    const cache = await openCache();
    const entries = cache ? (await cacheEntries(cache)).filter((entry) => entry.manifestUrl === manifestUrl) : [];
    const staleFallback = async (stage) => {
      if (cache) {
        for (const entry of entries) {
          const index2 = await readEntry(cache, entry, diagnostics);
          if (index2) {
            diagnostics.source = "stale-fallback";
            diagnostics.failureStage = stage;
            diagnostics.cacheHits += 1;
            onProgress?.("Using the last available card-name index from browser cache...");
            return { result: { index: manifest ? applyManifestReadiness(index2, manifest) : index2, diagnostics }, savedAt: entry.savedAt, maxAge: 0 };
          }
        }
      }
      const remembered = memory.get(manifestUrl);
      if (remembered && wallNow() - remembered.savedAt >= 0 && wallNow() - remembered.savedAt <= STALE_MAX_AGE_MS) {
        diagnostics.source = "stale-fallback";
        diagnostics.failureStage = stage;
        diagnostics.cacheHits += 1;
        onProgress?.("Using the last available card-name index...");
        return { result: { index: manifest ? applyManifestReadiness(remembered.result.index, manifest) : remembered.result.index, diagnostics }, savedAt: remembered.savedAt, maxAge: 0 };
      }
      throw new MtgjsonIndexLoadError(stage, diagnostics);
    };
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
        const index2 = await readEntry(cache, entry, diagnostics);
        if (index2) {
          diagnostics.source = "persistent-cache";
          diagnostics.cacheHits += 1;
          return { result: { index: applyManifestReadiness(index2, manifest), diagnostics }, savedAt: entry.savedAt, maxAge };
        }
      }
    }
    onProgress?.("Loading card-name index...");
    let text;
    const indexStart = now();
    diagnostics.indexRequests += 1;
    try {
      text = await fetchText(manifest.indexUrl);
    } catch {
      diagnostics.indexLoadMs += Math.max(0, now() - indexStart);
      return staleFallback("index");
    }
    diagnostics.indexLoadMs += Math.max(0, now() - indexStart);
    let index;
    try {
      index = await parseIndex(text, diagnostics);
    } catch {
      return staleFallback("index");
    }
    if (cache) await persist(cache, manifestUrl, manifest, text, index);
    return { result: { index: applyManifestReadiness(index, manifest), diagnostics }, savedAt: wallNow(), maxAge };
  }
  function load(manifestUrl, options = {}) {
    if (options.signal?.aborted) return Promise.reject(abortError());
    const remembered = memory.get(manifestUrl);
    if (remembered && remembered.maxAge > 0 && wallNow() - remembered.savedAt >= 0 && wallNow() - remembered.savedAt <= remembered.maxAge) {
      return Promise.resolve({ index: remembered.result.index, diagnostics: { ...emptyDiagnostics("memory"), cacheHits: 1 } });
    }
    let flight = inFlight.get(manifestUrl);
    if (!flight) {
      const loadGeneration = generation;
      const listeners = /* @__PURE__ */ new Set();
      const shared = performLoad(manifestUrl, (message) => {
        if (generation !== loadGeneration) return;
        for (const listener2 of listeners) {
          try {
            listener2(message);
          } catch {
          }
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
    const listener = (message) => {
      if (!options.signal?.aborted) options.onProgress?.(message);
    };
    flight.listeners.add(listener);
    return waitForShared(flight.promise, options.signal).then((result) => ({ index: result.index, diagnostics: { ...result.diagnostics } })).finally(() => flight.listeners.delete(listener));
  }
  return {
    load,
    // Optional prefetch failures remain silent, and rejected requests are removed before the next attempt.
    prefetch: (manifestUrl) => load(manifestUrl).then(() => void 0, () => void 0),
    clearMemory() {
      generation += 1;
      memory.clear();
      inFlight.clear();
    }
  };
}
var sharedResolutionIndexLoader = createMtgjsonIndexLoader();
var loadMtgjsonResolutionIndex = sharedResolutionIndexLoader.load;
var prefetchMtgjsonResolutionIndex = sharedResolutionIndexLoader.prefetch;
var clearMtgjsonResolutionIndexMemory = sharedResolutionIndexLoader.clearMemory;

// src/scryfall-reliability.ts
var SCRYFALL_NORMAL_BUDGET_MS = 25e3;
var SCRYFALL_CAREFUL_BUDGET_MS = 45e3;
var SCRYFALL_ATTEMPT_BUDGET = 40;
var SCRYFALL_REQUEST_TIMEOUT_MS = 8e3;
var SCRYFALL_MAX_ATTEMPTS = 2;
var SCRYFALL_FAILURE_THRESHOLD = 3;
function createScryfallRunContext(options = {}) {
  const run = {
    state: "closed",
    reason: null,
    startedAt: null,
    stoppedAt: null,
    budgetMs: options.carefulMode || options.purpose === "pricing-recovery" ? SCRYFALL_CAREFUL_BUDGET_MS : SCRYFALL_NORMAL_BUDGET_MS,
    attemptBudget: SCRYFALL_ATTEMPT_BUDGET,
    attemptsUsed: 0,
    consecutiveKey: null,
    consecutiveFailures: 0,
    failuresByKind: {},
    failuresByHttpStatus: {},
    retryAfterMs: null,
    malformedRecordsDropped: 0,
    controller: new AbortController(),
    performance: options.performance,
    now: options.now || (() => Date.now()),
    random: options.random || Math.random
  };
  syncScryfallDiagnostics(run);
  return run;
}
function syncScryfallDiagnostics(run) {
  const report = run.performance;
  if (!report) return;
  report.providerCircuitState = run.state;
  report.providerCircuitReason = run.reason;
  report.providerBudgetMs = run.budgetMs;
  report.providerElapsedMs = run.startedAt === null ? 0 : Math.max(0, (run.stoppedAt ?? run.now()) - run.startedAt);
  report.providerAttemptBudget = run.attemptBudget;
  report.providerAttemptsUsed = run.attemptsUsed;
  report.failuresByKind = { ...run.failuresByKind };
  report.failuresByHttpStatus = { ...run.failuresByHttpStatus };
  report.rateLimitRetryAfter = run.retryAfterMs;
  report.malformedRecordsDropped = run.malformedRecordsDropped;
  report.counts.malformedRecordsDropped = run.malformedRecordsDropped;
}
function openScryfallCircuit(run, reason) {
  if (run.state === "open") return;
  run.state = "open";
  run.reason = reason;
  run.stoppedAt = run.now();
  run.controller.abort();
  syncScryfallDiagnostics(run);
}
function providerCircuitFailure(run, operation = "scryfallPrintPages") {
  if (!run) return null;
  if (run.state !== "open" && run.startedAt !== null) {
    if (run.now() - run.startedAt >= run.budgetMs) openScryfallCircuit(run, "time_budget");
    else if (run.attemptsUsed >= run.attemptBudget) openScryfallCircuit(run, "attempt_budget");
  }
  syncScryfallDiagnostics(run);
  if (run.state !== "open") return null;
  return { kind: run.reason === "time_budget" || run.reason === "attempt_budget" ? "phase-budget-exhausted" : "circuit-open", retryable: false, operation, attemptCount: 0 };
}
function startProviderPhase(run) {
  if (run.startedAt === null) run.startedAt = run.now();
  syncScryfallDiagnostics(run);
}
function remainingProviderMs(run) {
  return Math.max(0, run.budgetMs - (run.startedAt === null ? 0 : run.now() - run.startedAt));
}
function recordProviderAttempt(run, operation, attempt) {
  run.attemptsUsed += 1;
  countPerformance(run.performance, operation);
  if (attempt > 1) {
    countPerformance(run.performance, "requestRetries");
    countPerformance(run.performance, "retries");
  }
  syncScryfallDiagnostics(run);
}
function recordProviderSuccess(run) {
  run.consecutiveKey = null;
  run.consecutiveFailures = 0;
  syncScryfallDiagnostics(run);
}
function recordProviderFailure(run, failure) {
  run.failuresByKind[failure.kind] = (run.failuresByKind[failure.kind] || 0) + 1;
  if (failure.status) run.failuresByHttpStatus[failure.status] = (run.failuresByHttpStatus[failure.status] || 0) + 1;
  if (failure.retryAfterMs !== void 0) run.retryAfterMs = failure.retryAfterMs;
  if (failure.kind === "forbidden") openScryfallCircuit(run, "HTTP_403");
  else if (failure.kind === "rate-limited") openScryfallCircuit(run, "HTTP_429");
  else {
    const equivalentKey = failure.kind === "timeout" || failure.kind === "network" || failure.kind === "invalid-response" || failure.kind === "malformed-json" ? failure.kind : failure.status && failure.status >= 500 ? `http_${failure.status}` : null;
    run.consecutiveFailures = equivalentKey && equivalentKey === run.consecutiveKey ? run.consecutiveFailures + 1 : equivalentKey ? 1 : 0;
    run.consecutiveKey = equivalentKey;
    if (run.consecutiveFailures >= SCRYFALL_FAILURE_THRESHOLD) openScryfallCircuit(run, `repeated_${equivalentKey?.replaceAll("-", "_")}`);
  }
  syncScryfallDiagnostics(run);
}
function countMalformedRecords(run, count) {
  run.malformedRecordsDropped += count;
  syncScryfallDiagnostics(run);
}
function retryAfterDuration(value, now) {
  if (!value) return void 0;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1e3);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : void 0;
}
function waitForProvider(run, ms, signal) {
  if (signal?.aborted) return Promise.reject(new DOMException("Processing canceled.", "AbortError"));
  if (providerCircuitFailure(run)) return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      run.controller.signal.removeEventListener("abort", stopped);
    };
    const cancel = () => {
      cleanup();
      reject(new DOMException("Processing canceled.", "AbortError"));
    };
    const stopped = () => {
      cleanup();
      resolve(false);
    };
    const remaining = remainingProviderMs(run);
    timer = setTimeout(() => {
      cleanup();
      if (ms >= remaining) {
        openScryfallCircuit(run, "time_budget");
        resolve(false);
      } else resolve(true);
    }, Math.min(ms, remaining));
    signal?.addEventListener("abort", cancel, { once: true });
    run.controller.signal.addEventListener("abort", stopped, { once: true });
  });
}

// src/formatter.ts
var SCRYFALL_COLLECTION_URL = "https://api.scryfall.com/cards/collection";
var SCRYFALL_NAMED_URL = "https://api.scryfall.com/cards/named";
var SCRYFALL_SEARCH_URL = "https://api.scryfall.com/cards/search";
var SCRYFALL_SETS_URL = "https://api.scryfall.com/sets";
var PRODUCTION_ORIGIN = "https://card-list-formatter.vercel.app";
var BATCH_SIZE = 50;
var PRINT_FACT_CONCURRENCY = 5;
var SCRYFALL_MIN_INTERVAL_MS = 120;
var CAREFUL_SCRYFALL_MIN_INTERVAL_MS = 500;
var CACHE_TTL_MS = 4 * 24 * 60 * 60 * 1e3;
var CACHE_PREFIX = "rrg-scryfall-cache:";
var BUFFER_MARKER = ".";
var STORE_EMAIL_PATTERN = /\binfo@redraccoongames\.com\b/i;
var EMAIL_PATTERN2 = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
var PHONE_PATTERN2 = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/;
var scryfallRequestGate = Promise.resolve();
var lastScryfallRequestAt = 0;
var activeScryfallSignal = null;
var activeScryfallMinIntervalMs = SCRYFALL_MIN_INTERVAL_MS;
var activeScryfallRun;
function clearMtgjsonIndexCache() {
  clearMtgjsonResolutionIndexMemory();
}
function prefetchMtgjsonIndex() {
  return prefetchMtgjsonResolutionIndex(defaultMtgjsonManifestUrl());
}
var sampleCardList = `1 Chub Toad - G unc
Storm crow
Psychatog r
One With Nothing U
3x cheatyface foil
1 goblin game-rare
Squire
raph's jitte
4x Lightningbolt
Earthbending Student
4x Godless Shrine land
Yargle gluttin of urborg
sol ring :-)`;
function randomSampleCustomerName() {
  return GENERATED_SAMPLE_CUSTOMER_NAMES[Math.floor(Math.random() * GENERATED_SAMPLE_CUSTOMER_NAMES.length)];
}
function randomSamplePhoneNumber() {
  const areaCode = Math.random() < 0.5 ? "206" : "564";
  const lastFour = String(Math.floor(Math.random() * 1e4)).padStart(4, "0");
  return `${areaCode}-555-${lastFour}`;
}
function beginScryfallRun(signal, carefulMode = false) {
  activeScryfallSignal = signal;
  activeScryfallMinIntervalMs = carefulMode ? CAREFUL_SCRYFALL_MIN_INTERVAL_MS : SCRYFALL_MIN_INTERVAL_MS;
  activeScryfallRun = createScryfallRunContext({ carefulMode });
}
function endScryfallRun() {
  activeScryfallSignal = null;
  activeScryfallMinIntervalMs = SCRYFALL_MIN_INTERVAL_MS;
  activeScryfallRun = void 0;
}
function createSampleList() {
  return `${randomSampleCustomerName()}
${randomSamplePhoneNumber()}

${sampleCardList}`;
}
var CARD_HINTS = /* @__PURE__ */ new Set([
  "artifact",
  "black",
  "blue",
  "colorless",
  "common",
  "creature",
  "enchantment",
  "green",
  "instant",
  "land",
  "legendary",
  "mythic",
  "planeswalker",
  "rare",
  "red",
  "sorcery",
  "uncommon",
  "white"
]);
var BASIC_LANDS_BY_COLOR = {
  black: "Swamp",
  blue: "Island",
  green: "Forest",
  red: "Mountain",
  white: "Plains"
};
var BASIC_LAND_NAMES = new Set(Object.values(BASIC_LANDS_BY_COLOR));
var BASIC_LAND_ORDER = ["Plains", "Island", "Swamp", "Mountain", "Forest"];
var CASE_RELEVANT_SET_TYPES = /* @__PURE__ */ new Set(["core", "commander", "draft_innovation", "expansion", "masters"]);
var RECENT_CASE_SET_COUNT = 3;
var CHECK_CASE_RECENT_SET_COUNT = 2;
var CASE_STAPLE_CARD_NAMES = new Set([
  "Ancient Tomb",
  "Arcane Signet",
  "Arid Mesa",
  "Blood Crypt",
  "Bloodstained Mire",
  "Boseiju, Who Endures",
  "Bountiful Promenade",
  "Breeding Pool",
  "Cavern of Souls",
  "City of Brass",
  "Command Tower",
  "Eiganjo, Seat of the Empire",
  "Exotic Orchard",
  "Flooded Strand",
  "Gemstone Caverns",
  "Godless Shrine",
  "Hallowed Fountain",
  "Indatha Triome",
  "Jetmir's Garden",
  "Ketria Triome",
  "Luxury Suite",
  "Mana Confluence",
  "Marsh Flats",
  "Misty Rainforest",
  "Morphic Pool",
  "Nykthos, Shrine to Nyx",
  "Otawara, Soaring City",
  "Overgrown Tomb",
  "Polluted Delta",
  "Prismatic Vista",
  "Raffine's Tower",
  "Raugrin Triome",
  "Reflecting Pool",
  "Rejuvenating Springs",
  "Reliquary Tower",
  "Sacred Foundry",
  "Savai Triome",
  "Scalding Tarn",
  "Sea of Clouds",
  "Sol Ring",
  "Sokenzan, Crucible of Defiance",
  "Spara's Headquarters",
  "Spectator Seating",
  "Steam Vents",
  "Stomping Ground",
  "Takenuma, Abandoned Mire",
  "Temple Garden",
  "Training Center",
  "Undergrowth Stadium",
  "Urborg, Tomb of Yawgmoth",
  "Vault of Champions",
  "Verdant Catacombs",
  "Watery Grave",
  "Windswept Heath",
  "Wooded Foothills",
  "Xander's Lounge",
  "Yavimaya, Cradle of Growth",
  "Zagoth Triome",
  "Ziatora's Proving Ground"
].map(normalizeName));
var TOKEN_KEYWORD_PATTERNS = [
  ["Double Strike", /\bdouble\s+strike\b/i],
  ["First Strike", /\bfirst\s+strike\b/i],
  ["Deathtouch", /\bdeathtouch\b/i],
  ["Defender", /\bdefender\b/i],
  ["Flying", /\bflying\b/i],
  ["Haste", /\bhaste\b/i],
  ["Hexproof", /\bhexproof\b/i],
  ["Indestructible", /\bindestructible\b/i],
  ["Lifelink", /\blifelink\b/i],
  ["Menace", /\bmenace\b/i],
  ["Reach", /\breach\b/i],
  ["Trample", /\btrample\b/i],
  ["Vigilance", /\bvigilance\b/i],
  ["Ward", /\bward\b/i],
  ["Prowess", /\bprowess\b/i],
  ["Toxic", /\btoxic\b/i],
  ["Infect", /\binfect\b/i],
  ["Wither", /\bwither\b/i],
  ["Shroud", /\bshroud\b/i],
  ["Fear", /\bfear\b/i],
  ["Intimidate", /\bintimidate\b/i],
  ["Islandwalk", /\bislandwalk\b/i],
  ["Swampwalk", /\bswampwalk\b/i],
  ["Mountainwalk", /\bmountainwalk\b/i],
  ["Forestwalk", /\bforestwalk\b/i],
  ["Plainswalk", /\bplainswalk\b/i]
];
var TOKEN_COLOR_PATTERNS = [
  ["White", /\bwhite\b/i],
  ["Blue", /\bblue\b/i],
  ["Black", /\bblack\b/i],
  ["Red", /\bred\b/i],
  ["Green", /\bgreen\b/i],
  ["Colorless", /\bcolorless\b/i]
];
var SPECIAL_REQUEST_PATTERNS = [
  { label: "SURGE FOIL", pattern: /\bsurge\s+foil\b/i },
  { label: "FOIL", pattern: /\b(?:foil|foiled)\b/i },
  { label: "NONFOIL", pattern: /\b(?:non[-\s]?foil|nonfoil)\b/i },
  { label: "SHOWCASE", pattern: /\bshowcase\b/i },
  { label: "BORDERLESS", pattern: /\bborderless\b/i },
  { label: "EXTENDED ART", pattern: /\bextended\s+art\b/i },
  { label: "FULL ART", pattern: /\bfull\s+art\b/i },
  { label: "ETCHED", pattern: /\betched\b/i },
  { label: "RETRO FRAME", pattern: /\b(?:retro\s+frame|old\s+border)\b/i },
  { label: "ALT ART", pattern: /\b(?:alt(?:ernate)?\s+art|alternate\s+art)\b/i },
  { label: "PROMO", pattern: /\bpromo\b/i }
];
function normalizeName(value) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w/ ]+/g, "").replace(/\s+/g, " ").trim();
}
function compactName(value) {
  return normalizeName(value).replace(/\s+/g, "");
}
function providerContext(options, carefulMode = false) {
  const minIntervalMs = carefulMode ? CAREFUL_SCRYFALL_MIN_INTERVAL_MS : Math.max(SCRYFALL_MIN_INTERVAL_MS, options.minIntervalMs || (options.signal === void 0 ? activeScryfallMinIntervalMs : SCRYFALL_MIN_INTERVAL_MS));
  options.providerRun ||= options.enrichmentPurpose !== "pricing-recovery" && activeScryfallRun ? activeScryfallRun : createScryfallRunContext({ carefulMode: minIntervalMs >= CAREFUL_SCRYFALL_MIN_INTERVAL_MS, purpose: options.enrichmentPurpose, performance: options.performance });
  if (options.performance) options.providerRun.performance = options.performance;
  syncScryfallDiagnostics(options.providerRun);
  return { ...options, signal: options.signal === void 0 ? activeScryfallSignal : options.signal, minIntervalMs };
}
async function waitForScryfallSlot(context) {
  const run = context.providerRun;
  startProviderPhase(run);
  if (providerCircuitFailure(run)) return false;
  const previousGate = scryfallRequestGate;
  let releaseGate;
  scryfallRequestGate = new Promise((resolve) => {
    releaseGate = resolve;
  });
  try {
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        context.signal?.removeEventListener("abort", cancel);
        run.controller.signal.removeEventListener("abort", stopped);
      };
      const cancel = () => {
        cleanup();
        reject(new DOMException("Processing canceled.", "AbortError"));
      };
      const stopped = () => {
        cleanup();
        resolve();
      };
      context.signal?.addEventListener("abort", cancel, { once: true });
      run.controller.signal.addEventListener("abort", stopped, { once: true });
      previousGate.then(() => {
        cleanup();
        resolve();
      }, reject);
    });
    throwIfAborted(context.signal);
    if (providerCircuitFailure(run)) return false;
    const elapsed = Date.now() - lastScryfallRequestAt;
    const interval = context.minIntervalMs || SCRYFALL_MIN_INTERVAL_MS;
    if (elapsed < interval && !await waitForProvider(run, interval - elapsed, context.signal)) return false;
    throwIfAborted(context.signal);
    if (providerCircuitFailure(run)) return false;
    lastScryfallRequestAt = Date.now();
    return true;
  } finally {
    previousGate.then(releaseGate, releaseGate);
  }
}
function cacheKeyForRequest(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  return `${CACHE_PREFIX}${method}:${url}:${String(options.body || "")}`;
}
function readCachedResponse(url, options = {}) {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(cacheKeyForRequest(url, options));
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached?.savedAt || Date.now() - cached.savedAt > CACHE_TTL_MS) {
      localStorage.removeItem(cacheKeyForRequest(url, options));
      return null;
    }
    return { ok: true, status: cached.status || 200, data: cached.data, cached: true };
  } catch {
    return null;
  }
}
function writeCachedResponse(url, options = {}, result) {
  if (typeof localStorage === "undefined" || !result?.ok) return;
  try {
    localStorage.setItem(cacheKeyForRequest(url, options), JSON.stringify({
      savedAt: Date.now(),
      status: result.status,
      data: result.data
    }));
  } catch {
  }
}
function throwIfAborted(signal = activeScryfallSignal) {
  if (signal?.aborted) {
    throw new DOMException("Processing canceled.", "AbortError");
  }
}
function formatPhoneNumber(value) {
  return formatCustomerPhone(value);
}
function normalizeContactValue(value) {
  const trimmed = value.trim();
  if (PHONE_PATTERN2.test(trimmed)) {
    return formatPhoneNumber(trimmed);
  }
  return trimmed;
}
function contactParts(value) {
  const parts = [];
  const phone = value.match(PHONE_PATTERN2)?.[0] || "";
  const email = value.match(EMAIL_PATTERN2)?.[0] || "";
  const facebook = /\bfacebook\b|\bfb\b/i.test(value) ? "facebook" : "";
  if (phone) parts.push(formatPhoneNumber(phone));
  if (email) parts.push(email.trim());
  if (facebook) parts.push(facebook);
  if (!parts.length && value.trim()) parts.push(normalizeContactValue(value));
  return parts;
}
function mergeContactValues(...values) {
  const orderedParts = values.flatMap((value) => contactParts(value || ""));
  return Array.from(new Set(orderedParts)).join(" / ");
}
function cleanCustomerName(value) {
  return value.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().replace(/^["']|["']$/g, "").trim();
}
function stripFieldLabel(value) {
  return value.replace(/^(?:name|customer|phone|email|e-mail|contact)(?:\s*:\s*|\s+-\s+)/i, "").trim();
}
function splitNameAndContact(value, extraContact = "") {
  const cleanedValue = stripFieldLabel(value);
  const email = value.match(EMAIL_PATTERN2)?.[0] || "";
  const phone = value.match(PHONE_PATTERN2)?.[0] || "";
  const facebook = /\bfacebook\b|\bfb\b/i.test(value) ? "facebook" : "";
  const contact = mergeContactValues(phone, email, facebook, extraContact);
  const name = [phone, email].reduce(
    (current, part) => part ? current.replace(part, "") : current,
    cleanedValue
  ).replace(/\bfacebook\b|\bfb\b/i, "").replace(/\s+/g, " ").trim();
  return { name: cleanCustomerName(name), contact };
}
function extractContact(line) {
  const labeledNameMatch = line.match(/^(?:name|customer)(?:\s*:\s*|\s+-\s+)(.+)$/i);
  if (labeledNameMatch) {
    return { name: cleanCustomerName(labeledNameMatch[1]), contact: "" };
  }
  const labeledContactMatch = line.match(/^(?:phone|email|e-mail|contact)(?:\s*:\s*|\s+-\s+)(.+)$/i);
  if (labeledContactMatch) {
    return { name: "", contact: mergeContactValues(labeledContactMatch[1]) };
  }
  const emailFromMatch = line.match(/^from:\s*(.+)$/i);
  if (emailFromMatch) {
    return splitNameAndContact(emailFromMatch[1]);
  }
  const headerFromMatch = line.match(/\bpull\s+list\s+from\s+(.+?)(?:\s+on\s+facebook|\s+\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|$)/i);
  if (headerFromMatch) {
    return splitNameAndContact(headerFromMatch[1], /\bfacebook\b|\bfb\b/i.test(line) ? "facebook" : "");
  }
  const headerForMatch = line.match(/\bpull\s+list\s+for\s+(.+)$/i);
  if (headerForMatch) {
    return splitNameAndContact(headerForMatch[1]);
  }
  const bracketMatch = line.match(/^([^<]+)<([^>]+)>$/);
  if (bracketMatch) {
    return {
      name: cleanCustomerName(bracketMatch[1]),
      contact: normalizeContactValue(bracketMatch[2])
    };
  }
  const parsed = splitNameAndContact(line);
  if (!parsed.contact) return { name: line.trim(), contact: "" };
  return parsed;
}
function isSeparatorLine(line) {
  return /^[-_=]{4,}$/.test(line.trim());
}
function isLikelyNoteLine(line) {
  const normalized = normalizeName(line);
  if (!normalized) return true;
  if (STORE_EMAIL_PATTERN.test(line)) return true;
  if (/\bdeck\s*list\b/i.test(line) || /decklist$/i.test(line)) return true;
  if (/^(prices?\s+are|i used\b|i don'?t\b|i do not\b|i placed\b)/i.test(line)) return true;
  if (/^(hello|hi|hey|thanks|thank you|just one of each|i will|i'm|im|these are|please|once again|mtg pull list from|mtg pull list for)\b/i.test(line)) {
    return true;
  }
  if ((/[!?]/.test(line) || /\.\s*$/.test(line)) && normalized.split(" ").length > 4) return true;
  return false;
}
function isLabeledContactLine(line) {
  return /^(?:name|customer|phone|email|e-mail|contact)(?:\s*:\s*|\s+-\s+)/i.test(line);
}
function isContactSectionHeading(line, nextLine = "") {
  return /^(?:contact|contact information|customer information)$/i.test(line) && isLabeledContactLine(nextLine);
}
function hasContactOrHeader(line) {
  return EMAIL_PATTERN2.test(line) || PHONE_PATTERN2.test(line) || isLabeledContactLine(line) || /\bpull\s+list\s+(from|for)\b/i.test(line) || /\bfacebook\b|\bfb\b/i.test(line);
}
function isFromHeaderLine(line) {
  return /^from:\s*/i.test(line);
}
function isIgnoredEmailMetadataLine(line) {
  return /^pull list email received$/i.test(line) || /^(subject|received):\s*/i.test(line);
}
function parseCustomerAndCards(text) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const customer = { name: "", contact: "" };
  const emailHeaderContact = { name: "", contact: "" };
  const cardLines = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (isSeparatorLine(line) || STORE_EMAIL_PATTERN.test(line)) continue;
    if (isContactSectionHeading(line, lines[index + 1])) continue;
    if (isFromHeaderLine(line)) {
      const parsed = extractContact(line);
      emailHeaderContact.name = emailHeaderContact.name || parsed.name;
      emailHeaderContact.contact = mergeContactValues(emailHeaderContact.contact, parsed.contact);
      continue;
    }
    if (isIgnoredEmailMetadataLine(line)) continue;
    if (hasContactOrHeader(line)) {
      const parsed = extractContact(line);
      customer.name = customer.name || parsed.name;
      customer.contact = mergeContactValues(customer.contact, parsed.contact);
      continue;
    }
    if (parseStructuredPriceRow(line) || parseStructuredExportLine(line)) {
      cardLines.push(lines[index]);
      continue;
    }
    if (isLikelyNoteLine(line)) continue;
    cardLines.push(lines[index]);
  }
  customer.name = customer.name || emailHeaderContact.name;
  customer.contact = customer.contact || emailHeaderContact.contact;
  return { customer: normalizeCustomer(customer), cardLines };
}
var RARITY_ALIASES = {
  m: "mythic",
  mr: "mythic",
  mythic: "mythic",
  "mythic rare": "mythic",
  r: "rare",
  rare: "rare",
  u: "uncommon",
  uc: "uncommon",
  unc: "uncommon",
  uncommon: "uncommon",
  c: "common",
  com: "common",
  common: "common"
};
function parseRarity(value) {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
  return Object.hasOwn(RARITY_ALIASES, normalized) ? RARITY_ALIASES[normalized] : "";
}
function splitCommaFields(value) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"') {
      current += character;
      if (inQuotes && value[index + 1] === '"') {
        current += value[++index];
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (character === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  fields.push(current.trim());
  return fields;
}
function unquoteField(value) {
  const trimmed = value.trim();
  return /^("|')[\s\S]*\1$/.test(trimmed) ? trimmed.slice(1, -1).replace(/""/g, '"').trim() : trimmed;
}
function emptyMetadata() {
  return { rarities: [], specialRequests: [] };
}
function parseMetadataField(value, delimited = true) {
  let remaining = unquoteField(value);
  if (!remaining) return null;
  const result = emptyMetadata();
  let invalidQuantity = false;
  remaining = remaining.replace(
    /(?:^|\s)(?:(?:quantity|qty)\s*[:=]?\s*(\d+)|x\s*(\d+)|(\d+)\s*x)(?=\s|$)/ig,
    (_, explicit, prefix, suffix) => {
      const quantity = Number(explicit || prefix || suffix);
      if (!Number.isSafeInteger(quantity) || quantity <= 0 || result.quantity !== void 0) invalidQuantity = true;
      result.quantity = quantity;
      return " ";
    }
  ).trim();
  if (invalidQuantity) return null;
  if (!remaining) return result;
  if (/^\d+$/.test(remaining) && delimited && result.quantity === void 0) {
    const quantity = Number(remaining);
    return Number.isSafeInteger(quantity) && quantity > 0 ? { ...result, quantity } : null;
  }
  while (remaining) {
    const rarity = remaining.match(new RegExp(`^${rarityPattern()}(?=$|\\s|/|,)`, "i"));
    const request = SPECIAL_REQUEST_PATTERNS.find(({ pattern }) => {
      const match = remaining.match(pattern);
      return match?.index === 0 && /^(?:$|\s|\/|,)/.test(remaining.slice(match[0].length));
    });
    const color = remaining.match(/^(?:white|blue|black|red|green|colorless|[WUBRG]{1,5})(?=$|\s|\/|,)/i);
    const hint = remaining.match(/^[a-z]+(?=$|\s|\/|,)/i);
    let consumed = "";
    if (rarity) {
      result.rarities.push(parseRarity(rarity[0]));
      consumed = rarity[0];
    } else if (request) {
      result.specialRequests.push(request.label);
      if (request.label === "SURGE FOIL") result.specialRequests.push("FOIL");
      consumed = remaining.match(request.pattern)[0];
    } else if (color && delimited) {
      result.color = [result.color, color[0]].filter(Boolean).join("/");
      consumed = color[0];
    } else if (hint && CARD_HINTS.has(hint[0].toLowerCase()) && (delimited || hint[0].toLowerCase() === "land")) {
      consumed = hint[0];
    } else if (delimited && /^[<>]?\$?\d+(?:\.\d{1,2})?$/.test(remaining)) {
      result.price = Number(remaining.replace(/^[<>]?\$?/, ""));
      consumed = remaining;
    } else if (delimited && /^[A-Z0-9]{2,6}(?:\s*\/\s*[A-Z0-9]{2,6})*$/.test(remaining)) {
      const codes = remaining.split(/\s*\/\s*/);
      if (codes.length === 1) result.setCode = codes[0];
      consumed = remaining;
    } else if (delimited && /^(?:yes|no|y|n|doesn'?t matter|does not matter|cheapest you have)$/i.test(remaining)) {
      consumed = remaining;
    } else {
      return null;
    }
    remaining = remaining.slice(consumed.length);
    if (!remaining) break;
    remaining = remaining.replace(/^(?:\s*[,/]\s*|\s+and\s+|\s+)/i, "");
    if (!remaining) return null;
  }
  return result;
}
function mergeMetadata(target, field) {
  target.rarities.push(...field.rarities);
  target.specialRequests.push(...field.specialRequests);
  for (const key of ["quantity", "setCode", "price", "color"]) {
    if (field[key] !== void 0) Object.assign(target, { [key]: field[key] });
  }
}
function applyCommaMetadata(line, metadata) {
  const fields = splitCommaFields(line);
  if (fields.length < 2) return line;
  let metadataStart = fields.length;
  const parsedFields = [];
  for (let index = fields.length - 1; index >= 1; index -= 1) {
    const parsed = parseMetadataField(fields[index]);
    if (!parsed) break;
    parsedFields.unshift(parsed);
    metadataStart = index;
  }
  if (!parsedFields.length) return line;
  parsedFields.forEach((field) => mergeMetadata(metadata, field));
  return fields.slice(0, metadataStart).join(", ").trim();
}
function rarityPattern() {
  return `(?:${Object.keys(RARITY_ALIASES).sort((a, b) => b.length - a.length).join("|")})`;
}
function parseStructuredPriceRow(line) {
  const match = line.match(new RegExp(
    `^(.*?)\\s+-\\s+(${rarityPattern()})\\s+-\\s+(\\$?\\d+(?:\\.\\d{1,2})?)\\s*-\\s+([A-Z0-9]{2,6}(?:\\s*\\/\\s*[A-Z0-9]{2,6})*)\\s+-\\s+((?:white|blue|black|red|green|colorless|land|[WUBRG]{1,5})(?:\\/(?:white|blue|black|red|green|colorless|land|[WUBRG]{1,5}))*)\\s*$`,
    "i"
  ));
  if (!match) return null;
  const name = match[1].trim();
  const rarity = parseRarity(match[2]);
  if (!name || !rarity) return null;
  const setCodes = match[4].split("/").map((value) => value.trim().toUpperCase()).filter(Boolean);
  return { name, rarity, setCode: setCodes.length === 1 ? setCodes[0] : "" };
}
function splitTableFields(line) {
  return line.split(/\t+|\s{2,}/).map((field) => field.trim()).filter(Boolean);
}
function isQuantityOnlyLine(line) {
  return /^\d+\s*x?$/i.test(line.trim());
}
function isTableHeaderLine(line) {
  const normalized = normalizeName(line);
  if (["qty", "quantity", "card name", "card", "rarity"].includes(normalized)) return true;
  const fields = splitTableFields(line).map((field) => normalizeName(field));
  return fields.includes("card name") && fields.includes("rarity") && fields.includes("quantity");
}
function isStandaloneRarityLine(line) {
  return Boolean(parseRarity(line));
}
function normalizeHorizontalTableRow(line) {
  const fields = splitTableFields(line);
  if (fields.length < 2 || isTableHeaderLine(line)) return "";
  if (!fields.slice(1).every((field) => parseMetadataField(field))) return "";
  return [`"${unquoteField(fields[0]).replace(/"/g, '""')}"`, ...fields.slice(1)].join(", ");
}
function normalizeCopiedTableLines(lines) {
  const normalized = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (isTableHeaderLine(line)) continue;
    const horizontalTableRow = normalizeHorizontalTableRow(line);
    if (horizontalTableRow) {
      normalized.push(horizontalTableRow);
      continue;
    }
    if (isQuantityOnlyLine(line) && lines[index + 1] && lines[index + 2] && !isTableHeaderLine(lines[index + 1]) && isStandaloneRarityLine(lines[index + 2])) {
      normalized.push(`${line} ${lines[index + 1]} ${lines[index + 2]}`);
      index += 2;
      continue;
    }
    if (isQuantityOnlyLine(line) || isStandaloneRarityLine(line)) continue;
    normalized.push(line);
  }
  return normalized;
}
function cleanCardName(value) {
  const cleaned = value.replace(/^[•*]\s+/, "").replace(/\s+[:;=8xX][-']?[)(DPp]\s*$/g, "").replace(/\s+/g, " ").trim();
  return splitCommaFields(cleaned).map(unquoteField).join(", ");
}
function cleanLookupName(value) {
  return cleanCardName(value);
}
function isTokenRequestName(value) {
  return /\btoken\b/i.test(value);
}
function extractPowerToughness(value) {
  const match = value.match(/\b((?:\d+|x|\*)\s*\/\s*(?:\d+|x|\*))\b/i);
  return match ? match[1].replace(/\s+/g, "").toUpperCase() : "";
}
function extractTokenDetails(value) {
  const powerToughness = extractPowerToughness(value);
  const keywords = TOKEN_KEYWORD_PATTERNS.filter(([, pattern]) => pattern.test(value)).map(([label]) => label);
  return Array.from(new Set([powerToughness, ...keywords].filter(Boolean)));
}
function extractTokenColors(value) {
  const colors = TOKEN_COLOR_PATTERNS.filter(([, pattern]) => pattern.test(value)).map(([label]) => label);
  return Array.from(new Set(colors));
}
function cleanTokenName(value) {
  let cleaned = value.replace(/\b(?:\d+|x|\*)\s*\/\s*(?:\d+|x|\*)\b/ig, " ");
  TOKEN_KEYWORD_PATTERNS.forEach(([, pattern]) => {
    cleaned = cleaned.replace(pattern, " ");
  });
  TOKEN_COLOR_PATTERNS.forEach(([, pattern]) => {
    cleaned = cleaned.replace(pattern, " ");
  });
  return cleaned.replace(/\b(?:with|and|or|has|having)\b/ig, " ").replace(/\([\s,;/]*\)|\[[\s,;/]*\]/g, " ").replace(/\s*[,.;:-]\s*$/g, "").replace(/\s+/g, " ").trim();
}
function applyTokenColors(name, colors = []) {
  if (!colors.length) return name;
  const colorPrefix = colors.join("/");
  return normalizeName(name).startsWith(normalizeName(colorPrefix)) ? name : `${colorPrefix} ${name}`;
}
function mergeSpecialRequests(a = [], b = []) {
  return Array.from(/* @__PURE__ */ new Set([...a, ...b]));
}
function requestedPrintingFor(specialRequests, setCode = "") {
  const requests = new Set(specialRequests);
  const treatment = requests.has("RETRO FRAME") ? "retro" : requests.has("SHOWCASE") ? "showcase" : requests.has("BORDERLESS") ? "borderless" : requests.has("EXTENDED ART") ? "extended-art" : requests.has("FULL ART") ? "full-art" : "";
  const finish = requests.has("SURGE FOIL") ? "foil" : requests.has("ETCHED") ? "etched" : requests.has("FOIL") ? "foil" : requests.has("NONFOIL") ? "normal" : void 0;
  const foilTreatment = requests.has("SURGE FOIL") ? "surge" : requests.has("FOIL") ? "standard" : void 0;
  const requestedPrinting = {
    ...setCode ? { setCode: setCode.toUpperCase() } : {},
    ...finish ? { finish } : {},
    ...foilTreatment ? { foilTreatment } : {},
    ...treatment ? { treatment } : {}
  };
  return Object.keys(requestedPrinting).length ? requestedPrinting : void 0;
}
function mergeRequestedPrinting(a, b) {
  const shared = { ...a || {}, ...b || {} };
  if (a?.setCode && b?.setCode && a.setCode !== b.setCode) delete shared.setCode;
  return Object.keys(shared).length ? shared : void 0;
}
function hasSpecialPrintRequest(item) {
  if (item.requestedPrinting?.sourceFormat === "set-collector-export") {
    return (item.specialRequests || []).some((request) => request !== "NONFOIL" && !(request === "FOIL" && item.requestedPrinting.finish === "foil"));
  }
  return Boolean(item.requestedPrinting?.setCode) || (item.specialRequests || []).some((request) => request !== "NONFOIL");
}
function requiresScryfallEnrichment(item, options = {}) {
  const decision = (required, reason) => ({ required, reason });
  if (item.isToken) return decision(false, "token");
  if ((item.isBasicLand || BASIC_LAND_NAMES.has(item.inputName)) && !hasSpecialPrintRequest(item)) return decision(false, "basic-land");
  if (item.status === "review") return decision(false, "already-complete");
  if (item.status !== "found") return decision(true, item.enrichmentReason || "fuzzy-name-required");
  if (item.prints?.length && item.eligibleRarityChecked && !item.printLookupFailed) return decision(false, "already-complete");
  if (options.enrichmentPurpose === "pricing-recovery") return decision(true, "pricing-recovery");
  if (options.enrichmentPurpose === "case-check") return decision(true, "case-check");
  if (item.requestedFlavor) return decision(true, "requested-flavor-name");
  if (hasSpecialPrintRequest(item)) return decision(true, "special-printing-request");
  if (item.legacyIndexCompatibility) return decision(!item.paperIdentityVerified, "legacy-index-compatibility");
  if (!item.localPaperVerified && !isPlayablePaperCard(item.card)) return decision(true, "insufficient-paper-confidence");
  if (!item.localRarityVerified) return decision(true, "insufficient-local-rarity");
  return decision(false, "already-complete");
}
function printMatchesSpecialRequests(print, item) {
  if (!isPlayablePaperCard(print)) return false;
  if (item.requestedPrinting?.setCode && String(print.set || "").toUpperCase() !== item.requestedPrinting.setCode.toUpperCase()) return false;
  const requests = item.specialRequests || [];
  if (!requests.length) return true;
  return requests.every((request) => {
    if (request === "FOIL") return print.foil || print.finishes?.includes("foil");
    if (request === "NONFOIL") return print.nonfoil || print.finishes?.includes("nonfoil");
    if (request === "FULL ART") return Boolean(print.full_art);
    if (request === "BORDERLESS") return print.border_color === "borderless" || print.frame_effects?.includes("borderless");
    if (request === "EXTENDED ART") return print.frame_effects?.includes("extendedart") || print.promo_types?.includes("extendedart");
    if (request === "SHOWCASE") return print.frame_effects?.includes("showcase") || print.promo_types?.includes("showcase");
    if (request === "ETCHED") return print.finishes?.includes("etched");
    if (request === "SURGE FOIL") return (print.finishes?.includes("foil") || print.foil) && print.promo_types?.includes("surgefoil");
    if (request === "RETRO FRAME") return treatmentsForRawPrinting(print).includes("retro");
    if (request === "ALT ART") return print.promo_types?.some((type) => /alternate|boosterfun|showcase|borderless/.test(type));
    if (request === "PROMO") return Boolean(print.promo);
    return true;
  });
}
function specialRequestNote(item) {
  return (item.specialRequests || []).map((request) => ` - ${request}`).join("");
}
function specialRequestReviewNote(item) {
  const requests = item.specialRequests || [];
  if (!requests.length) return item.requestedPrinting?.setCode ? "Requested set not found" : "";
  if (requests.length === 1) return `${requests[0]} version not found`;
  return `${requests.join(" / ")} version not found`;
}
function requestedFlavorName(item, prints = []) {
  const candidates = [item.card, ...prints].filter(Boolean);
  const inputNormalized = normalizeName(item.inputName);
  const inputCompact = compactName(item.inputName);
  const flavorNames = candidates.flatMap((print) => [
    print.flavor_name,
    ...(print.card_faces || []).map((face) => face.flavor_name)
  ]).filter(Boolean);
  const match = flavorNames.find((flavorName) => normalizeName(flavorName) === inputNormalized || compactName(flavorName) === inputCompact);
  return match || "";
}
function pullTrailingParentheticalQuantity(line) {
  const match = line.match(/\s*\((\d+)\)\s*$/);
  const quantity = Number(match?.[1] || 0);
  if (!match || !Number.isFinite(quantity) || quantity <= 0) {
    return { line, quantity: 0 };
  }
  return {
    line: line.slice(0, match.index).trim(),
    quantity
  };
}
function stripReviewParentheticals(line, metadata) {
  const match = line.match(/\(([^()]*)\)\s*$|\[([^\[\]]*)\]\s*$/);
  if (!match || !match.index) return line;
  const parsed = parseMetadataField(match[1] ?? match[2]);
  if (!parsed) return line;
  mergeMetadata(metadata, parsed);
  return line.slice(0, match.index).trim();
}
function stripTrailingDescriptors(line, metadata) {
  let remaining = line.trim().replace(/,\s*$/, "").trim();
  while (remaining) {
    const parenthetical = stripReviewParentheticals(remaining, metadata);
    if (parenthetical !== remaining) {
      remaining = parenthetical;
      continue;
    }
    const comma = applyCommaMetadata(remaining, metadata);
    if (comma !== remaining) {
      remaining = comma;
      if (splitCommaFields(remaining).length > 1) break;
      continue;
    }
    if (unquoteField(remaining) !== remaining) break;
    const hasCommaFields = splitCommaFields(remaining).length > 1;
    const dashes = Array.from(remaining.matchAll(/[-–—]/g)).reverse().filter((match) => !hasCommaFields || /\s/.test(remaining[match.index - 1] || "") && /\s/.test(remaining[match.index + 1] || ""));
    const dashSuffix = dashes.map((match) => ({
      index: match.index,
      parsed: parseMetadataField(remaining.slice(match.index + 1), /\s/.test(remaining[match.index - 1] || "") && /\s/.test(remaining[match.index + 1] || ""))
    })).find(({ index, parsed }) => index > 0 && parsed);
    if (dashSuffix) {
      mergeMetadata(metadata, dashSuffix.parsed);
      remaining = remaining.slice(0, dashSuffix.index).trim();
      continue;
    }
    if (/\s[-–—]\s/.test(remaining)) break;
    let wordSuffix = null;
    for (const match of Array.from(remaining.matchAll(/\s+/g)).reverse()) {
      if (/[:/]$/.test(remaining.slice(0, match.index))) break;
      const parsed = parseMetadataField(remaining.slice(match.index + match[0].length), false);
      if (hasCommaFields && (!parsed?.specialRequests.length || parsed.rarities.length || parsed.quantity !== void 0 || parsed.color)) continue;
      if (parsed) wordSuffix = { index: match.index, parsed };
      else if (wordSuffix) break;
    }
    if (wordSuffix) {
      mergeMetadata(metadata, wordSuffix.parsed);
      remaining = remaining.slice(0, wordSuffix.index).trim();
      continue;
    }
    break;
  }
  return remaining.replace(/\s*,\s*$/, "").trim();
}
function parseCardLine(rawLine, index) {
  let line = rawLine.trim().replace(/^[-•]\s*/, "");
  if (!line || /^(\/\/|#)/.test(line)) return null;
  const quantityMatch = line.match(/^(\d+)\s*x?\s+(.+)$/i);
  let quantity = quantityMatch ? Number(quantityMatch[1]) : 1;
  line = quantityMatch ? quantityMatch[2].trim() : line;
  const structuredExport = parseStructuredExportLine(line, true);
  const nameToRepair = structuredExport ? structuredExport.name : line;
  const repairedName = repairMojibake(nameToRepair);
  const mojibakeCorrected = repairedName !== nameToRepair;
  if (structuredExport) structuredExport.name = repairedName;
  else line = repairedName;
  const manaMatch = line.match(/^(white|blue|black|red|green)\s+mana$/i);
  if (manaMatch) {
    const color = manaMatch[1].toLowerCase();
    const landName = BASIC_LANDS_BY_COLOR[color];
    return {
      index,
      original: rawLine,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      inputName: landName,
      statedRarities: ["common"],
      specialRequests: [],
      lookupKey: normalizeName(landName)
    };
  }
  const metadata = emptyMetadata();
  const structuredPriceRow = structuredExport ? null : parseStructuredPriceRow(line);
  if (structuredExport) line = structuredExport.name;
  if (structuredPriceRow) {
    line = structuredPriceRow.name;
    metadata.rarities.push(structuredPriceRow.rarity);
    metadata.setCode = structuredPriceRow.setCode;
  }
  if (!structuredExport) {
    const parentheticalQuantity = pullTrailingParentheticalQuantity(line);
    line = parentheticalQuantity.line;
    quantity = parentheticalQuantity.quantity || quantity;
    if (!structuredPriceRow) line = stripTrailingDescriptors(line, metadata);
  }
  quantity = metadata.quantity || quantity;
  let inputName = cleanLookupName(line);
  if (!inputName) return null;
  const isToken = isTokenRequestName(inputName);
  const tokenSource = structuredExport ? inputName : rawLine;
  const tokenDetails = isToken ? extractTokenDetails(tokenSource) : [];
  const tokenColors = isToken ? extractTokenColors(tokenSource) : [];
  if (isToken) inputName = applyTokenColors(cleanTokenName(inputName), tokenColors);
  if (!inputName) return null;
  const uniqueSpecialRequests = Array.from(/* @__PURE__ */ new Set([...metadata.specialRequests, ...structuredExport?.finish === "foil" ? ["FOIL"] : []]));
  return {
    index,
    original: rawLine,
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    inputName,
    statedRarities: Array.from(new Set(metadata.rarities)),
    specialRequests: uniqueSpecialRequests,
    requestedPrinting: structuredExport ? {
      setCode: structuredExport.setCode,
      collectorNumber: structuredExport.collectorNumber,
      ...structuredExport.finish ? { finish: structuredExport.finish, foilTreatment: structuredExport.foilTreatment } : {},
      sourceFormat: structuredExport.sourceFormat
    } : requestedPrintingFor(uniqueSpecialRequests, metadata.setCode),
    structuredExportDetected: detectStructuredExportSuffix(rawLine),
    structuredExportParsed: Boolean(structuredExport),
    mojibakeCorrected,
    lookupKey: isToken ? normalizeName(`${inputName} ${tokenDetails.join(" ")}`) : normalizeName(inputName),
    ...isToken ? {
      status: "found",
      isToken: true,
      tokenDetails,
      tokenColors,
      rarities: ["common"],
      nonSecretRarities: ["common"]
    } : {}
  };
}
function parsePullList(text) {
  const { customer, cardLines } = parseCustomerAndCards(text);
  const normalizedCardLines = normalizeCopiedTableLines(cardLines);
  const grouped = /* @__PURE__ */ new Map();
  const diagnostics = { structuredExportRowsDetected: 0, structuredExportRowsParsed: 0, importedPrintingHints: 0, mojibakeCorrections: 0 };
  normalizedCardLines.forEach((line, index) => {
    const item = parseCardLine(line, index);
    if (!item) return;
    if (item.structuredExportDetected) diagnostics.structuredExportRowsDetected += 1;
    if (item.structuredExportParsed) {
      diagnostics.structuredExportRowsParsed += 1;
      diagnostics.importedPrintingHints += 1;
    }
    if (item.mojibakeCorrected) diagnostics.mojibakeCorrections += 1;
    const hint = item.requestedPrinting;
    const groupKey = hint?.sourceFormat === "set-collector-export" ? JSON.stringify([item.lookupKey, hint.setCode?.toLowerCase(), hint.collectorNumber?.toLowerCase(), hint.finish || "", hint.foilTreatment || ""]) : item.lookupKey;
    const existing = grouped.get(groupKey);
    if (existing) {
      existing.quantity += item.quantity;
      existing.originals.push(item.original);
      existing.statedRarities = Array.from(/* @__PURE__ */ new Set([...existing.statedRarities, ...item.statedRarities]));
      existing.specialRequests = mergeSpecialRequests(existing.specialRequests, item.specialRequests);
      existing.requestedPrinting = mergeRequestedPrinting(existing.requestedPrinting, item.requestedPrinting);
      existing.tokenDetails = Array.from(/* @__PURE__ */ new Set([...existing.tokenDetails || [], ...item.tokenDetails || []]));
      existing.tokenColors = Array.from(/* @__PURE__ */ new Set([...existing.tokenColors || [], ...item.tokenColors || []]));
      existing.presetStatus = existing.presetStatus || item.presetStatus;
      existing.note = existing.note || item.note;
      return;
    }
    grouped.set(groupKey, { ...item, originals: [item.original] });
  });
  return { customer, cards: Array.from(grouped.values()), cardLineCount: normalizedCardLines.length, diagnostics };
}
function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
function runtimeEnv(name) {
  return typeof process !== "undefined" ? process.env?.[name] || "" : "";
}
function isServerRuntime() {
  return typeof window === "undefined";
}
function defaultMtgjsonManifestUrl() {
  if (typeof window !== "undefined") {
    const isLocalhost = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
    const origin = isLocalhost ? PRODUCTION_ORIGIN : window.location.origin;
    return `${origin}/api/mtgjson-index`;
  }
  return new URL("/api/mtgjson-index", runtimeEnv("FORMATTER_BASE_URL") || PRODUCTION_ORIGIN).toString();
}
function scryfallRequestHeaders(headersInit) {
  const headers = new Headers(headersInit || {});
  if (isServerRuntime() && !headers.has("user-agent")) {
    headers.set("user-agent", "rrg-pull-list-formatter/0.5.2");
  }
  return headers;
}
function mtgjsonAliasKey(value) {
  const normalized = normalizeName(value);
  const compact = compactName(value);
  return [normalized, compact].filter(Boolean);
}
function chooseExactMtgjsonCandidate(index, inputName, cardKeys) {
  const inputNormalized = normalizeName(inputName);
  const inputCompact = compactName(inputName);
  const matches = cardKeys.map((cardKey) => index.cards?.[cardKey] || null).filter(Boolean).filter((card) => normalizeName(card.name) === inputNormalized || compactName(card.name) === inputCompact || normalizeName(card.asciiName || "") === inputNormalized || compactName(card.asciiName || "") === inputCompact);
  return matches.length === 1 ? matches[0] : null;
}
function findMtgjsonCard(index, inputName) {
  if (!index?.cards) return null;
  for (const key of mtgjsonAliasKey(inputName)) {
    if (index.ambiguousAliases?.[key]?.length) {
      const card2 = chooseExactMtgjsonCandidate(index, inputName, index.ambiguousAliases[key]);
      return card2 ? { card: card2, ambiguous: false } : { card: null, ambiguous: true };
    }
    const cardKey = index.aliases?.[key];
    const card = cardKey ? index.cards[cardKey] : chooseExactMtgjsonCandidate(index, inputName, [key]);
    if (card) return { card, ambiguous: false };
  }
  return null;
}
function mtgjsonCardRarities(card, safePaper = false) {
  if (safePaper) return Array.from(new Set((card.paperRarities || []).map(parseRarity).filter(Boolean)));
  const sourceRarities = card.nonSecretRarities?.length ? card.nonSecretRarities : card.rarities || [];
  return Array.from(new Set(sourceRarities.map((rarity) => parseRarity(rarity)).filter(Boolean)));
}
function mtgjsonCardShape(card, item, paperVerified) {
  const rarity = item.statedRarities?.[0] || mtgjsonCardRarities(card)[0] || "";
  return {
    name: card.name,
    rarity,
    type_line: card.type || card.types?.join(" ") || "",
    games: paperVerified ? ["paper"] : [],
    digital: !paperVerified,
    set_type: "mtgjson",
    scryfall_oracle_id: card.scryfallOracleId || "",
    mtgjson: card
  };
}
function resolveItemWithMtgjsonCard(item, card, index) {
  const paperVerified = index.version === 3 && card.hasPlayablePaperPrinting === true;
  const localRarityVerified = hasSufficientLocalPaperEvidence(card, index);
  const inputRarities = item.statedRarities?.length ? item.statedRarities : [];
  const providerRarities = mtgjsonCardRarities(card, localRarityVerified);
  const rarities = providerRarities.length ? providerRarities : inputRarities;
  return {
    ...item,
    card: mtgjsonCardShape(card, item, paperVerified),
    status: "found",
    lookupSource: "mtgjson",
    raritySource: inputRarities.length ? "input" : providerRarities.length ? "mtgjson" : "",
    isBasicLand: BASIC_LAND_NAMES.has(card.name),
    correction: normalizeName(card.name) !== normalizeName(item.inputName),
    rarities,
    nonSecretRarities: rarities,
    eligibleRarityChecked: Boolean(rarities.length),
    mtgjsonCard: card,
    localPaperVerified: paperVerified,
    localRarityVerified,
    rarityEvidence: localRarityVerified ? "current-index" : "legacy-index",
    legacyRarities: localRarityVerified ? void 0 : providerRarities,
    requestedFlavor: ![card.name, card.asciiName].filter(Boolean).some((name) => compactName(name) === compactName(item.inputName))
  };
}
async function resolveExactWithMtgjson(items, setMessage, options) {
  if (!items.length) return { resolved: [], missing: items };
  if (options.performance) options.performance.stage = "index";
  const recordDiagnostics = (diagnostics2) => {
    if (!options.performance) return;
    options.performance.indexSource = diagnostics2.source;
    options.performance.indexFailureStage = diagnostics2.failureStage;
    options.performance.stages.manifest += diagnostics2.manifestMs;
    options.performance.stages.indexLoad += diagnostics2.indexLoadMs;
    options.performance.stages.indexParseValidation += diagnostics2.indexParseValidationMs;
    countPerformance(options.performance, "manifestRequests", diagnostics2.manifestRequests);
    countPerformance(options.performance, "indexRequests", diagnostics2.indexRequests);
    countPerformance(options.performance, "indexCacheHits", diagnostics2.cacheHits);
    options.performance.stage = "mtgjsonLookup";
  };
  let loaded;
  try {
    loaded = await loadMtgjsonResolutionIndex(options.mtgjsonManifestUrl || defaultMtgjsonManifestUrl(), { signal: options.signal, onProgress: setMessage });
  } catch (error) {
    if (error?.diagnostics) recordDiagnostics(error.diagnostics);
    throw error;
  }
  const { index, diagnostics } = loaded;
  recordDiagnostics(diagnostics);
  recordResolutionIndexReadiness(options.performance, index);
  const lookupStarted = processingNow();
  const resolved = [];
  const missing = [];
  for (const item of items) {
    const result = findMtgjsonCard(index, item.inputName);
    if (result?.ambiguous) {
      countPerformance(options.performance, "ambiguousMatches");
      missing.push({ ...item, enrichmentReason: "mtgjson-ambiguous", note: "Ambiguous MTGJSON exact match" });
      continue;
    }
    if (!result?.card) {
      countPerformance(options.performance, "mtgjsonMisses");
      missing.push({ ...item, enrichmentReason: "mtgjson-miss" });
      continue;
    }
    countPerformance(options.performance, "mtgjsonMatches");
    const local = resolveItemWithMtgjsonCard(item, result.card, index);
    if (!local.localRarityVerified && !local.requestedFlavor && !hasSpecialPrintRequest(local) && options.enrichmentPurpose !== "case-check" && options.enrichmentPurpose !== "pricing-recovery") {
      local.legacyIndexCompatibility = true;
      if (options.performance) options.performance.legacyIndexCompatibilityMode = true;
      if (options.useScryfall === false) {
        resolved.push({ ...local, status: "review", lessVerified: true, note: "Card-name index requires refresh; paper identity not verified (Scryfall disabled)." });
      } else {
        missing.push({ ...local, status: "missing", mtgjsonExactName: result.card.name, enrichmentReason: "legacy-index-compatibility" });
      }
      continue;
    }
    const decision = requiresScryfallEnrichment(local, options);
    if (decision.required && options.useScryfall !== false) {
      missing.push({ ...local, status: "missing", mtgjsonExactName: result.card.name, enrichmentReason: decision.reason });
    } else resolved.push(local);
  }
  const guarded = guardBulkExactMisses(items, resolved, missing, options);
  if (options.performance) options.performance.stages.mtgjsonLookup += processingNow() - lookupStarted;
  if (guarded) {
    setMessage(BULK_MISS_GUARD_MESSAGE);
    return guarded;
  }
  setMessage(`MTGJSON matched ${resolved.length} cards ready locally; ${missing.length} need further verification.`);
  if (missing.some((item) => item.legacyIndexCompatibility)) setMessage("Card-name index is outdated. Using compatibility verification.");
  return { resolved, missing };
}
var BULK_MISS_MINIMUM_NAMES = 20;
var BULK_MISS_RATIO_THRESHOLD = 0.6;
var BULK_MISS_EXPORT_EVIDENCE_RATIO = 0.6;
function guardBulkExactMisses(items, resolved, missing, options) {
  const ordinary = (item) => !item.isToken && !item.isBasicLand && !BASIC_LAND_NAMES.has(item.inputName) && !item.requestedFlavor && !hasSpecialPrintRequest(item);
  const ordinaryNames = new Set(items.filter(ordinary).map((item) => normalizeName(item.inputName)));
  const missingNames = /* @__PURE__ */ new Map();
  for (const item of missing) {
    if (item.enrichmentReason !== "mtgjson-miss" || !ordinary(item)) continue;
    const key = normalizeName(item.inputName);
    missingNames.set(key, [...missingNames.get(key) || [], item]);
  }
  const exactMissRatio = ordinaryNames.size ? missingNames.size / ordinaryNames.size : null;
  if (options.performance) options.performance.exactMissRatio = exactMissRatio;
  if (options.useScryfall === false || options.enrichmentPurpose === "pricing-recovery" || ordinaryNames.size < BULK_MISS_MINIMUM_NAMES || !(exactMissRatio > BULK_MISS_RATIO_THRESHOLD)) return null;
  const hasExportEvidence = (item) => item.requestedPrinting?.sourceFormat === "set-collector-export" || [item.original, ...item.originals || []].some((line) => typeof line === "string" && detectStructuredExportSuffix(line));
  const exportMisses = [...missingNames.values()].filter((entries) => entries.some(hasExportEvidence)).length;
  if (exportMisses / missingNames.size < BULK_MISS_EXPORT_EVIDENCE_RATIO) return null;
  const blocked = missing.filter((item) => item.enrichmentReason === "mtgjson-miss" && ordinary(item));
  const blockedItems = new Set(blocked);
  if (options.performance) options.performance.bulkMissGuardTriggered = true;
  countPerformance(options.performance, "fuzzyLookupsPrevented", missingNames.size);
  return {
    resolved: [...resolved, ...blocked.map((item) => ({
      ...item,
      status: "review",
      bulkMissGuarded: true,
      lessVerified: true,
      enrichmentReason: "bulk-exact-miss-guard",
      note: "Most exact card names failed. Check the pasted export format before reprocessing."
    }))],
    missing: missing.filter((item) => !blockedItems.has(item))
  };
}
var scryfallFlights = /* @__PURE__ */ new Map();
function evictScryfallResponse(url, options = {}) {
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(cacheKeyForRequest(url, options));
  } catch {
  }
}
function normalizedScryfallResponse(url, data, context, countDropped = false) {
  const type = context.requestType || scryfallRequestCounter(url);
  if (type === "scryfallExact" || type === "scryfallFuzzy") return normalizeScryfallCard(data);
  if (type === "scryfallCollection" || type === "scryfallPrintPages") {
    if (!Array.isArray(data?.data) || data.has_more !== void 0 && typeof data.has_more !== "boolean" || data.has_more && (!safeScryfallUrl(data.next_page) || data.next_page === url)) return null;
    const cards = data.data.map(normalizeScryfallCard).filter((card) => card && (type !== "scryfallPrintPages" || Array.isArray(card.games) && Boolean(parseRarity(card.rarity)) && (Boolean(card.type_line) || card.card_faces?.some((face) => Boolean(face.type_line)))));
    const dropped = data.data.length - cards.length;
    if (countDropped && dropped && context.providerRun) countMalformedRecords(context.providerRun, dropped);
    if (!cards.length && (data.data.length || type === "scryfallPrintPages")) return null;
    return { ...data, data: cards };
  }
  if (type === "scryfallSets") return Array.isArray(data?.data) && data.data.every((set) => set && typeof set.code === "string") ? data : null;
  return Number.isFinite(data?.total_cards) && data.total_cards >= 0 ? data : null;
}
function safeScryfallUrl(value) {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.origin === "https://api.scryfall.com" && !url.username && !url.password;
  } catch {
    return false;
  }
}
function scryfallRequestCounter(url) {
  const parsed = new URL(url);
  if (parsed.pathname.endsWith("/collection")) return "scryfallCollection";
  if (parsed.pathname.endsWith("/named")) return parsed.searchParams.has("exact") ? "scryfallExact" : "scryfallFuzzy";
  if (parsed.pathname.endsWith("/sets")) return "scryfallSets";
  if (parsed.searchParams.get("unique") === "prints" || parsed.searchParams.has("order") || /oracleid|oracle_id|!"/.test(parsed.searchParams.get("q") || "")) return "scryfallPrintPages";
  return "scryfallSearch";
}
async function fetchJsonWithRetry(url, options = {}, attempts = SCRYFALL_MAX_ATTEMPTS, context = {}) {
  context = providerContext(context);
  throwIfAborted(context.signal);
  const cached = readCachedResponse(url, options);
  const normalizedCache = cached && normalizedScryfallResponse(url, cached.data, context);
  if (cached && normalizedCache) {
    countPerformance(context.performance, "scryfallCacheHits");
    return { ...cached, data: normalizedCache };
  }
  if (cached) evictScryfallResponse(url, options);
  const stopped = providerCircuitFailure(context.providerRun, context.requestType || scryfallRequestCounter(url));
  if (stopped) return { ok: false, status: 0, data: null, failure: stopped };
  const key = cacheKeyForRequest(url, options);
  const existing = scryfallFlights.get(key)?.find((entry2) => entry2.signal === context.signal && entry2.run === context.providerRun);
  if (existing) {
    countPerformance(context.performance, "scryfallCacheHits");
    return existing.promise;
  }
  const entry = { signal: context.signal, run: context.providerRun, promise: fetchJsonAttempts(url, options, Math.min(attempts, SCRYFALL_MAX_ATTEMPTS), context) };
  scryfallFlights.set(key, [...scryfallFlights.get(key) || [], entry]);
  try {
    return await entry.promise;
  } finally {
    const remaining = (scryfallFlights.get(key) || []).filter((item) => item !== entry);
    if (remaining.length) scryfallFlights.set(key, remaining);
    else scryfallFlights.delete(key);
  }
}
async function fetchJsonAttempts(url, options, attempts, context) {
  const run = context.providerRun;
  const operation = context.requestType || scryfallRequestCounter(url);
  const retryableStatuses = /* @__PURE__ */ new Set([408, 425, 500, 502, 503, 504]);
  let failure = { kind: "network", retryable: true, operation, attemptCount: 0 };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    let timedOut = false;
    let responseStatus;
    let timeout;
    try {
      throwIfAborted(context.signal);
      if (!await waitForScryfallSlot(context)) return { ok: false, status: 0, data: null, failure: providerCircuitFailure(run, operation) };
      throwIfAborted(context.signal);
      context.signal?.addEventListener("abort", abort, { once: true });
      run.controller.signal.addEventListener("abort", abort, { once: true });
      recordProviderAttempt(run, operation, attempt);
      const remaining = remainingProviderMs(run);
      const deadline = new Promise((_, reject) => {
        const cancel = () => reject(new DOMException("Request interrupted.", "AbortError"));
        controller.signal.addEventListener("abort", cancel, { once: true });
        timeout = setTimeout(() => {
          timedOut = true;
          if (remaining <= SCRYFALL_REQUEST_TIMEOUT_MS) openScryfallCircuit(run, "time_budget");
          controller.abort();
        }, Math.min(SCRYFALL_REQUEST_TIMEOUT_MS, remaining));
      });
      const response = await Promise.race([fetch(url, {
        ...options,
        headers: scryfallRequestHeaders(options.headers),
        signal: controller.signal
      }).then(async (response2) => {
        responseStatus = response2.status;
        return {
          ok: response2.ok,
          status: response2.status,
          headers: response2.headers,
          data: response2.ok ? await response2.json() : null
        };
      }), deadline]);
      clearTimeout(timeout);
      if (!response.ok) {
        failure = {
          kind: response.status === 403 ? "forbidden" : response.status === 429 ? "rate-limited" : "http-status",
          status: response.status,
          retryable: retryableStatuses.has(response.status),
          operation,
          attemptCount: attempt,
          ...response.status === 429 ? { retryAfterMs: retryAfterDuration(response.headers.get("Retry-After"), run.now()) } : {}
        };
      } else {
        const normalized = normalizedScryfallResponse(url, response.data, context, true);
        if (normalized) {
          recordProviderSuccess(run);
          const result = { ok: true, status: response.status, data: normalized };
          writeCachedResponse(url, options, result);
          return result;
        }
        failure = { kind: response.data?.has_more && response.data.next_page === url ? "pagination-loop" : "invalid-response", status: response.status, retryable: false, operation, attemptCount: attempt };
      }
    } catch (error) {
      if (context.signal?.aborted) recordProviderFailure(run, { kind: "canceled", retryable: false, operation, attemptCount: attempt });
      throwIfAborted(context.signal);
      const stopped = providerCircuitFailure(run, operation);
      if (stopped) return { ok: false, status: 0, data: null, failure: { ...stopped, attemptCount: attempt } };
      const kind = timedOut ? "timeout" : error instanceof SyntaxError ? "malformed-json" : "network";
      failure = { kind, ...responseStatus ? { status: responseStatus } : {}, retryable: kind === "timeout" || kind === "network", operation, attemptCount: attempt };
    } finally {
      clearTimeout(timeout);
      context.signal?.removeEventListener("abort", abort);
      run.controller.signal.removeEventListener("abort", abort);
    }
    recordProviderFailure(run, failure);
    if (!failure.retryable || attempt === attempts || providerCircuitFailure(run, operation)) break;
    const backoff = Math.min(1500, 400 * 2 ** (attempt - 1) * (0.75 + run.random() * 0.5));
    if (!await waitForProvider(run, backoff, context.signal)) break;
  }
  return { ok: false, status: failure.status || 0, data: null, failure };
}
async function fetchCollection(items, context) {
  const result = await fetchJsonWithRetry(SCRYFALL_COLLECTION_URL, {
    method: "POST",
    headers: {
      Accept: "application/json;q=0.9,*/*;q=0.8",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      identifiers: items.map((item) => ({ name: item.mtgjsonExactName || item.inputName }))
    })
  }, SCRYFALL_MAX_ATTEMPTS, context);
  return result;
}
function normalizeScryfallCard(card) {
  if (!card || typeof card !== "object" || Array.isArray(card) || typeof card.name !== "string" || !card.name) return null;
  const normalized = { ...card };
  for (const key of ["flavor_name", "type_line", "oracle_text", "printed_name", "printed_type_line", "printed_text", "flavor_text"]) {
    if (normalized[key] === null) normalized[key] = "";
    if (normalized[key] !== void 0 && typeof normalized[key] !== "string") return null;
  }
  for (const key of ["frame_effects", "promo_types"]) if (normalized[key] === null) normalized[key] = [];
  if (["id", "oracle_id", "rarity", "set", "set_name", "set_type", "prints_search_uri", "collector_number", "released_at", "border_color", "frame"].some((key) => normalized[key] !== void 0 && typeof normalized[key] !== "string")) return null;
  if (["digital", "booster", "foil", "nonfoil", "full_art", "promo"].some((key) => normalized[key] !== void 0 && typeof normalized[key] !== "boolean")) return null;
  if (["games", "finishes", "frame_effects", "promo_types"].some((key) => normalized[key] !== void 0 && (!Array.isArray(normalized[key]) || normalized[key].some((value) => typeof value !== "string")))) return null;
  if (normalized.prices !== void 0 && normalized.prices !== null && (typeof normalized.prices !== "object" || Array.isArray(normalized.prices) || Object.values(normalized.prices).some((price) => price !== null && typeof price !== "string"))) return null;
  if (normalized.card_faces === null) normalized.card_faces = [];
  if (normalized.card_faces !== void 0) {
    if (!Array.isArray(normalized.card_faces)) return null;
    normalized.card_faces = normalized.card_faces.map((face) => {
      if (!face || typeof face !== "object" || Array.isArray(face)) return null;
      const copy = { ...face };
      for (const key of ["name", "flavor_name", "type_line", "oracle_text", "mana_cost", "printed_name", "printed_text", "flavor_text"]) {
        if (copy[key] === null) copy[key] = "";
        if (copy[key] !== void 0 && typeof copy[key] !== "string") return null;
      }
      return copy;
    });
    if (normalized.card_faces.some((face) => !face)) return null;
  }
  return normalized;
}
async function fetchNamedCardResult(name, mode = "fuzzy", context = {}) {
  const params = new URLSearchParams({ [mode]: name });
  const result = await fetchJsonWithRetry(`${SCRYFALL_NAMED_URL}?${params.toString()}`, {
    headers: { Accept: "application/json;q=0.9,*/*;q=0.8" }
  }, SCRYFALL_MAX_ATTEMPTS, context);
  return result;
}
async function hasAmbiguousPlayableName(inputName, context = {}) {
  const normalized = normalizeName(inputName);
  const words = normalized.split(" ").filter(Boolean);
  if (words.length !== 1 || normalized.length < 4) return false;
  const params = new URLSearchParams({
    q: `name:${inputName} game:paper -type:card -type:token -type:emblem`,
    unique: "cards"
  });
  const result = await fetchJsonWithRetry(`${SCRYFALL_SEARCH_URL}?${params.toString()}`, {
    headers: { Accept: "application/json;q=0.9,*/*;q=0.8" }
  }, 2, context);
  if (!result.ok) return result.status !== 404;
  const totalCards = result.data?.total_cards;
  return !Number.isFinite(totalCards) || totalCards > 1;
}
async function isAmbiguousFuzzyMatch(inputName, card, context = {}) {
  if (!card) return false;
  if (compactName(inputName) === compactName(card.name)) return false;
  return hasAmbiguousPlayableName(inputName, context);
}
function isPlayablePaperCard(card) {
  if (!card || card.digital) return false;
  if (!Array.isArray(card.games) || !card.games.includes("paper")) return false;
  const typeLine = card.type_line || card.card_faces?.map((face) => face.type_line || "").join(" // ");
  if (!typeLine) return false;
  if (card.set_type === "memorabilia" || card.set_type === "token") return false;
  if (/\b(Card|Emblem|Token)\b/i.test(typeLine)) return false;
  return true;
}
function isSecretLairPrint(print) {
  return /^sl[dupc]?$/i.test(print?.set || "") || /\bsecret\s+lair\b/i.test(print?.set_name || "");
}
function isPlayerRewardPrint(print) {
  return /\bplayer\s+rewards?\b/i.test(print?.set_name || "") || /^mpr$/i.test(print?.set || "");
}
function isEligibleRarityPrint(print) {
  if (!isPlayablePaperCard(print)) return false;
  if (isSecretLairPrint(print) || isPlayerRewardPrint(print)) return false;
  if (print.booster) return true;
  return print.set_type === "commander";
}
function priceValue(print) {
  return Number(print?.prices?.usd || 0);
}
function isCasePricePrint(print) {
  if (!print || print.digital) return false;
  if (isSecretLairPrint(print) || isPlayerRewardPrint(print)) return false;
  if (print.set_type === "promo" || print.set_type === "memorabilia" || print.set_type === "token") return false;
  return Boolean(print.prices?.usd);
}
function isLandCard(cardOrPrint) {
  return /\bLand\b/i.test(cardOrPrint?.type_line || "");
}
async function fetchRecentCaseSets(options = {}) {
  const result = await fetchJsonWithRetry(SCRYFALL_SETS_URL, {
    headers: { Accept: "application/json;q=0.9,*/*;q=0.8" }
  }, SCRYFALL_MAX_ATTEMPTS, providerContext(options));
  if (!result.ok || !Array.isArray(result.data?.data)) return Object.assign([], { lookupFailed: true });
  const today = /* @__PURE__ */ new Date();
  today.setHours(23, 59, 59, 999);
  return (result.data.data || []).filter((set) => set && !set.digital).filter((set) => CASE_RELEVANT_SET_TYPES.has(set.set_type)).filter((set) => set.released_at && /* @__PURE__ */ new Date(`${set.released_at}T00:00:00`) <= today).sort((a, b) => new Date(b.released_at).getTime() - new Date(a.released_at).getTime()).slice(0, RECENT_CASE_SET_COUNT).map((set, index) => ({ code: set.code, index, name: set.name }));
}
function isCaseStapleCard(item) {
  return [item.card?.name, item.mtgjsonCard?.name, item.inputName].filter(Boolean).some((name) => CASE_STAPLE_CARD_NAMES.has(normalizeName(name)));
}
function caseNoteForItem(item, recentSets) {
  const prints = item.prints || [];
  if (!prints.length) return "";
  const recentIndexByCode = new Map(recentSets.map((set) => [set.code, set.index]));
  const highRecentPrint = prints.find((print) => {
    const setIndex = recentIndexByCode.get(print.set);
    return setIndex !== void 0 && setIndex < CHECK_CASE_RECENT_SET_COUNT && (print.rarity === "rare" || print.rarity === "mythic") && isEligibleRarityPrint(print);
  });
  if (highRecentPrint) return "CHECK CASE";
  if (isCaseStapleCard(item)) return "CASE?";
  const casePricePrints = prints.filter(isCasePricePrint);
  const midRecentPricePrint = casePricePrints.find((print) => {
    const setIndex = recentIndexByCode.get(print.set);
    return setIndex !== void 0 && setIndex >= CHECK_CASE_RECENT_SET_COUNT && setIndex < RECENT_CASE_SET_COUNT && priceValue(print) >= 5;
  });
  const highAnyPrint = casePricePrints.find((print) => priceValue(print) >= 50);
  const landCasePrint = casePricePrints.find((print) => isLandCard(print) && priceValue(print) >= 10);
  if (midRecentPricePrint || highAnyPrint || landCasePrint) return "CASE?";
  return "";
}
function hasPlayablePaperPrint(prints) {
  return (prints || []).some((print) => isPlayablePaperCard(print));
}
async function fetchPrintFacts(card, context) {
  context = providerContext(context);
  let started = false;
  const prints = [];
  const failedFacts = (failure) => {
    countPerformance(context.performance, started ? "printHistoryCardsFailed" : failure.kind === "circuit-open" || failure.kind === "phase-budget-exhausted" ? "printHistoryCardsSkippedAfterCircuit" : "printHistoryCardsFailed");
    return {
      rarities: [card?.rarity].filter(Boolean),
      nonSecretRarities: [card?.rarity].filter(Boolean),
      hasFullArt: prints.some((print) => print.full_art) || Boolean(card?.full_art),
      prints: prints.length ? prints : [card].filter(Boolean),
      eligibleRarityChecked: false,
      printLookupFailed: true,
      providerFailure: failure,
      historyProcessingStarted: started
    };
  };
  const structuralFailure = (kind) => ({ kind, retryable: false, operation: "scryfallPrintPages", attemptCount: 0 });
  if (!safeScryfallUrl(card?.prints_search_uri)) {
    return failedFacts(providerCircuitFailure(context.providerRun) || structuralFailure("invalid-response"));
  }
  let nextUrl = card.prints_search_uri;
  const visited = /* @__PURE__ */ new Set();
  while (nextUrl) {
    if (typeof nextUrl !== "string" || visited.has(nextUrl) || visited.size >= 100) {
      for (const url of visited) evictScryfallResponse(url);
      const failure = structuralFailure(visited.size >= 100 ? "pagination-limit" : "pagination-loop");
      recordProviderFailure(context.providerRun, failure);
      return failedFacts(failure);
    }
    visited.add(nextUrl);
    const result = await fetchJsonWithRetry(nextUrl, {
      headers: { Accept: "application/json;q=0.9,*/*;q=0.8" }
    }, SCRYFALL_MAX_ATTEMPTS, { ...context, requestType: "scryfallPrintPages" });
    if (!started && (result.ok || (result.failure?.attemptCount || 0) > 0)) {
      started = true;
      countPerformance(context.performance, "printHistoryCardsStarted");
    }
    if (!result.ok) return failedFacts(result.failure || structuralFailure("invalid-response"));
    const data = result.data;
    prints.push(...data.data || []);
    nextUrl = data.has_more ? data.next_page : "";
  }
  const usablePrints = prints.filter((print) => Array.isArray(print.games) && Boolean(parseRarity(print.rarity)));
  if (!usablePrints.length) {
    for (const url of visited) evictScryfallResponse(url);
    const failure = structuralFailure("invalid-response");
    recordProviderFailure(context.providerRun, failure);
    return failedFacts(failure);
  }
  const eligibleRarityPrints = usablePrints.filter(isEligibleRarityPrint);
  const rarityPrints = eligibleRarityPrints.length ? eligibleRarityPrints : usablePrints.filter((print) => isPlayablePaperCard(print) && !isSecretLairPrint(print) && !isPlayerRewardPrint(print) && print.set_type !== "promo");
  countPerformance(context.performance, "printHistoryCardsCompleted");
  return {
    rarities: Array.from(new Set(usablePrints.map((print) => print.rarity).filter(Boolean))),
    nonSecretRarities: Array.from(new Set(rarityPrints.map((print) => print.rarity).filter(Boolean))),
    hasFullArt: usablePrints.some((print) => print.full_art),
    prints: usablePrints,
    eligibleRarityChecked: true,
    historyProcessingStarted: started,
    rarityEvidence: "scryfall",
    printLookupFailed: false,
    providerFailure: void 0
  };
}
function mergeResolvedCards(batch, result) {
  const byName = /* @__PURE__ */ new Map();
  (result.data || []).forEach((card) => {
    byName.set(normalizeName(card.name), card);
  });
  return batch.map((item) => {
    if (item.presetStatus === "review") {
      return { ...item, status: "review" };
    }
    const card = byName.get(normalizeName(item.mtgjsonExactName || item.inputName));
    if (item.legacyIndexCompatibility) {
      const verified = card && isPlayablePaperCard(card) && item.legacyRarities?.length;
      return {
        ...item,
        // Keep the exact canonical MTGJSON identity and its lower-confidence history.
        card: card ? { ...card, name: item.mtgjsonExactName || item.card.name } : item.card,
        status: verified ? "found" : "review",
        paperIdentityVerified: Boolean(card && isPlayablePaperCard(card)),
        rarityEvidence: "legacy-index",
        lessVerified: true,
        note: verified ? "Paper identity verified; grouping uses legacy index rarity history." : card && !isPlayablePaperCard(card) ? "Not a playable paper card; card-name index requires refresh." : "Card-name index requires refresh; compatibility verification incomplete."
      };
    }
    if (card) {
      return {
        ...item,
        card,
        status: "found",
        isBasicLand: BASIC_LAND_NAMES.has(card.name),
        correction: card.name !== item.inputName
      };
    }
    return { ...item, status: "missing" };
  });
}
function resolveItemWithCard(item, card) {
  return {
    ...item,
    card,
    status: "found",
    isBasicLand: BASIC_LAND_NAMES.has(card.name),
    correction: normalizeName(card.name) !== normalizeName(item.inputName)
  };
}
async function resolveExactBatch(batch, batchNumber, setMessage, context) {
  setMessage(`Exact lookup batch ${batchNumber}...`);
  const result = await fetchCollection(batch, context);
  if (result.ok) return mergeResolvedCards(batch, result.data);
  return batch.map((item) => ({
    ...item,
    status: "review",
    providerFailure: result.failure,
    lessVerified: true,
    note: item.legacyIndexCompatibility ? "Card-name index requires refresh; compatibility verification unavailable. Reprocess Needs Review later." : "Scryfall verification unavailable. Reprocess Needs Review later."
  }));
}
function rarityBucket(item) {
  const eligiblePrintRarities = item.nonSecretRarities?.length ? item.nonSecretRarities : item.eligibleRarityChecked ? [] : [item.card?.rarity].filter(Boolean);
  const compatibleStatedRarities = (item.statedRarities || []).filter((rarity) => eligiblePrintRarities.includes(rarity));
  const printRarities = compatibleStatedRarities.length ? compatibleStatedRarities : eligiblePrintRarities;
  const rarities = new Set([
    ...printRarities
  ].filter(Boolean));
  const hasHigh = rarities.has("rare") || rarities.has("mythic");
  const hasLow = rarities.has("common") || rarities.has("uncommon");
  if (hasHigh && hasLow) return "both";
  if (hasHigh) return "high";
  return "low";
}
function displayName(item) {
  return item.card?.name || item.inputName;
}
function alternateTitleNote(item) {
  return item.alternateTitle ? ` (${item.alternateTitle})` : "";
}
function tokenDetailsNote(item) {
  return item.tokenDetails?.length ? ` (${item.tokenDetails.join(", ")})` : "";
}
function sortByName(a, b) {
  return displayName(a).localeCompare(displayName(b), void 0, { sensitivity: "base" });
}
function sortBasicLands(a, b) {
  return BASIC_LAND_ORDER.indexOf(displayName(a)) - BASIC_LAND_ORDER.indexOf(displayName(b));
}
function sortItemsForOutput(items) {
  const found = items.filter((item) => item.status === "found");
  const needsReview = items.filter((item) => item.status !== "found").sort(sortByName);
  const tokens = found.filter((item) => item.isToken).sort(sortByName);
  const basics = found.filter((item) => item.isBasicLand).sort(sortBasicLands);
  const nonBasics = found.filter((item) => !item.isBasicLand && !item.isToken);
  const high = nonBasics.filter((item) => rarityBucket(item) === "high").sort(sortByName);
  const both = nonBasics.filter((item) => rarityBucket(item) === "both").sort(sortByName);
  const low = nonBasics.filter((item) => rarityBucket(item) === "low").sort(sortByName);
  return [...high, ...both, ...low, ...tokens, ...basics, ...needsReview];
}
function outputDisplayName(item) {
  return displayName(item);
}
function formatCardLine(item, useCheckboxes) {
  const specialNote = specialRequestNote(item);
  const caseNote = item.caseNote ? ` - ${item.caseNote}` : "";
  const reviewNote = item.status !== "found" && item.note ? ` (${item.note})` : "";
  return `${useCheckboxes ? "[ ] " : ""}${item.quantity} ${displayName(item)}${alternateTitleNote(item)}${tokenDetailsNote(item)}${specialNote}${caseNote}${reviewNote}`;
}
function formatContactLine(customer) {
  const normalized = customerContactText(customer);
  if (!normalized) return "";
  if (/^facebook$/i.test(normalized)) return "(Facebook)";
  return normalized;
}
function formatCustomerName(name) {
  return name.trim().split(/\s+/).map((word) => word.toLowerCase().replace(/(^|[-'])([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`)).join(" ");
}
function formatTimestamp(value) {
  const date = value ? new Date(value) : /* @__PURE__ */ new Date();
  return new Intl.DateTimeFormat(void 0, {
    timeZone: "America/Chicago",
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}
function isBoundaryNameCandidate(item, cardLineCount) {
  if (!item || item.status === "found") return false;
  if (item.card || item.lookupSource || item.mtgjsonCard) return false;
  if (item.quantity !== 1 || item.statedRarities?.length || item.specialRequests?.length) return false;
  if (item.index > 1 && item.index < cardLineCount - 2) return false;
  const words = item.inputName.trim().split(/\s+/);
  if (words.length < 2 || words.length > 5) return false;
  if (/\d|@|[!?]/.test(item.inputName)) return false;
  return words.every((word) => /^[A-Za-z.'-]+$/.test(word));
}
function isBoundaryNameFragment(item, expectedIndex) {
  if (!item || item.status === "found" || item.index !== expectedIndex) return false;
  if (item.card || item.lookupSource || item.mtgjsonCard) return false;
  if (item.quantity !== 1 || item.statedRarities?.length || item.specialRequests?.length) return false;
  if (/\d|@|[!?]/.test(item.inputName)) return false;
  return /^[A-Za-z.'-]+$/.test(item.inputName.trim());
}
function inferBoundaryCustomer(customer, items, cardLineCount) {
  if (customer.name) return { customer, items };
  if (!items.some((item) => item.status === "found")) return { customer, items };
  const candidate = items.find((item) => isBoundaryNameCandidate(item, cardLineCount));
  if (candidate) {
    return {
      customer: { ...customer, name: candidate.inputName },
      items: items.filter((item) => item !== candidate)
    };
  }
  const firstName = items.find((item) => isBoundaryNameFragment(item, 0));
  const firstLast = items.find((item) => isBoundaryNameFragment(item, 1));
  if (firstName && firstLast) {
    return {
      customer: { ...customer, name: `${firstName.inputName} ${firstLast.inputName}` },
      items: items.filter((item) => item !== firstName && item !== firstLast)
    };
  }
  const lastName = items.find((item) => isBoundaryNameFragment(item, cardLineCount - 2));
  const lastLast = items.find((item) => isBoundaryNameFragment(item, cardLineCount - 1));
  if (lastName && lastLast) {
    return {
      customer: { ...customer, name: `${lastName.inputName} ${lastLast.inputName}` },
      items: items.filter((item) => item !== lastName && item !== lastLast)
    };
  }
  return { customer, items };
}
function formatOutput(customer, items, useCheckboxes, processedAt) {
  const found = items.filter((item) => item.status === "found");
  const needsReview = items.filter((item) => item.status !== "found");
  const tokens = found.filter((item) => item.isToken).sort(sortByName);
  const basics = found.filter((item) => item.isBasicLand).sort(sortBasicLands);
  const nonBasics = found.filter((item) => !item.isBasicLand && !item.isToken);
  const high = nonBasics.filter((item) => rarityBucket(item) === "high").sort(sortByName);
  const both = nonBasics.filter((item) => rarityBucket(item) === "both").sort(sortByName);
  const low = nonBasics.filter((item) => rarityBucket(item) === "low").sort(sortByName);
  const lines = [BUFFER_MARKER, "", "", ""];
  if (customer.name) {
    lines.push(formatCustomerName(customer.name));
  } else {
    lines.push("NAME:");
    lines.push("");
  }
  if (customerContactText(customer)) {
    lines.push(formatContactLine(customer));
  } else {
    lines.push("CONTACT:");
    lines.push("");
  }
  lines.push(`Printed: ${formatTimestamp(processedAt)}`);
  lines.push("");
  if (high.length) {
    lines.push("=== Mythic/Rare ===");
    high.forEach((item) => lines.push(formatCardLine(item, useCheckboxes)));
  }
  if (both.length) {
    if (lines.at(-1) !== "") lines.push("");
    lines.push("=== Rarity Shifted ===");
    both.forEach((item) => lines.push(formatCardLine(item, useCheckboxes)));
  }
  if (low.length) {
    if (lines.at(-1) !== "") lines.push("");
    lines.push("=== Uncommon/Common ===");
    low.forEach((item) => lines.push(formatCardLine(item, useCheckboxes)));
  }
  if (tokens.length) {
    if (lines.at(-1) !== "") lines.push("");
    lines.push("=== Tokens ===");
    tokens.forEach((item) => lines.push(formatCardLine(item, useCheckboxes)));
  }
  if (basics.length) {
    if (lines.at(-1) !== "") lines.push("");
    lines.push("=== Basic Lands ===");
    basics.forEach((item) => lines.push(formatCardLine(item, useCheckboxes)));
  }
  if (needsReview.length) {
    if (lines.at(-1) !== "") lines.push("");
    lines.push("=== NEEDS REVIEW ===");
    needsReview.sort(sortByName).forEach((item) => lines.push(formatCardLine(item, useCheckboxes)));
  }
  lines.push("", "", "", "", "", BUFFER_MARKER);
  return lines.join("\n");
}
function safeFileName(customer, processedAtValue) {
  const base = customer.name ? formatCustomerName(customer.name) : "pull-list";
  const date = processedAtValue ? new Date(processedAtValue) : /* @__PURE__ */ new Date();
  const datePart = [
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    String(date.getFullYear()).slice(-2)
  ].join("-");
  const namePart = base.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "pull-list";
  return `${namePart}-${datePart}.txt`;
}
async function enrichResolvedItem(item, caseCheck, recentCaseSets, providerOptions = {}) {
  if (item.status !== "found") return item;
  if (item.isToken) {
    return {
      ...item,
      rarities: ["common"],
      nonSecretRarities: ["common"],
      hasFullArt: false,
      specialRequestFound: !hasSpecialPrintRequest(item),
      caseNote: "",
      alternateTitle: "",
      tokenDetails: item.tokenDetails || [],
      tokenColors: item.tokenColors || [],
      printLookupFailed: false
    };
  }
  if (item.isBasicLand && !hasSpecialPrintRequest(item)) {
    return {
      ...item,
      rarities: ["common"],
      nonSecretRarities: ["common"],
      hasFullArt: Boolean(item.card?.full_art),
      specialRequestFound: !hasSpecialPrintRequest(item),
      caseNote: "",
      alternateTitle: ""
    };
  }
  const decision = requiresScryfallEnrichment(item, providerOptions);
  if (!decision.required && !item.prints?.length) {
    return { ...item, caseNote: caseCheck ? caseNoteForItem(item, recentCaseSets) : "" };
  }
  if (decision.required && providerOptions.useScryfall === false) {
    if (!item.localRarityVerified || hasSpecialPrintRequest(item) || caseCheck) {
      return {
        ...item,
        status: "review",
        note: item.note || "Scryfall disabled; paper rarity or requested printing not verified"
      };
    }
    return {
      ...item,
      caseNote: "",
      alternateTitle: "",
      lessVerified: true
    };
  }
  let itemForFacts = item;
  if (decision.required && !item.card?.prints_search_uri) {
    const exactResult = await fetchNamedCardResult(item.card?.name || item.inputName, "exact", providerOptions);
    if (exactResult.ok) {
      itemForFacts = {
        ...resolveItemWithCard(item, exactResult.data),
        lookupSource: "mtgjson+scryfall",
        mtgjsonCard: item.mtgjsonCard
      };
    } else {
      if (exactResult.failure?.attemptCount === 0 && ["circuit-open", "phase-budget-exhausted"].includes(exactResult.failure.kind)) {
        countPerformance(providerOptions.performance, "printHistoryCardsSkippedAfterCircuit");
      }
      return {
        ...item,
        printLookupFailed: true,
        providerFailure: exactResult.failure
      };
    }
  }
  const facts = decision.required ? await fetchPrintFacts(itemForFacts.card, providerOptions) : itemForFacts;
  const enrichedItem = { ...itemForFacts, ...facts };
  const notPlayablePaper = !facts.printLookupFailed && !hasPlayablePaperPrint(facts.prints);
  const specialRequestMissing = hasSpecialPrintRequest(item) && !facts.printLookupFailed && !facts.prints?.some((print) => printMatchesSpecialRequests(print, item));
  const ambiguousNonPlayable = notPlayablePaper && providerOptions.useScryfall !== false && await hasAmbiguousPlayableName(item.inputName, providerOptions);
  return {
    ...enrichedItem,
    status: specialRequestMissing || notPlayablePaper ? "review" : item.status,
    caseNote: caseCheck ? caseNoteForItem(enrichedItem, recentCaseSets) : "",
    alternateTitle: requestedFlavorName(item, facts.prints),
    note: specialRequestMissing ? specialRequestReviewNote(item) : notPlayablePaper ? ambiguousNonPlayable ? "Ambiguous card name" : "Not a playable paper card" : itemForFacts.note
  };
}
async function safelyEnrichResolvedItem(item, caseCheck, recentCaseSets, providerOptions) {
  try {
    return await enrichResolvedItem(item, caseCheck, recentCaseSets, providerOptions);
  } catch (error) {
    throwIfAborted(providerOptions.signal);
    if (error?.name === "AbortError") throw error;
    const failure = { kind: "invalid-response", retryable: false, operation: "scryfallPrintPages", attemptCount: 0 };
    if (providerOptions.providerRun) recordProviderFailure(providerOptions.providerRun, failure);
    return { ...item, printLookupFailed: true, enrichmentFailed: true, providerFailure: failure };
  }
}
async function resolveCardNames(items, setMessage, carefulMode, providerOptions = {}) {
  providerOptions = providerContext(providerOptions, carefulMode);
  throwIfAborted(providerOptions.signal);
  const report = providerOptions.performance;
  const useMtgjson = providerOptions.useMtgjson !== false;
  const useScryfall = providerOptions.useScryfall !== false;
  items = items.map((item) => item.status === "missing" ? {
    ...item,
    providerFailure: void 0,
    printLookupFailed: false,
    enrichmentFailed: false,
    bulkMissGuarded: false,
    printHistoryRetried: false,
    paperIdentityVerified: false,
    localPaperVerified: false,
    localRarityVerified: false,
    legacyIndexCompatibility: false,
    legacyRarities: void 0,
    rarityEvidence: void 0,
    prints: void 0,
    eligibleRarityChecked: false
  } : item);
  items = items.map((item) => BASIC_LAND_NAMES.has(item.inputName) && !hasSpecialPrintRequest(item) ? { ...item, status: "found", isBasicLand: true, card: { name: item.inputName, rarity: "common" } } : item);
  const firstPass = items.filter((item) => item.status === "found" || item.status === "review");
  let lookupItems = items.filter((item) => item.status !== "found" && item.status !== "review");
  const order = new Map(items.map((item, index) => [item.index, index]));
  const ordered = (values) => values.sort((a, b) => Number(order.get(a.index)) - Number(order.get(b.index)));
  if (useMtgjson && lookupItems.length) {
    try {
      const mtgjsonResolved = await resolveExactWithMtgjson(lookupItems, setMessage, {
        ...providerOptions,
        useScryfall
      });
      firstPass.push(...mtgjsonResolved.resolved);
      lookupItems = mtgjsonResolved.missing;
    } catch (error) {
      throwIfAborted(providerOptions.signal);
      if (error?.name === "AbortError") throw error;
      setMessage(`MTGJSON index unavailable; ${useScryfall ? "falling back to Scryfall" : "unable to verify exact names"}.`);
      if (!useScryfall) {
        firstPass.push(...lookupItems.map((item) => ({
          ...item,
          status: "review",
          note: "MTGJSON unavailable and Scryfall disabled"
        })));
        lookupItems = [];
      }
    }
  }
  for (const item of [...firstPass, ...lookupItems]) {
    const decision = requiresScryfallEnrichment(item, providerOptions);
    countPerformance(report, decision.required && useScryfall ? "remoteCards" : "skippedCards");
    if (decision.required && useScryfall) countPerformance(report, "logicalRemoteCards");
    if (report) report.reasons[decision.reason] = (report.reasons[decision.reason] || 0) + 1;
  }
  if (!useScryfall) {
    firstPass.push(...lookupItems.map((item) => ({
      ...item,
      status: "review",
      note: item.note || "No MTGJSON exact match; Scryfall disabled"
    })));
    return ordered(firstPass);
  }
  const exactBatches = chunk(lookupItems, BATCH_SIZE);
  const exactStarted = processingNow();
  if (report && exactBatches.length) report.stage = "scryfall-exact";
  for (const [batchIndex, batch] of exactBatches.entries()) {
    firstPass.push(...await resolveExactBatch(batch, batchIndex + 1, setMessage, providerOptions));
  }
  if (report) report.stages.scryfallExactBatch += processingNow() - exactStarted;
  const fuzzyResolved = [];
  const fuzzyStarted = processingNow();
  for (const item of firstPass) {
    if (item.status === "found" || item.status === "review") {
      fuzzyResolved.push(item);
      continue;
    }
    setMessage(`Trying fuzzy match for "${item.inputName}"...`);
    if (report) report.stage = "scryfall-fuzzy";
    const fuzzyResult = await fetchNamedCardResult(item.inputName, "fuzzy", providerOptions);
    const card = fuzzyResult.ok ? fuzzyResult.data : null;
    const ambiguous = card && await isAmbiguousFuzzyMatch(item.inputName, card, providerOptions);
    fuzzyResolved.push(
      card && !ambiguous ? resolveItemWithCard(item, card) : {
        ...item,
        status: "review",
        providerFailure: fuzzyResult.failure,
        note: ambiguous ? "Ambiguous card name" : item.note ? item.note.includes("not a playable paper card") ? "Not a playable paper card" : fuzzyResult.status && fuzzyResult.status !== 404 ? `${item.note}; fuzzy lookup failed (${fuzzyResult.status})` : `${item.note}; no fuzzy Scryfall match` : fuzzyResult.status && fuzzyResult.status !== 404 ? `Fuzzy lookup failed (${fuzzyResult.status})` : "No Scryfall match"
      }
    );
  }
  if (report) report.stages.scryfallFuzzy += processingNow() - fuzzyStarted;
  return ordered(fuzzyResolved);
}
async function enrichPrintHistories(items, caseCheck, recentCaseSets, setMessage, carefulMode, providerOptions = {}) {
  providerOptions = providerContext(providerOptions, carefulMode);
  providerOptions = { ...providerOptions, enrichmentPurpose: caseCheck ? "case-check" : providerOptions.enrichmentPurpose || "formatter" };
  throwIfAborted(providerOptions.signal);
  const started = processingNow();
  const report = providerOptions.performance;
  if (report) report.stage = "print-history";
  let withRarities = [...items];
  const concurrency = carefulMode ? 1 : PRINT_FACT_CONCURRENCY;
  const remote = [];
  for (const [index, item] of items.entries()) {
    if (providerOptions.useScryfall !== false && requiresScryfallEnrichment(item, providerOptions).required) {
      remote.push({ item, index });
    } else {
      withRarities[index] = await safelyEnrichResolvedItem(item, caseCheck, recentCaseSets, providerOptions);
    }
  }
  const printGroups = chunk(remote, concurrency);
  for (const [groupIndex, group] of printGroups.entries()) {
    const starting = groupIndex * concurrency + 1;
    const ending = starting + group.length - 1;
    setMessage(`Verifying Scryfall exceptions ${starting}-${ending} of ${remote.length}...`);
    await Promise.all(group.map(async ({ item, index }) => {
      withRarities[index] = await safelyEnrichResolvedItem(item, caseCheck, recentCaseSets, providerOptions);
    }));
  }
  if (report) report.stages.printHistory += processingNow() - started;
  return withRarities.map((item) => item.printLookupFailed && (!item.localRarityVerified || hasSpecialPrintRequest(item) || item.requestedFlavor || item.enrichmentFailed || caseCheck) || caseCheck && recentCaseSets.lookupFailed && !item.isBasicLand && !item.isToken ? { ...item, status: "review", note: item.note || "Paper rarity or requested printing not verified; retry needed" } : item);
}
function reliabilityMessage(items, options = {}) {
  const notes = [];
  const fallbackCount = items.filter((item) => item.status === "found" && item.printLookupFailed).length;
  if (options.useScryfall === false) notes.push("Scryfall off: output is less verified.");
  if (items.some((item) => item.legacyIndexCompatibility)) notes.push("Card-name index is outdated. Using compatibility verification.");
  if (items.some((item) => item.status === "found" && item.rarityEvidence === "legacy-index")) notes.push("Paper identities verified; rarity grouping uses lower-confidence legacy index evidence.");
  if (options.performance?.providerCircuitState === "open") notes.push("Scryfall verification stopped after repeated failures. Affected cards were placed in Needs Review.");
  if (fallbackCount) notes.push(`${fallbackCount} card${fallbackCount === 1 ? "" : "s"} used fallback rarity.`);
  return notes.join(" ");
}
function compactFormatterItems(items) {
  return items.map((item) => ({
    index: item.index,
    quantity: item.quantity,
    inputName: item.inputName,
    status: item.status,
    isBasicLand: Boolean(item.isBasicLand),
    isToken: Boolean(item.isToken),
    alternateTitle: item.alternateTitle || "",
    requestedDisplayName: item.requestedDisplayName || "",
    requestedPrinting: item.requestedPrinting || void 0,
    statedRarities: Array.isArray(item.statedRarities) ? item.statedRarities : [],
    specialRequests: Array.isArray(item.specialRequests) ? item.specialRequests : [],
    nonSecretRarities: Array.isArray(item.nonSecretRarities) ? item.nonSecretRarities : [],
    eligibleRarityChecked: Boolean(item.eligibleRarityChecked),
    tokenDetails: Array.isArray(item.tokenDetails) ? item.tokenDetails : [],
    caseNote: item.caseNote || "",
    note: item.note || "",
    printLookupFailed: Boolean(item.printLookupFailed),
    rarityEvidence: ["current-index", "legacy-index", "scryfall"].includes(item.rarityEvidence) ? item.rarityEvidence : void 0,
    legacyIndexCompatibility: Boolean(item.legacyIndexCompatibility),
    paperIdentityVerified: Boolean(item.paperIdentityVerified),
    lessVerified: Boolean(item.lessVerified),
    card: item.card?.name ? { name: item.card.name } : void 0,
    mtgjsonCard: item.mtgjsonCard?.name ? { name: item.mtgjsonCard.name } : void 0
  }));
}
async function processPullListText(text, options = {}) {
  const {
    useCheckboxes = true,
    caseCheck = false,
    carefulMode = false,
    useMtgjson = true,
    useScryfall = true,
    mtgjsonManifestUrl = "",
    processedAt = (/* @__PURE__ */ new Date()).toISOString(),
    setMessage = () => {
    }
  } = options;
  const performance2 = createProcessingPerformance();
  const parseStarted = processingNow();
  const parsed = parsePullList(text);
  recordParsingPerformance(performance2, parsed.diagnostics);
  performance2.stages.parse = processingNow() - parseStarted;
  const providerOptions = { useMtgjson, useScryfall, mtgjsonManifestUrl, enrichmentPurpose: caseCheck ? "case-check" : "formatter", signal: options.signal || null, performance: performance2, minIntervalMs: carefulMode ? 500 : 120 };
  try {
    const fuzzyResolved = await resolveCardNames(parsed.cards, setMessage, carefulMode, providerOptions);
    let recentCaseSets = [];
    if (caseCheck && useScryfall) {
      setMessage("Checking recent set list for case rules...");
      performance2.stage = "case-sets";
      const setsStarted = processingNow();
      recentCaseSets = await fetchRecentCaseSets(providerOptions);
      performance2.stages.caseSets = processingNow() - setsStarted;
    }
    const withRarities = await enrichPrintHistories(fuzzyResolved, caseCheck && useScryfall, recentCaseSets, setMessage, carefulMode, providerOptions);
    const inferred = inferBoundaryCustomer(parsed.customer, withRarities, parsed.cardLineCount);
    const output = formatOutput(inferred.customer, inferred.items, useCheckboxes, processedAt);
    performance2.stage = "ready";
    return {
      parsed,
      customer: inferred.customer,
      items: inferred.items,
      processedAt,
      output,
      performance: finishProcessingPerformance(performance2),
      reliabilityNote: reliabilityMessage(inferred.items, providerOptions)
    };
  } catch (error) {
    finishProcessingPerformance(performance2, error?.name === "AbortError" ? "canceled" : "failed");
    throw error;
  }
}
export {
  beginScryfallRun,
  clearMtgjsonIndexCache,
  compactFormatterItems,
  createSampleList,
  createScryfallRunContext,
  detectStructuredExportSuffix,
  endScryfallRun,
  enrichPrintHistories,
  fetchRecentCaseSets,
  formatOutput,
  inferBoundaryCustomer,
  outputDisplayName,
  parsePullList,
  parseStructuredExportLine,
  prefetchMtgjsonIndex,
  processPullListText,
  providerCircuitFailure,
  reliabilityMessage,
  repairMojibake,
  requiresScryfallEnrichment,
  resolveCardNames,
  safeFileName,
  sortItemsForOutput
};

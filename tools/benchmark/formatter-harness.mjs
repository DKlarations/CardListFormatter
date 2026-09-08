import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { buildSync } from "esbuild";

export const BASELINE_COMMIT = "49ae9a77fa420888dc540af3492b2f87a4d15589";
export const MANIFEST_URL = "https://formatter.test/api/mtgjson-index";
export const INDEX_URL = "https://index.test/resolution-v3-20260907T120000Z.json";
const PROCESSED_AT = "2026-09-07T12:00:00.000Z";
const EPOCH = new Date(PROCESSED_AT).getTime();
const realSetImmediate = globalThis.setImmediate;
const sourceByRevision = new Map();
let moduleSequence = 0;

export const ordinaryNames = [
  "Lightning Bolt", "Counterspell", "Sol Ring", "Llanowar Elves", "Arcane Signet",
  "Brainstorm", "Ponder", "Preordain", "Swords to Plowshares", "Path to Exile",
  "Cultivate", "Kodama's Reach", "Sakura-Tribe Elder", "Eternal Witness", "Nature's Lore",
  "Farseek", "Opt", "Consider", "Negate", "Rampant Growth", "Terminate", "Putrefy",
  "Mortify", "Abrade", "Beast Within", "Chaos Warp", "Harmonize", "Read the Bones",
  "Faithless Looting", "Sign in Blood",
];

const extraNames = ["Ajani, Mentor of Heroes", "Death-Greeter's Champion", "Dazzling Theater // Prop Room", "Gather the Townsfolk", "Gather Courage", "Misty Rainforest", "Island", "Umezawa's Jitte"];
const normalize = (name) => name.toLowerCase().replace(/[^a-z0-9/ ]/g, "").replace(/\s+/g, " ").trim();

export function createFixture(overrides = {}) {
  const names = [...ordinaryNames, ...extraNames];
  const cards = {};
  const aliases = {};
  const providerCards = new Map();
  names.forEach((name, index) => {
    const key = normalize(name);
    const rarities = name === "Ponder" ? ["uncommon", "rare"] : name.startsWith("Ajani") ? ["rare"] : ["uncommon"];
    cards[key] = {
      name, type: name === "Misty Rainforest" ? "Land" : "Creature", types: ["Creature"],
      rarities, nonSecretRarities: rarities, paperRarities: rarities,
      hasPlayablePaperPrinting: true,
    };
    aliases[key] = key;
    aliases[key.replace(/ /g, "")] = key;
    providerCards.set(name, {
      id: `printing-${index}`, oracle_id: `fixture-${index}`, name,
      prints_search_uri: `https://api.scryfall.com/cards/search?unique=prints&q=oracleid%3Afixture-${index}`,
      games: ["paper"], digital: false, type_line: cards[key].type,
      set: name.startsWith("Ajani") ? "new" : "old", set_name: "Fixture Set", set_type: "expansion",
      released_at: "2026-08-01", rarity: rarities[0], booster: true,
      finishes: ["nonfoil", "foil", "etched"], foil: true, nonfoil: true,
      frame_effects: ["showcase"], border_color: "borderless", full_art: true,
      prices: { usd: name === "Sol Ring" ? "55.00" : name === "Misty Rainforest" ? "15.00" : "1.00" },
    });
  });
  return {
    text: ordinaryNames.join("\n"), caseCheck: false, carefulMode: false,
    index: { version: 3, rarityHistoryComplete: true, generatedAt: PROCESSED_AT, cards, aliases, ambiguousAliases: { gather: [normalize("Gather the Townsfolk"), normalize("Gather Courage")] } },
    providerCards,
    fuzzy: { "Ligtning Bolt": "Lightning Bolt", "Sakra-Tribe Elder": "Sakura-Tribe Elder", Gather: "Gather the Townsfolk" },
    latency: { manifest: 40, index: 180, scryfall: 80 },
    ...overrides,
  };
}

export function mixedFixture() {
  return createFixture({ text: [
    "2 Sol Ring", "Sol Ring", "Ponder, U", '"Ajani, Mentor of Heroes", R, 2',
    "Death-Greeter's Champion - Rare", "Dazzling Theater // Prop Room",
    "Kodama's Reach", "Ligtning Bolt", "Sakra-Tribe Elder", "Gather",
    "Arcane Signet FOIL", "Counterspell SHOWCASE", "Brainstorm BORDERLESS",
    "2 Goblin Token", "Island",
  ].join("\n") });
}

class VirtualClock {
  now = 0;
  sequence = 0;
  timers = new Map();
  setTimeout = (callback, delay = 0, ...args) => {
    const id = ++this.sequence;
    this.timers.set(id, { at: this.now + Math.max(0, Number(delay) || 0), callback: () => callback(...args) });
    return id;
  };
  clearTimeout = (id) => this.timers.delete(id);
  async run(work) {
    let done = false;
    let value;
    let error;
    Promise.resolve().then(work).then((result) => { value = result; done = true; }, (reason) => { error = reason; done = true; });
    for (let turns = 0; !done; turns += 1) {
      // A real event-loop turn drains nested Promise continuations before the next virtual timer.
      await new Promise(realSetImmediate);
      if (done) break;
      assert.ok(turns < 100_000, "Virtual operation stalled or exceeded its bounded event budget");
      const next = [...this.timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) continue;
      this.timers.delete(next[0]);
      this.now = next[1].at;
      next[1].callback();
    }
    if (error) throw error;
    return value;
  }
}

export class MemoryCacheStorage {
  stores = new Map();
  async open(name) {
    if (!this.stores.has(name)) this.stores.set(name, new Map());
    const entries = this.stores.get(name);
    const key = (request) => typeof request === "string" ? request : request.url;
    return {
      match: async (request) => entries.get(key(request))?.clone(),
      put: async (request, response) => { entries.set(key(request), response.clone()); },
      delete: async (request) => entries.delete(key(request)),
      keys: async () => [...entries.keys()].map((url) => new Request(url)),
    };
  }
  async keys() { return [...this.stores.keys()]; }
  async delete(name) { return this.stores.delete(name); }
  corrupt() {
    for (const entries of this.stores.values()) {
      for (const [url, response] of entries) entries.set(url, new Response("{invalid JSON", { headers: response.headers }));
    }
  }
}

export async function importFormatter(revision = "current") {
  if (!sourceByRevision.has(revision)) {
    sourceByRevision.set(revision, revision === "baseline"
      ? execFileSync("git", ["show", `${BASELINE_COMMIT}:server/generated/server-formatter.mjs`], { encoding: "utf8", maxBuffer: 10_000_000 })
      : buildSync({ entryPoints: ["src/formatter.ts"], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" }).outputFiles[0].text);
  }
  // A distinct module instance prevents previous runs' gates/in-flight caches affecting results.
  return import(`data:text/javascript;base64,${Buffer.from(`${sourceByRevision.get(revision)}\n// fixture instance ${++moduleSequence}`).toString("base64")}`);
}

export async function withHarness(fixture, work, { revision = "current", cacheStorage = new MemoryCacheStorage() } = {}) {
  const clock = new VirtualClock();
  const counters = { manifest: 0, index: 0, collection: 0, exact: 0, fuzzy: 0, search: 0, history: 0, sets: 0, cacheHits: 0, retries: 0 };
  const requests = [];
  const storage = new Map();
  let active = 0;
  let maxActive = 0;
  const original = new Map();
  const install = (key, value) => {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  };
  const NativeDate = Date;
  class ClockDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [EPOCH + clock.now])); }
    static now() { return EPOCH + clock.now; }
  }
  install("Date", ClockDate);
  install("performance", { now: () => clock.now });
  install("setTimeout", clock.setTimeout);
  install("clearTimeout", clock.clearTimeout);
  install("window", { location: { hostname: "formatter.test", origin: "https://formatter.test" } });
  install("caches", cacheStorage);
  install("localStorage", {
    getItem: (key) => { const value = storage.get(key); if (value) counters.cacheHits += 1; return value ?? null; },
    setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key), clear: () => storage.clear(),
  });
  let transientUsed = false;
  const respond = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  install("fetch", async (input, options = {}) => {
    const url = new URL(typeof input === "string" ? input : input.url);
    const type = url.origin === "https://formatter.test" ? "manifest"
      : url.origin === "https://index.test" ? "index"
        : url.hostname === "api.scryfall.com" && url.pathname === "/cards/collection" ? "collection"
          : url.hostname === "api.scryfall.com" && url.pathname === "/cards/named" ? (url.searchParams.has("exact") ? "exact" : "fuzzy")
            : url.hostname === "api.scryfall.com" && url.pathname === "/sets" ? "sets"
              : url.hostname === "api.scryfall.com" && url.pathname === "/cards/search" ? (url.searchParams.get("unique") === "prints" ? "history" : "search") : null;
    assert.ok(type, `Unexpected provider boundary: ${url.origin}${url.pathname}`);
    counters[type] += 1;
    const names = type === "collection" ? JSON.parse(options.body).identifiers.map(({ name }) => name)
      : type === "exact" || type === "fuzzy" ? [url.searchParams.get(type)] : [];
    const request = { type, at: clock.now, names, query: url.searchParams.get("q") || "" };
    requests.push(request);
    if (!["manifest", "index"].includes(type)) { active += 1; maxActive = Math.max(maxActive, active); }
    await new Promise((resolve) => setTimeout(resolve, fixture.latency[type] ?? fixture.latency.scryfall));
    if (!["manifest", "index"].includes(type)) active -= 1;
    if (options.signal?.aborted) throw new DOMException("Fixture aborted", "AbortError");
    if ((type === "manifest" && fixture.manifestFailure) || (type === "index" && fixture.indexFailure)) return respond({}, 503);
    if (type === "manifest") return respond({ version: 3, indexVersion: 3, indexUrl: "https://index.test/resolution-latest.json", versionedUrl: INDEX_URL });
    if (type === "index") return respond(fixture.index);
    if (fixture.scryfallFailure) return respond({}, 503);
    if (type === "history" && fixture.historyFailure) return respond({}, 503);
    if (fixture.transient && !transientUsed) { transientUsed = true; counters.retries += 1; return respond({}, 503); }
    if (type === "sets") return respond({ data: [
      { code: "new", name: "Newest", set_type: "expansion", released_at: "2026-08-01", digital: false },
      { code: "mid", name: "Middle", set_type: "expansion", released_at: "2026-06-01", digital: false },
      { code: "old", name: "Older", set_type: "expansion", released_at: "2026-04-01", digital: false },
    ] });
    if (type === "collection") return respond({ data: names.map((name) => fixture.providerCards.get(name)).filter(Boolean) });
    if (type === "exact" || type === "fuzzy") {
      const name = type === "fuzzy" ? fixture.fuzzy[names[0]] || names[0] : names[0];
      const card = fixture.providerCards.get(name);
      return card ? respond(card) : respond({}, 404);
    }
    if (type === "search") return respond({ total_cards: 2, data: [] });
    const card = [...fixture.providerCards.values()].find((candidate) => url.searchParams.get("q") === `oracleid:${candidate.oracle_id}`);
    assert.ok(card, "Every print-history request must identify a known fixture card");
    request.names = [card.name];
    const page = Number(url.searchParams.get("page") || 1);
    const print = page === 2 && card.name === "Ponder" ? { ...card, rarity: "rare" } : card;
    return respond({ data: [print], has_more: page === 1, ...(page === 1 ? { next_page: `${card.prints_search_uri}&page=2` } : {}) });
  });
  try {
    const formatter = await importFormatter(revision);
    const snapshot = () => ({ ...counters });
    const format = async (options = {}) => {
      const before = snapshot();
      const start = clock.now;
      const firstRequest = requests.length;
      const parsed = formatter.parsePullList(fixture.text);
      const providerOptions = {
        useMtgjson: true, useScryfall: true, mtgjsonManifestUrl: MANIFEST_URL,
        ...(revision === "baseline" ? { pricingMode: true } : {
          enrichmentPurpose: fixture.caseCheck ? "case-check" : "formatter",
          signal: null, minIntervalMs: fixture.carefulMode ? 500 : 120,
        }), ...options,
      };
      formatter.beginScryfallRun(null, fixture.carefulMode);
      try {
        const recent = fixture.caseCheck ? await formatter.fetchRecentCaseSets(revision === "baseline" ? undefined : providerOptions) : [];
        const resolved = await formatter.resolveCardNames(parsed.cards, () => {}, fixture.carefulMode, providerOptions);
        const items = await formatter.enrichPrintHistories(resolved, fixture.caseCheck, recent, () => {}, fixture.carefulMode, providerOptions);
        const counts = Object.fromEntries(Object.entries(counters).map(([key, value]) => [key, value - before[key]]));
        const runRequests = requests.slice(firstRequest);
        const remoteNames = new Set(runRequests.filter(({ type }) => !["manifest", "index", "sets"].includes(type)).flatMap(({ names }) => names));
        const remoteItems = items.filter((item) => remoteNames.has(item.inputName) || remoteNames.has(item.card?.name)).length;
        return { durationMs: clock.now - start, counts, items, output: formatter.formatOutput(parsed.customer, items, true, PROCESSED_AT),
          requests: runRequests, cardsResolvedLocally: items.filter((item) => item.lookupSource === "mtgjson" && !remoteNames.has(item.card?.name)).length,
          cardsRequiringRemote: remoteItems, maxConcurrentRequests: maxActive };
      } finally { formatter.endScryfallRun(); }
    };
    return await clock.run(() => work({ formatter, fixture, format, clock, counters, requests, storage, cacheStorage }));
  } finally {
    for (const [key, descriptor] of original) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}

export function remoteRequestCount(result) {
  return ["collection", "exact", "fuzzy", "search", "history", "sets"].reduce((sum, key) => sum + result.counts[key], 0);
}

export function assertPacing(result, interval = 120) {
  const starts = result.requests.filter(({ type }) => !["manifest", "index"].includes(type)).map(({ at }) => at);
  for (let index = 1; index < starts.length; index += 1) assert.ok(starts[index] - starts[index - 1] >= interval,
    `Scryfall requests ${index} and ${index + 1} started ${starts[index] - starts[index - 1]}ms apart; minimum ${interval}ms`);
}

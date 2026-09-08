import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { strToU8, zipSync } from "fflate";
import { fileURLToPath } from "node:url";
import { importBundledModule } from "./test-module-bundle.mjs";

const schema = await importBundledModule("src/mtgjson-resolution-index.ts", "resolution-schema");
const bundledBuilder = await build({
  entryPoints: [fileURLToPath(new URL("../api/refresh-mtgjson-index.ts", import.meta.url))],
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
  plugins: [{
    name: "forbid-blob-writes",
    setup(builder) {
      builder.onResolve({ filter: /^@vercel\/blob$/ }, () => ({ path: "blob", namespace: "test" }));
      builder.onLoad({ filter: /.*/, namespace: "test" }, () => ({ contents: "export function put() { throw new Error('Blob writes forbidden in generator tests'); }" }));
    },
  }],
});
const { buildCardIndexFromMtgjsonPayload, buildCardIndexFromSetFiles } = await import(`data:text/javascript;base64,${Buffer.from(bundledBuilder.outputFiles[0].text).toString("base64")}`);

const currentMeta = { version: "5.2.2", date: "2026-09-07" };
const allPrintingsUrl = "https://mtgjson.example/AllPrintings.json.zip";
function card(name, rarity = "common", extra = {}) {
  return { name, rarity, availability: ["paper"], type: "Creature — Wizard", types: ["Creature"], layout: "normal", boosterTypes: ["draft"], ...extra };
}
function set(code, cards, extra = {}) {
  return { code, name: `Set ${code}`, type: "expansion", isOnlineOnly: false, cards, ...extra };
}
function buildIndex(data, meta = currentMeta) {
  return buildCardIndexFromMtgjsonPayload({ meta, data }, allPrintingsUrl);
}
function zipResponse(payload) {
  return new Response(zipSync({ "payload.json": strToU8(JSON.stringify(payload)) }));
}

test("resolution v3 establishes paper evidence and booster/commander rarity without promo shifts", () => {
  const index = buildIndex({
    AAA: set("AAA", [card("Ordinary Card"), card("Shifted Card"), card("Commander Card", "uncommon", { boosterTypes: undefined })]),
    BBB: set("BBB", [card("Ordinary Card", "rare", { boosterTypes: undefined }), card("Shifted Card", "rare")], { type: "starter" }),
    CMD: set("CMD", [card("Commander Card", "rare", { boosterTypes: undefined })], { type: "commander" }),
    SLD: set("SLD", [card("Ordinary Card", "mythic")], { type: "promo" }),
    MPR: set("MPR", [card("Ordinary Card", "rare")], { type: "promo" }),
  });
  assert.equal(index.version, 3);
  assert.equal(index.rarityHistoryComplete, true);
  assert.equal(schema.validateMtgjsonCardIndex(index), true);
  assert.deepEqual(index.cards["ordinary card"].paperRarities, ["common"]);
  assert.deepEqual(index.cards["shifted card"].paperRarities, ["common", "rare"]);
  assert.deepEqual(index.cards["commander card"].paperRarities, ["rare"]);
  assert.equal(schema.hasSufficientLocalPaperEvidence(index.cards["ordinary card"], index), true);
  assert.equal(Object.keys(index.cards["ordinary card"]).some((key) => key.startsWith("_")), false);
  assert.equal("prints" in index.cards["ordinary card"], false);
});

test("paper confidence rejects absent evidence and digital, token, emblem, art and memorabilia records", () => {
  const rejected = [
    card("Missing availability", "rare", { availability: undefined }),
    card("Empty availability", "rare", { availability: [] }),
    card("Digital availability", "rare", { availability: ["mtgo", "arena"] }),
    card("Online only", "rare", { isOnlineOnly: true }),
    card("Rebalanced", "rare", { isRebalanced: true }),
    card("Missing type", "rare", { type: undefined, types: [] }),
    card("A token", "rare", { type: "Token Creature — Wizard" }),
    card("An emblem", "rare", { type: "Emblem" }),
    card("An art object", "rare", { type: "Card" }),
    card("Token layout", "rare", { layout: "double_faced_token" }),
  ];
  const index = buildIndex({
    AAA: set("AAA", rejected),
    DIG: set("DIG", [card("Online set")], { isOnlineOnly: true }),
    MEM: set("MEM", [card("Memorabilia")], { type: "memorabilia" }),
    TOK: set("TOK", [card("Token set")], { type: "token" }),
    BAD: set("BAD", [card("Missing set type")], { type: "" }),
  });
  for (const value of Object.values(index.cards)) {
    assert.equal(value.hasPlayablePaperPrinting, false, value.name);
    assert.deepEqual(value.paperRarities, [], value.name);
    assert.deepEqual(value.nonSecretRarities, [], "Finalization never promotes all rarities into paper evidence");
    assert.equal(schema.hasSufficientLocalPaperEvidence(value, index), false);
  }
});

test("nonbooster paper fallback preserves ordinary rarities without treating promo-only cards as regular", () => {
  const index = buildIndex({
    DDD: set("DDD", [card("Duel Deck Only", "uncommon", { boosterTypes: undefined })], { type: "duel_deck" }),
    PRM: set("PRM", [card("Promo Only", "rare", { boosterTypes: undefined, isPromo: true })], { type: "promo" }),
    BAS: set("BAS", [card("Plains", "common", { type: "Basic Land — Plains", types: ["Land"], supertypes: ["Basic"] })]),
  });
  assert.deepEqual(index.cards["duel deck only"].paperRarities, ["uncommon"]);
  assert.equal(index.cards["promo only"].hasPlayablePaperPrinting, true);
  assert.deepEqual(index.cards["promo only"].paperRarities, []);
  assert.equal(index.cards.plains.hasPlayablePaperPrinting, true);
});

test("unknown eligible paper rarity does not silently inherit a nonbooster fallback rarity", () => {
  const index = buildIndex({
    AAA: set("AAA", [card("Special Rarity", "special")]),
    DDD: set("DDD", [card("Special Rarity", "rare", { boosterTypes: undefined })], { type: "duel_deck" }),
  });
  assert.equal(index.cards["special rarity"].hasPlayablePaperPrinting, true);
  assert.deepEqual(index.cards["special rarity"].paperRarities, []);
  assert.equal(schema.hasSufficientLocalPaperEvidence(index.cards["special rarity"], index), false);
});

test("AtomicCards, single-set and pre-booster-metadata inputs cannot claim complete rarity evidence", () => {
  const atomic = buildCardIndexFromMtgjsonPayload({ meta: currentMeta, data: { Example: [{ name: "Example", type: "Instant" }] } }, "https://mtgjson.example/AtomicCards.json.zip");
  assert.equal(atomic.rarityHistoryComplete, false);
  assert.equal(atomic.cards.example.hasPlayablePaperPrinting, false);
  const single = buildCardIndexFromMtgjsonPayload({ meta: currentMeta, data: set("AAA", [card("Example")]) }, "https://mtgjson.example/AAA.json.zip");
  assert.equal(single.rarityHistoryComplete, false);
  for (const meta of [{}, { version: "5.2.0" }]) {
    const old = buildIndex({ AAA: set("AAA", [card("Example")]) }, meta);
    assert.equal(old.rarityHistoryComplete, false);
    assert.equal(schema.hasSufficientLocalPaperEvidence(old.cards.example, old), false);
  }
});

test("set-file merging chooses the regular pool only after every set and keeps incomplete histories untrusted", async (t) => {
  const listUrl = "https://mtgjson.example/SetList.json.zip";
  const baseUrl = "https://mtgjson.example/sets";
  let failSecond = false;
  t.mock.method(globalThis, "fetch", async (url) => {
    if (url === listUrl) return zipResponse({ meta: currentMeta, data: [{ code: "AAA" }, { code: "BBB" }, { code: "DIG", isOnlineOnly: true }] });
    if (url === `${baseUrl}/AAA.json.zip`) return zipResponse({ meta: currentMeta, data: set("AAA", [card("Shared Card", "rare", { boosterTypes: undefined })], { type: "duel_deck" }) });
    if (url === `${baseUrl}/BBB.json.zip`) {
      if (failSecond) return new Response("Unavailable", { status: 503 });
      return zipResponse({ meta: currentMeta, data: set("BBB", [card("Shared Card", "common")]) });
    }
    throw new Error(`Unexpected test request: ${url}`);
  });
  const complete = await buildCardIndexFromSetFiles(listUrl, baseUrl);
  assert.equal(complete.rarityHistoryComplete, true);
  assert.deepEqual(complete.cards["shared card"].paperRarities, ["common"]);
  assert.equal(schema.validateMtgjsonCardIndex(complete), true);
  const limited = await buildCardIndexFromSetFiles(listUrl, baseUrl, 1);
  assert.equal(limited.rarityHistoryComplete, false);
  failSecond = true;
  const partial = await buildCardIndexFromSetFiles(listUrl, baseUrl);
  assert.equal(partial.rarityHistoryComplete, false);
  assert.equal(partial.source.mtgjsonMeta.failedSetCount, 1);
  assert.equal(schema.hasSufficientLocalPaperEvidence(partial.cards["shared card"], partial), false);
});

test("three or more shared face aliases remain ambiguous instead of reinstating an exact alias", () => {
  const index = buildIndex({ AAA: set("AAA", ["Alpha", "Beta", "Gamma", "Delta"].map((name) => card(`${name} // Rear`, "common", { faceName: "Shared Face" }))) });
  assert.equal(index.aliases["shared face"], undefined);
  assert.equal(index.aliases.sharedface, undefined);
  assert.equal(index.ambiguousAliases["shared face"].length, 4);
  assert.equal(schema.validateMtgjsonCardIndex(index), true);
});

test("legacy resolution indexes load as name hints without inheriting v3 paper confidence", () => {
  const current = buildIndex({ AAA: set("AAA", [card("Example")]) });
  for (const version of [undefined, 1, 2]) {
    const legacy = { ...current, version };
    assert.equal(schema.validateMtgjsonCardIndex(legacy), true);
    assert.equal(schema.hasSufficientLocalPaperEvidence(legacy.cards.example, legacy), false);
  }
  assert.equal(schema.validateMtgjsonCardIndex({ version: 2, cards: { example: { name: "Example", rarities: ["common"] } } }), true);
});

test("resolution index validation rejects corrupt fields, unsafe aliases and unknown schema versions", () => {
  const current = buildIndex({ AAA: set("AAA", [card("Example")]) });
  for (const corrupt of [
    null, [], { cards: [] }, { ...current, version: 4 }, { ...current, rarityHistoryComplete: undefined },
    { ...current, cards: { example: { ...current.cards.example, paperRarities: ["invalid"] } } },
    { ...current, cards: { example: { ...current.cards.example, hasPlayablePaperPrinting: false } } },
    { ...current, cards: { example: { ...current.cards.example, printings: "AAA" } } },
    { ...current, aliases: { example: "missing" } },
    { ...current, ambiguousAliases: { example: ["example", "example"] } },
  ]) assert.equal(schema.validateMtgjsonCardIndex(corrupt), false);
});

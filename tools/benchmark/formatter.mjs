import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { buildSync } from "esbuild";
import { BASELINE_COMMIT, createFixture, mixedFixture, withHarness, remoteRequestCount, assertPacing } from "./formatter-harness.mjs";

const scenarios = [
  ["ordinary cold (30)", () => createFixture()],
  ["ordinary warm reload (30)", () => createFixture(), "warm"],
  ["mixed (14 grouped)", mixedFixture],
  ["Case Check (3)", () => createFixture({ text: "Ajani, Mentor of Heroes\nSol Ring\nMisty Rainforest", caseCheck: true })],
  ["manifest unavailable", () => createFixture({ text: "Lightning Bolt\nCounterspell", manifestFailure: true })],
  ["index unavailable", () => createFixture({ text: "Lightning Bolt\nCounterspell", indexFailure: true })],
  ["Scryfall transient", () => createFixture({ text: "Sol Ring FOIL", transient: true })],
  ["corrupt cache", () => createFixture(), "corrupt"],
  ["stale cached fallback", () => createFixture(), "stale"],
];

console.log(`Offline formatter benchmark; actual baseline ${BASELINE_COMMIT}`);
console.log("Virtual latency: manifest 40ms, index 180ms, Scryfall 80ms; 120ms normal request gate; each history has two pages.");
const rows = [];
for (const [scenario, makeFixture, preparation] of scenarios) {
  const pair = [];
  for (const revision of ["baseline", "current"]) {
    const fixture = makeFixture();
    const result = await withHarness(fixture, async ({ format, formatter, storage, cacheStorage }) => {
      if (preparation) {
        await format();
        formatter.clearMtgjsonIndexCache();
        storage.clear();
        if (preparation === "corrupt") cacheStorage.corrupt();
        if (preparation === "stale") fixture.manifestFailure = true;
      }
      return format();
    }, { revision });
    assertPacing(result);
    pair.push(result);
    rows.push({ scenario, revision, ms: result.durationMs, manifest: result.counts.manifest, index: result.counts.index,
      collection: result.counts.collection, exact: result.counts.exact, fuzzy: result.counts.fuzzy,
      search: result.counts.search, history: result.counts.history, sets: result.counts.sets,
      cacheHits: result.counts.cacheHits, retries: result.counts.retries,
      localCards: result.cardsResolvedLocally, remoteCards: result.cardsRequiringRemote });
  }
  assert.equal(pair[1].output, pair[0].output, `${scenario}: printable output changed`);
  if (scenario.startsWith("ordinary")) {
    assert.equal(remoteRequestCount(pair[1]), 0);
    assert.ok(pair[1].durationMs <= pair[0].durationMs * 0.4, "Ordinary list must improve at least 60% without changing output");
  }
}
console.table(rows);

// This is an explicitly synthetic parse probe, never production timing evidence.
const example = createFixture().index;
const cards = {};
const aliases = {};
for (let index = 0; index < 35_000; index += 1) {
  const key = `fixture card ${index}`;
  cards[key] = { ...example.cards["lightning bolt"], name: `Fixture Card ${index}` };
  aliases[key] = key;
}
const bytes = JSON.stringify({ ...example, cards, aliases, ambiguousAliases: {} });
const validatorSource = buildSync({ entryPoints: ["src/mtgjson-resolution-index.ts"], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" }).outputFiles[0].text;
const { validateMtgjsonCardIndex } = await import(`data:text/javascript;base64,${Buffer.from(validatorSource).toString("base64")}`);
const samples = [];
for (let sample = 0; sample < 5; sample += 1) {
  const start = performance.now();
  const parsed = JSON.parse(bytes);
  assert.equal(validateMtgjsonCardIndex(parsed), true);
  samples.push(Number((performance.now() - start).toFixed(2)));
}
console.log(JSON.stringify({ syntheticParseProbe: { cards: 35_000, utf8Bytes: Buffer.byteLength(bytes), parseAndValidationMs: samples }, semanticOutputParity: "all scenarios passed" }));

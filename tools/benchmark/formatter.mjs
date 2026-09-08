import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { buildSync } from "esbuild";
import { BASELINE_COMMIT, RELIABILITY_BASELINE_COMMIT, createFixture, mixedFixture, productionShapeFixture, structuredExportFixture, withHarness, remoteRequestCount, assertPacing } from "./formatter-harness.mjs";

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

console.log(`Retry-control comparison; actual pre-correction baseline ${RELIABILITY_BASELINE_COMMIT}. All durations are simulated, not live performance claims.`);
const allOperations = ["collection", "exact", "fuzzy", "search", "history", "sets"];
const reliabilityScenarios = [
  ["118 current-v3 success", () => productionShapeFixture({ version: 3 })],
  ["118 legacy-v2 compatibility", () => productionShapeFixture()],
  ...[400, 403, 429, 500, 503, "timeout", "network", "malformed-json", "invalid-response"].map((kind) => [
    `118 legacy history ${kind}`, () => productionShapeFixture({ failure: { kind, retryAfter: 30 } }),
  ]),
  ["118 nullable valid history", () => productionShapeFixture({ nullableFields: true })],
  ...[403, 429, "timeout", "malformed-json"].map((kind) => [
    `118 provider-wide ${kind}`, () => productionShapeFixture({ failure: { kind, operations: allOperations } }),
  ]),
  ["115 true exceptions 503", () => productionShapeFixture({ exceptions: true, failure: { kind: 503 } })],
];
const reliabilityRows = [];
for (const [scenario, makeFixture] of reliabilityScenarios) {
  for (const revision of ["reliability-baseline", "current"]) {
    const result = await withHarness(makeFixture(), ({ format }) => format(), { revision });
    assertPacing(result);
    if (revision === "current") {
      assert.equal(result.items.length, 118);
      assert.equal(result.performance.outcome, "complete");
      assert.ok(result.durationMs <= 25_220, `${scenario}: formatter exceeded its phase budget plus 220ms mocked index load`);
      assert.ok(result.performance.providerElapsedMs <= 25_000, scenario);
      assert.ok(remoteRequestCount(result) <= 40, scenario);
      assert.equal(result.performance.counts.logicalCardRetries, 0, scenario);
      assert.equal(result.items.filter((item) => item.isBasicLand && item.status === "found").length, 3);
      if (scenario.includes("legacy history")) {
        assert.equal(result.items.filter((item) => item.inputName.startsWith("Reliability Fixture") && item.status === "found").length, 114);
        assert.equal(result.items.at(-1).status, "review");
        assert.ok(result.counts.history <= 2);
      }
      if (scenario.includes("provider-wide") || scenario.includes("true exceptions")) {
        assert.equal(result.performance.providerCircuitState, "open");
        assert.match(result.output, /NEEDS REVIEW/);
      }
    }
    reliabilityRows.push({ scenario, revision, simulatedMs: result.durationMs, requests: remoteRequestCount(result),
      collection: result.counts.collection, exact: result.counts.exact, fuzzy: result.counts.fuzzy, history: result.counts.history,
      historyCards: result.historyCardsStarted, genericRetries: result.performance.counts.retries,
      requestRetries: revision === "current" ? result.performance.counts.requestRetries : "mixed", logicalCardRetries: revision === "current" ? result.performance.counts.logicalCardRetries : "mixed",
      completed: result.items.filter((item) => item.status === "found").length, review: result.items.filter((item) => item.status === "review").length,
      circuit: revision === "current" ? result.performance.providerCircuitState : "not implemented" });
  }
}
console.table(reliabilityRows);

// This baseline was measured from the working retry-control implementation before
// structured parsing edits, rather than from the older production Git revision.
// An optional local bundle snapshot permits an actual replay without checking in
// another generated server library. No provider or production data is accessed.
const structuredBefore = process.env.STRUCTURED_EXPORT_BASELINE_PATH
  ? await withHarness(structuredExportFixture(), ({ format }) => format(), { revision: "structured-baseline" }) : null;
const structuredAfter = await withHarness(structuredExportFixture(), ({ format }) => format());
assert.equal(structuredAfter.items.length, 215);
assert.equal(structuredAfter.performance.counts.mtgjsonMatches, 215);
assert.equal(structuredAfter.performance.counts.mtgjsonMisses, 0);
assert.equal(remoteRequestCount(structuredAfter), 0);
assert.ok(structuredAfter.items.every((item) => item.status === "found" && item.requestedPrinting?.collectorNumber && !/\([A-Z0-9]+\)\s+\S+$|\*F\*/i.test(item.inputName)));
const structuredRow = (revision, result) => ({ revision, simulatedMs: result.durationMs, requests: remoteRequestCount(result),
  exactMatches: result.performance.counts.mtgjsonMatches, exactMisses: result.performance.counts.mtgjsonMisses,
  collection: result.counts.collection, fuzzy: result.counts.fuzzy, history: result.counts.history, retries: result.performance.counts.requestRetries,
  completed: result.items.filter((item) => item.status === "found").length });
console.log("215-row structured-export comparison. Recorded pre-parser bundle SHA-256: c5a8d5e2a64bcb84f3499b486c4db92e2316dbb6001829536099985e7e93f8b5.");
console.table([
  structuredBefore ? structuredRow("snapshot replay", structuredBefore) : { revision: "recorded retry-control baseline", simulatedMs: 4980, requests: 40,
    exactMatches: 0, exactMisses: 215, collection: 5, fuzzy: 35, history: 0, retries: 0, completed: 0 },
  structuredRow("current structured parser", structuredAfter),
]);

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

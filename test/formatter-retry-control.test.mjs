import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";
import { createFixture, productionShapeFixture, withHarness, remoteRequestCount, assertPacing } from "../tools/benchmark/formatter-harness.mjs";

async function bundled(path) {
  const source = buildSync({ entryPoints: [path], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" }).outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

const ordinary = (result) => result.items.filter((item) => item.inputName.startsWith("Reliability Fixture"));
const remoteTypes = ["collection", "exact", "fuzzy", "search", "history", "sets"];
function bounded(result, budget = 25_000) {
  assert.ok(result.performance.providerElapsedMs <= budget, JSON.stringify(result.performance));
  assert.ok(result.durationMs <= budget + 220, "Index fixture latency is outside the Scryfall phase");
  assert.ok(remoteRequestCount(result) <= 40, "No scenario may produce hundreds of provider requests");
  assert.equal(result.performance.counts.logicalCardRetries, 0);
  assert.equal(result.performance.counts.retries, result.performance.counts.requestRetries, "Compatibility retry counter now means HTTP request retries only");
  assert.ok(result.items.length > 0);
  assert.equal(result.performance.outcome, "complete");
  assert.doesNotMatch(result.messages.join("\n"), /Second pass|Third pass/);
  assertPacing(result);
}

test("current complete v3 resolves 114 ordinary exact cards with zero Scryfall or history requests", async () => {
  const result = await withHarness(productionShapeFixture({ version: 3, includeMiss: false, includeBasics: false }), ({ format }) => format());
  assert.equal(result.items.length, 114);
  assert.ok(result.items.every((item) => item.status === "found"));
  assert.equal(remoteRequestCount(result), 0);
  assert.equal(result.counts.history, 0);
  assert.equal(result.performance.resolutionIndexSchemaVersion, 3);
  assert.equal(result.performance.legacyIndexCompatibilityMode, false);
});

for (const version of [1, 2, 3]) test(`incomplete v${version} index batches 114 exact cards without a history fan-out`, async () => {
  const fixture = productionShapeFixture({ version, includeMiss: false, includeBasics: false });
  if (version === 3) fixture.index.rarityHistoryComplete = false;
  const result = await withHarness(fixture, ({ format }) => format());
  assert.equal(result.items.length, 114);
  assert.ok(result.items.every((item) => item.status === "found" && item.card.name === item.inputName));
  assert.equal(result.counts.collection, 3);
  assert.equal(result.counts.exact + result.counts.fuzzy + result.counts.history, 0);
  assert.equal(result.performance.legacyIndexCompatibilityMode, true);
  assert.ok(result.items.every((item) => /legacy/i.test(item.rarityEvidence || item.note || item.reliabilityNote || "")), "Each affected item preserves explicit lower-confidence legacy evidence");
  assert.match(result.messages.join("\n"), /index is outdated.*compatibility verification/i);
  bounded(result);
});

for (const [label, manifestOverrides] of [["manifest v2 with v3 bytes", { version: 2 }], ["manifest reports incomplete rarity history", { rarityHistoryComplete: false }]]) {
  test(`${label} preserves 114 canonical index matches using bounded collection compatibility`, async () => {
    const fixture = productionShapeFixture({ version: 3, includeMiss: false, includeBasics: false, manifestOverrides });
    const result = await withHarness(fixture, ({ format }) => format());
    assert.equal(result.performance.counts.mtgjsonMatches, 114);
    assert.equal(result.performance.resolutionIndexSchemaVersion, 3);
    assert.equal(result.performance.legacyIndexCompatibilityMode, true);
    assert.equal(result.counts.collection, 3);
    assert.equal(result.counts.exact + result.counts.fuzzy + result.counts.history, 0);
    assert.ok(result.items.every((item) => item.status === "found" && item.card.name === item.inputName && item.rarityEvidence === "legacy-index"));
    if (manifestOverrides.version) {
      assert.equal(result.performance.resolutionIndexManifestSchemaVersion, 2);
      assert.equal(result.performance.resolutionIndexSchemaMismatch, true);
    }
    bounded(result);
  });
}

test("118-entry legacy v2 run preserves exact names and only a true miss needs history", async () => {
  const result = await withHarness(productionShapeFixture(), ({ format }) => format());
  assert.equal(result.items.length, 118);
  assert.equal(result.performance.counts.mtgjsonMatches, 114);
  assert.equal(result.performance.counts.mtgjsonMisses, 1);
  assert.equal(result.counts.collection, 3);
  assert.equal(result.counts.history, 2);
  assert.equal(result.historyCardsStarted, 1);
  assert.ok(result.requests.filter(({ type }) => ["exact", "fuzzy", "history"].includes(type)).every(({ names }) => names.every((name) => name === "True Remote Exception")));
  assert.ok(result.items.every((item) => item.status === "found"));
  bounded(result);
});

test("legacy index without an alias map still preserves 114 direct canonical-key matches", async () => {
  const fixture = productionShapeFixture({ includeMiss: false, includeBasics: false });
  fixture.index.aliases = {};
  const result = await withHarness(fixture, ({ format }) => format());
  assert.equal(result.performance.counts.mtgjsonMatches, 114);
  assert.equal(result.performance.counts.mtgjsonMisses, 0);
  assert.equal(result.counts.collection, 3);
  assert.equal(result.counts.exact + result.counts.fuzzy + result.counts.history, 0);
  assert.ok(result.items.every((item) => item.status === "found" && item.card.name === item.inputName));
  bounded(result);
});

test("partially successful compatibility collection never reissues exact names for missing ordinary cards", async () => {
  const fixture = productionShapeFixture({ collectionOmissions: ["Reliability Fixture 001"] });
  const result = await withHarness(fixture, ({ format }) => format());
  assert.equal(result.items[0].card.name, "Reliability Fixture 001");
  assert.equal(result.items[0].status, "review");
  assert.equal(result.counts.collection, 3);
  assert.ok(result.requests.filter(({ type }) => ["exact", "fuzzy", "history"].includes(type)).every(({ names }) => names.every((name) => name === "True Remote Exception")));
  assert.equal(ordinary(result).filter((item) => item.status === "found").length, 113);
  bounded(result);
});

test("failed compatibility batch preserves canonical names and finishes without per-card fallback", async () => {
  const fixture = productionShapeFixture({ includeMiss: false, failure: { kind: 400, operations: ["collection"] } });
  const result = await withHarness(fixture, ({ format }) => format());
  assert.equal(result.counts.collection, 3);
  assert.equal(result.counts.exact + result.counts.fuzzy + result.counts.history, 0);
  assert.ok(ordinary(result).every((item) => item.status === "review" && item.card.name === item.inputName));
  assert.match(result.output, /NEEDS REVIEW/);
  assert.ok(ordinary(result).every((item) => /index.*refresh|refresh.*index/i.test(item.note)));
  bounded(result);
});

test("v3 missing one card's local evidence uses compatibility only for that exact card", async () => {
  const fixture = createFixture({ text: "Sol Ring\nCounterspell" });
  delete fixture.index.cards["sol ring"].hasPlayablePaperPrinting;
  delete fixture.index.cards["sol ring"].paperRarities;
  const result = await withHarness(fixture, ({ format }) => format());
  assert.equal(result.counts.collection, 1);
  assert.deepEqual(result.requests.find(({ type }) => type === "collection").names, ["Sol Ring"]);
  assert.equal(result.counts.history, 0);
  assert.equal(result.items[0].rarityEvidence, "legacy-index");
  assert.equal(result.items[0].paperIdentityVerified, true);
  assert.equal(result.performance.legacyIndexCompatibilityMode, true);
  assert.ok(result.items.every((item) => item.status === "found"));
});

test("legacy index with Scryfall disabled remains reviewable without pretending paper identity was verified", async () => {
  const result = await withHarness(productionShapeFixture(), ({ format }) => format({ useScryfall: false }));
  assert.equal(remoteRequestCount(result), 0);
  assert.ok(ordinary(result).every((item) => item.status === "review" && !item.paperIdentityVerified && item.card.name === item.inputName));
  assert.equal(result.items.filter((item) => item.isBasicLand && item.status === "found").length, 3);
  assert.match(result.output, /NEEDS REVIEW/);
});

test("Saved Pull List compact records retain legacy confidence and omit raw printing payloads", async () => {
  const jobs = await bundled("src/pull-list-job.ts");
  const share = await bundled("src/share-link.ts");
  await withHarness(productionShapeFixture({ includeMiss: false }), async ({ format, formatter }) => {
    const result = await format();
    const compact = JSON.parse(JSON.stringify(formatter.compactFormatterItems(result.items)));
    assert.equal(compact.length, 117);
    assert.ok(compact.every((item) => !item.prints));
    assert.ok(compact.filter((item) => !item.isBasicLand).every((item) => item.rarityEvidence === "legacy-index" && item.paperIdentityVerified && !item.localRarityVerified));
    assert.deepEqual(compact.map((item) => item.card.name), result.items.map((item) => item.card.name));
    const draft = jobs.normalizePullListJobDraft({ formatterItems: compact, output: result.output });
    const shared = share.decodeFormatterHash(share.encodeFormattedHash({ formatterItems: compact, output: result.output }));
    assert.deepEqual(draft.formatterItems, compact);
    assert.deepEqual(shared.formatterItems, compact);
    assert.ok(draft.formatterItems.every((item) => !item.providerFailure && !item.prints && !item.card?.prints_search_uri));
    const oldItems = compact.map(({ rarityEvidence, paperIdentityVerified, legacyIndexCompatibility, ...item }) => item);
    assert.equal(jobs.normalizePullListJobDraft({ formatterItems: oldItems }).formatterItems.length, 117, "Pre-field Saved Pull Lists remain readable");
  });
});

for (const kind of [400, 403, 429, 500, 503, "timeout", "network", "malformed-json", "invalid-response"]) {
  test(`118-entry v2 production shape with history failure ${kind} stays bounded and retains compatibility successes`, async () => {
    const result = await withHarness(productionShapeFixture({ failure: { kind, retryAfter: 30 } }), ({ format }) => format());
    assert.equal(result.items.length, 118);
    assert.equal(ordinary(result).filter((item) => item.status === "found").length, 114);
    assert.equal(result.counts.collection, 3);
    assert.ok(result.counts.history <= 2, `Only the true miss is allowed at most two history attempts (${kind})`);
    assert.equal(result.historyCardsStarted, 1);
    assert.equal(result.items.at(-1).status, "review");
    if ([400, 403, 429, "malformed-json", "invalid-response"].includes(kind)) assert.equal(result.counts.history, 1);
    if (kind === "malformed-json") {
      assert.equal(result.items.at(-1).providerFailure.status, 200);
      assert.equal(result.performance.failuresByHttpStatus[200], 1);
    }
    if ([403, 429].includes(kind)) {
      assert.equal(result.performance.providerCircuitState, "open");
      assert.equal(result.performance.counts.requestRetries, 0);
      assert.equal(result.requests.at(-1).type, "history");
    }
    if (kind === 429) assert.equal(result.performance.rateLimitRetryAfter, 30_000);
    bounded(result);
  });
}

for (const kind of [400, 403, 429, 503, "network", "timeout", "malformed-json", "invalid-response"]) {
  test(`115 true exceptions under systemic ${kind} receive one bounded run with no whole-card retry passes`, async () => {
    const result = await withHarness(productionShapeFixture({ exceptions: true, failure: { kind } }), ({ format }) => format());
    assert.equal(result.items.length, 118);
    assert.equal(result.performance.providerCircuitState, "open");
    assert.ok(result.counts.history <= 37);
    assert.ok(result.historyCardsStarted <= 37);
    assert.ok(result.items.filter((item) => item.status === "review").length > 0);
    assert.equal(result.items.filter((item) => item.isBasicLand && item.status === "found").length, 3);
    assert.match(result.output, /NEEDS REVIEW/);
    assert.ok(result.performance.counts.printHistoryCardsSkippedAfterCircuit > 0);
    bounded(result);
  });
}

for (const kind of [403, 429]) test(`provider-wide ${kind} opens the shared circuit on the first collection and prevents all later operations`, async () => {
  const result = await withHarness(productionShapeFixture({ failure: { kind, operations: remoteTypes } }), ({ format }) => format());
  assert.equal(remoteRequestCount(result), 1);
  assert.equal(result.counts.collection, 1);
  assert.equal(result.performance.providerCircuitState, "open");
  assert.equal(result.performance.counts.requestRetries, 0);
  assert.equal(result.items.filter((item) => item.status === "review").length, 115);
  bounded(result);
});

test("nullable optional fields on paginated multiface cards are usable printing information", async () => {
  const result = await withHarness(productionShapeFixture({ nullableFields: true }), ({ format }) => format());
  assert.equal(result.items.length, 118);
  assert.ok(result.items.every((item) => item.status === "found"));
  assert.equal(result.counts.history, 2);
  assert.equal(result.items.at(-1).prints.length, 2);
  assert.equal(result.performance.counts.requestRetries, 0);
  bounded(result);
});

test("one malformed record is dropped from a usable page with a sanitized diagnostic count", async () => {
  const result = await withHarness(createFixture({ text: "Sol Ring FOIL", nullableFields: true, droppedMalformedRecord: true }), ({ format }) => format());
  assert.equal(result.items[0].status, "found");
  assert.equal(result.items[0].prints.length, 2);
  assert.equal(result.performance.malformedRecordsDropped, 2);
  assert.equal(result.counts.history, 2);
  bounded(result);
});

test("checked-in realistic synthetic Card and paginated List fixtures retain nullable faces and both rarities", async () => {
  const readFixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
  const card = readFixture("scryfall-card-multiface-nullable.json");
  const historyPages = [readFixture("scryfall-list-prints-page-1.json"), readFixture("scryfall-list-prints-page-2.json")];
  const fixture = createFixture({ text: `${card.name} FOIL`, historyPages });
  fixture.providerCards.set(card.name, card);
  const result = await withHarness(fixture, ({ format }) => format());
  assert.equal(result.items[0].status, "found");
  assert.equal(result.items[0].card.name, card.name);
  assert.equal(result.items[0].prints.length, 2);
  assert.deepEqual(result.items[0].nonSecretRarities, ["uncommon", "rare"]);
  assert.equal(result.counts.collection, 1);
  assert.equal(result.counts.history, 2);
  assert.equal(result.performance.malformedRecordsDropped, 1);
  assert.equal(result.performance.counts.requestRetries, 0);
  assert.match(result.output, /=== Rarity Shifted ===/);
  bounded(result);
});

test("failed shared history releases its in-flight entry and new employee run recovers without clearing successful cache", async () => {
  const fixture = createFixture({ text: "Sol Ring FOIL\nCounterspell", failure: { kind: 403 } });
  await withHarness(fixture, async ({ formatter, format, counters, diagnostics }) => {
    const first = await format();
    assert.equal(first.performance.providerCircuitState, "open");
    assert.equal(first.items[0].status, "review");
    const exactBefore = counters.collection + counters.exact;
    fixture.failure = null;
    const options = { signal: null, enrichmentPurpose: "formatter", providerRun: formatter.createScryfallRunContext({ performance: diagnostics.createProcessingPerformance() }) };
    const pending = { ...first.items[0], status: "missing", note: "" };
    const resolved = await formatter.resolveCardNames([pending], () => {}, false, options);
    const [a, b] = await Promise.all([
      formatter.enrichPrintHistories(resolved, false, [], () => {}, false, options),
      formatter.enrichPrintHistories(resolved.map((item) => ({ ...item, quantity: 7 })), false, [], () => {}, false, options),
    ]);
    assert.equal(a[0].status, "found");
    assert.equal(b[0].status, "found");
    assert.equal(b[0].quantity, 7);
    assert.equal(counters.history - first.counts.history, 2, "Both subscribers share each page after rejected request cleanup");
    assert.equal(counters.collection + counters.exact, exactBefore, "Previously completed exact response remains usable");
    assert.equal(first.items[1].status, "found");
  });
});

test("Pricing Assistant selective recovery starts a separate bounded run after formatter circuit opens", async () => {
  const fixture = createFixture({ text: "Sol Ring FOIL\nCounterspell\nLightning Bolt", failure: { kind: 429 } });
  await withHarness(fixture, async ({ format, formatter, counters }) => {
    const result = await format();
    assert.equal(result.performance.providerCircuitState, "open");
    fixture.failure = null;
    const compact = JSON.parse(JSON.stringify(formatter.compactFormatterItems(result.items)));
    const printing = { uuid: "keep-primary-uuid", setCode: "OLD", setName: "Primary", finishes: ["normal"], treatments: ["standard"], prices: {} };
    const catalog = { counterspell: { name: "Counterspell", printings: [printing] } };
    const before = counters.history;
    // The combined bundle shares the actual formatter module singleton with the
    // PricingPanel helper, so a duplicated test module cannot hide stale state.
    const recovered = await formatter.fallbackCatalogWithPrintHistories(compact, catalog, ["Lightning Bolt", "Counterspell"], () => {});
    assert.ok(recovered.catalog["lightning bolt"].printings.length);
    assert.deepEqual(recovered.catalog.counterspell, catalog.counterspell);
    assert.equal(recovered.failedCardKeys.size, 0);
    assert.equal(counters.history - before, 2);
  }, { includePricingRecovery: true });
});

test("healthy Case Check retains histories and a provider failure only demotes affected cards", async () => {
  const fixture = createFixture({ text: "Sol Ring\nCounterspell\nIsland", caseCheck: true });
  const healthy = await withHarness(fixture, ({ format }) => format());
  assert.equal(healthy.counts.history, 4);
  assert.ok(healthy.items.every((item) => item.status === "found"));
  fixture.failure = { kind: 403, operations: ["sets"] };
  const failed = await withHarness(fixture, ({ format }) => format());
  assert.equal(remoteRequestCount(failed), 2);
  assert.deepEqual(failed.requests.filter(({ type }) => remoteTypes.includes(type)).map(({ type }) => type), ["collection", "sets"]);
  assert.deepEqual(failed.items.map((item) => item.status), ["review", "review", "found"]);
  bounded(failed);
});

test("slow MTGJSON loading does not consume the Case Check Scryfall phase budget", async () => {
  const fixture = createFixture({ text: "Sol Ring\nCounterspell", caseCheck: true, latency: { manifest: 40, index: 15000, scryfall: 80 } });
  const result = await withHarness(fixture, ({ format }) => format());
  const providerRequests = result.requests.filter(({ type }) => remoteTypes.includes(type));
  assert.equal(providerRequests[0].at, 15_040);
  assert.equal(providerRequests[0].type, "collection");
  assert.equal(result.performance.providerElapsedMs, result.durationMs - 15_040);
  assert.ok(result.performance.providerElapsedMs < 1000);
  assert.equal(result.performance.providerCircuitState, "closed");
  assert.equal(result.counts.history, 4);
  assert.ok(result.items.every((item) => item.status === "found"));
  assertPacing(result);
});

for (const [label, failure, abortAt] of [["active request", { kind: "timeout" }, 500], ["backoff", { kind: 503 }, 650], ["queued interval", null, 330]]) {
  test(`cancellation interrupts ${label} and the next formatter run gets fresh provider state`, async () => {
    const fixture = createFixture({ text: "Sol Ring FOIL\nCounterspell FOIL", failure });
    await withHarness(fixture, async ({ format, clock }) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), abortAt);
      await assert.rejects(format({ signal: controller.signal }), { name: "AbortError" });
      assert.equal(clock.now, abortAt);
      fixture.failure = null;
      const next = await format();
      assert.ok(next.items.every((item) => item.status === "found"));
      assert.equal(next.performance.providerCircuitState, "closed");
      bounded(next);
    });
  });
}

test("careful mode keeps its 500ms gate and bounded phase when a whole list of exceptions fails", async () => {
  const result = await withHarness(productionShapeFixture({ exceptions: true, carefulMode: true, failure: { kind: 503 } }), ({ format }) => format());
  bounded(result, 45_000);
  assertPacing(result, 500);
  assert.equal(result.performance.providerBudgetMs, 45_000);
  assert.equal(result.performance.providerCircuitState, "open");
});

test("healthy slow responses hit the actual normal wall-clock deadline without waiting for every queued history", async () => {
  const fixture = productionShapeFixture({ exceptions: true, latency: { manifest: 40, index: 180, scryfall: 7000 } });
  const result = await withHarness(fixture, ({ format }) => format());
  assert.equal(result.performance.providerCircuitState, "open");
  assert.equal(result.performance.providerCircuitReason, "time_budget");
  assert.equal(result.durationMs, 25_220, "Clock, rather than a clipped diagnostic alone, proves the hard phase deadline");
  assert.ok(result.performance.counts.printHistoryCardsSkippedAfterCircuit > 0);
  bounded(result);
});

test("healthy long lists obey the total 40-attempt budget and preserve completed exception histories", async () => {
  const result = await withHarness(productionShapeFixture({ version: 3, exceptions: true }), ({ format }) => format());
  assert.equal(remoteRequestCount(result), 40);
  assert.equal(result.performance.providerCircuitReason, "attempt_budget");
  assert.ok(result.items.filter((item) => !item.isBasicLand && item.status === "found").length > 0);
  assert.ok(result.items.some((item) => item.status === "review"));
  assert.equal(result.performance.counts.requestRetries, 0);
  bounded(result);
});

test("completed cached printing pages remain usable inside an already-open run", async () => {
  const fixture = createFixture({ text: "Sol Ring FOIL" });
  await withHarness(fixture, async ({ format, formatter, counters }) => {
    const healthy = await format();
    fixture.text = "Counterspell FOIL";
    fixture.failure = { kind: 403 };
    const stopped = await format();
    assert.equal(stopped.performance.providerCircuitState, "open");
    const before = counters.history;
    const [{ prints, eligibleRarityChecked, ...cachedItem }] = healthy.items;
    const [restored] = await formatter.enrichPrintHistories([cachedItem], false, [], () => {}, false,
      { enrichmentPurpose: "formatter", signal: null, providerRun: stopped.providerRun });
    assert.equal(restored.status, "found");
    assert.equal(restored.prints.length, 2);
    assert.equal(counters.history, before, "An open circuit forbids requests, but does not discard completed cache data");
  });
});

test("copyable diagnostics omit customer details, card names, provider URLs and tokens", async () => {
  const fixture = createFixture({ text: "Name: Confidential Person\nEmail: confidential@example.test\nPhone: 555-333-1111\nSol Ring FOIL", failure: { kind: 429 } });
  fixture.providerCards.get("Sol Ring").prints_search_uri += "&token=private-test-token";
  const result = await withHarness(fixture, ({ format }) => format());
  assert.doesNotMatch(result.performanceText, /Confidential|555-333|Sol Ring|private-test-token|https?:|token=/i);
  for (const field of ["resolutionIndexSchemaVersion", "rarityHistoryComplete", "legacyIndexCompatibilityMode", "providerCircuitState", "providerCircuitReason", "providerBudgetMs", "providerElapsedMs", "providerAttemptBudget", "providerAttemptsUsed", "logicalRemoteCards", "printHistoryCardsStarted", "printHistoryCardsCompleted", "printHistoryCardsFailed", "printHistoryCardsSkippedAfterCircuit", "requestRetries", "logicalCardRetries", "failuresByKind", "failuresByHttpStatus", "rateLimitRetryAfter", "malformedRecordsDropped"]) {
    assert.match(result.performanceText, new RegExp(field));
  }
});

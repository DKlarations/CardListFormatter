import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";
import { createFixture, withHarness } from "../tools/benchmark/formatter-harness.mjs";

const source = buildSync({ entryPoints: ["src/processing-performance.ts"], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" }).outputFiles[0].text;
const diagnostics = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);

test("Processing Performance reports numeric stage/request measurements without customer or card input", async () => {
  await withHarness(createFixture({ text: "Name: Private Fixture Customer\nPhone: 206-555-0142\nEmail: private-fixture@example.test\nSol Ring FOIL" }), async ({ format }) => {
    const report = diagnostics.createProcessingPerformance();
    const result = await format({ performance: report });
    const completed = diagnostics.finishProcessingPerformance(report);
    assert.equal(completed.totalMs, result.durationMs);
    assert.equal(completed.outcome, "complete");
    assert.equal(completed.counts.scryfallPrintPages, 2);
    assert.ok(Object.values(completed.stages).every((value) => Number.isFinite(value) && value >= 0));
    assert.ok(Object.values(completed.counts).every((value) => Number.isFinite(value) && value >= 0));
    const copied = diagnostics.formatProcessingPerformance(completed);
    assert.match(copied, /Processing Performance/);
    assert.doesNotMatch(copied, /Private Fixture|206-555|private-fixture|Sol Ring|https?:\/\//i);
  });
});

test("completed diagnostic snapshots cannot change when another run updates counters", () => {
  const report = diagnostics.createProcessingPerformance();
  report.stage = "scryfallFuzzy";
  diagnostics.countPerformance(report, "scryfallFuzzy", 2);
  report.reasons["fuzzy-name-required"] = 2;
  const canceled = diagnostics.finishProcessingPerformance(report, "canceled");
  diagnostics.countPerformance(report, "scryfallFuzzy", 1);
  report.reasons["fuzzy-name-required"] = 99;
  report.stages.scryfallFuzzy = 999;
  report.failuresByKind.network = 9;
  report.failuresByHttpStatus[503] = 9;
  assert.equal(canceled.outcome, "canceled");
  assert.equal(canceled.stage, "scryfallFuzzy");
  assert.equal(canceled.counts.scryfallFuzzy, 2);
  assert.equal(canceled.reasons["fuzzy-name-required"], 2);
  assert.equal(canceled.stages.scryfallFuzzy, 0);
  assert.deepEqual(canceled.failuresByKind, {});
  assert.deepEqual(canceled.failuresByHttpStatus, {});
});

test("diagnostics distinguish request retries and circuit budgets with sanitized failure aggregates", () => {
  const report = diagnostics.createProcessingPerformance();
  diagnostics.recordResolutionIndexReadiness(report, { version: 2, generatedAt: "2026-09-08T00:00:00Z", source: { mtgjsonMeta: { failedSetCount: 0 } } });
  report.providerCircuitState = "open";
  report.providerCircuitReason = "HTTP_429";
  report.providerBudgetMs = 25_000;
  report.providerElapsedMs = 1_200;
  report.providerAttemptBudget = 40;
  report.providerAttemptsUsed = 12;
  report.rateLimitRetryAfter = 60_000;
  report.counts.printHistoryCardsCompleted = 8;
  report.counts.printHistoryCardsSkippedAfterCircuit = 107;
  report.failuresByKind["rate-limited"] = 1;
  report.failuresByHttpStatus[429] = 1;
  const copied = diagnostics.formatProcessingPerformance(report);
  for (const line of ["resolutionIndexSchemaVersion: 2", "rarityHistoryComplete: unknown", "legacyIndexCompatibilityMode: true", "Scryfall circuit: open", "providerCircuitReason: HTTP 429", "providerBudgetMs: 25000", "providerAttemptsUsed: 12", "printHistoryCardsCompleted: 8", "printHistoryCardsSkippedAfterCircuit: 107", "logicalCardRetries: 0", "rateLimitRetryAfter: 60000 ms", "failuresByKind: rate-limited=1", "failuresByHttpStatus: 429=1"]) assert.ok(copied.includes(line), line);
  assert.match(diagnostics.processingReliabilityStatus(report), /Card-name index is outdated\. Using compatibility verification\./);
  assert.match(diagnostics.processingReliabilityStatus(report), /Scryfall verification stopped after repeated failures\. Affected cards were placed in Needs Review\./);
});

test("copyable reports discard unknown labels and unsafe provider failure text", () => {
  const report = diagnostics.createProcessingPerformance();
  const secret = "Private Customer Secret Card https://signed.test/?token=hidden";
  report.providerCircuitReason = secret;
  report.stage = secret;
  report.indexSource = secret;
  report.indexFailureStage = secret;
  report.resolutionIndexGeneratedAt = secret;
  report.counts[secret] = 1;
  report.stages[secret] = 1;
  report.reasons[secret] = 1;
  report.failuresByKind[secret] = 1;
  report.failuresByHttpStatus[secret] = 1;
  assert.doesNotMatch(diagnostics.formatProcessingPerformance(report), /Private Customer|Secret Card|https?:|token=hidden/);
});

test("structured export diagnostics copy only safe aggregate counters and bulk-guard flags", () => {
  const report = diagnostics.createProcessingPerformance();
  diagnostics.recordParsingPerformance(report, { structuredExportRowsDetected: 215, structuredExportRowsParsed: 214, importedPrintingHints: 214, mojibakeCorrections: 1, privateInput: "Private Customer Card" });
  report.exactMissRatio = 0.65;
  report.bulkMissGuardTriggered = true;
  report.counts.fuzzyLookupsPrevented = 140;
  const copied = diagnostics.formatProcessingPerformance(report);
  for (const text of ["structuredExportRowsDetected: 215", "structuredExportRowsParsed: 214", "importedPrintingHints: 214", "mojibakeCorrections: 1", "exactMissRatio: 0.65", "bulkMissGuardTriggered: true", "fuzzyLookupsPrevented: 140"]) assert.ok(copied.includes(text), text);
  assert.doesNotMatch(copied, /Private Customer Card|privateInput/);
  assert.match(diagnostics.processingReliabilityStatus(report), /Most card names failed exact matching.*unsupported export format/);
  diagnostics.recordParsingPerformance(report, { structuredExportRowsDetected: -1, structuredExportRowsParsed: "private", importedPrintingHints: Infinity, mojibakeCorrections: 0.5 });
  assert.equal(report.counts.structuredExportRowsDetected, 0);
  assert.equal(report.counts.structuredExportRowsParsed, 0);
  assert.equal(report.counts.importedPrintingHints, 0);
  assert.equal(report.counts.mojibakeCorrections, 0);
});

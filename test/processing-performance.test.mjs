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
  assert.equal(canceled.outcome, "canceled");
  assert.equal(canceled.stage, "scryfallFuzzy");
  assert.equal(canceled.counts.scryfallFuzzy, 2);
  assert.equal(canceled.reasons["fuzzy-name-required"], 2);
  assert.equal(canceled.stages.scryfallFuzzy, 0);
});

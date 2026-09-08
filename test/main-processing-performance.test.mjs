import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { importBundledModule } from "./test-module-bundle.mjs";

const source = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
const performance = await importBundledModule("src/processing-performance.ts", "main-performance-report");
const processList = source.slice(source.indexOf("  async function processList()"), source.indexOf("  async function retryNeedsReview()"));
const retry = source.slice(source.indexOf("  async function retryNeedsReview()"), source.indexOf("  function abortProcessing()"));

test("Process List and Retry wire only formatter or Case Check purposes with isolated provider context", () => {
  for (const action of [processList, retry]) {
    assert.match(action, /enrichmentPurpose: caseCheck && useScryfall \? "case-check" : "formatter"/);
    assert.match(action, /signal: controller\.signal/);
    assert.match(action, /performance: report/);
    assert.match(action, /minIntervalMs: carefulMode \? 500 : 120/);
    assert.match(action, /fetchRecentCaseSets\(providerOptions\)/);
    assert.doesNotMatch(action, /pricingMode|pricing-recovery|beginScryfallRun|endScryfallRun/);
  }
});

test("late processing completions and cleanup require both the active controller and workspace", () => {
  for (const action of [processList, retry]) {
    assert.match(action, /const isCurrentRun = \(\) => workspaceGeneration === workspaceGenerationRef\.current && abortControllerRef\.current === controller/);
    assert.match(action, /if \(isCurrentRun\(\) && !controller\.signal\.aborted\) setMessage/);
    assert.match(action, /if \(!isCurrentRun\(\)\) return;\s+if \(controller\.signal\.aborted\) throw/);
    assert.match(action, /finally \{\s+if \(isCurrentRun\(\)\) \{\s+abortControllerRef\.current = null;\s+setIsProcessing\(false\)/);
    assert.match(action, /finishProcessingPerformance\(report, canceled \? "canceled" : "failed"\)/);
  }
});

test("prefetch begins after render or input interaction and persistence remains outside formatter-ready time", () => {
  assert.match(source, /window\.requestIdleCallback\(prefetchIndex, \{ timeout: 1500 \}\)/);
  assert.match(source, /window\.setTimeout\(prefetchIndex, 250\)/);
  assert.match(source, /onFocus=\{prefetchIndex\}[\s\S]*?onPaste=\{prefetchIndex\}/);
  assert.match(source, /if \(value\.trim\(\)\) prefetchIndex\(\)/);
  assert.ok(processList.indexOf("finishProcessingPerformance(report)") < processList.indexOf("void persistJobDraft(draft, currentJobId)"));
  assert.match(source, /report\.stages\.savedPersistence = processingNow\(\) - persistenceStartedAt/);
  assert.match(source, /processingPerformanceRef\.current === report && generation === persistenceGenerationRef\.current/);
});

test("copyable performance diagnostics contain numeric aggregates without private input or provider URLs", () => {
  const report = performance.createProcessingPerformance();
  report.stages.parse = 2;
  report.stages.savedPersistence = 9;
  report.counts.mtgjsonMatches = 25;
  report.counts.skippedCards = 25;
  report.reasons["already-complete"] = 25;
  report.indexSource = "persistent-cache";
  report.stage = "ready";
  const completed = performance.finishProcessingPerformance(report);
  const text = performance.formatProcessingPerformance(completed);
  assert.match(text, /Processing Performance/);
  assert.match(text, /mtgjsonMatches: 25/);
  assert.match(text, /savedPersistence: 9.0 ms/);
  assert.doesNotMatch(text, /customer|email|phone|https?:\/\/|token=|Raw pull list/i);
  assert.match(source, /navigator\.clipboard\.writeText\(formatProcessingPerformance\(report\)\)/);
  report.counts.mtgjsonMatches = 999;
  assert.equal(completed.counts.mtgjsonMatches, 25, "completed diagnostics must remain a snapshot during later requests");
});

test("completed initial and manual review runs display compatibility and circuit status with printable output", () => {
  for (const action of [processList, retry]) {
    assert.match(action, /processingReliabilityStatus\(completedReport\)/);
    assert.match(action, /setResolvedItems\(/);
    assert.match(action, /const report = createProcessingPerformance\(\)/);
    assert.ok(action.indexOf("await resolveCardNames(") < action.indexOf("await fetchRecentCaseSets("), "Index loading must precede the bounded Scryfall phase, including Case Check");
  }
  assert.match(source, /resolutionIndexReadiness\(manifest\)/);
  assert.match(source, /Resolution index schema:/);
  assert.match(source, /Rarity history complete:/);
  assert.match(source, /Failed sets:/);
});

test("initial processing reports parsed import aggregates while manual review measures only its selected entries", () => {
  assert.match(processList, /recordParsingPerformance\(report, parsed\.diagnostics\)/);
  assert.match(retry, /parsePullList\(reviewEntries\.flatMap/);
  assert.match(retry, /recordParsingPerformance\(report, reviewParse\.diagnostics\)/);
  for (const action of [processList, retry]) assert.match(action, /processingReliabilityStatus\(completedReport\)/);
});

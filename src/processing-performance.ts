/** Session-only numeric measurements. Never accepts input text, identifiers or URLs. */
export type ProcessingPerformance = {
  startedAt: number;
  totalMs: number;
  stages: Record<string, number>;
  counts: Record<string, number>;
  reasons: Record<string, number>;
  indexSource: string;
  indexFailureStage?: "manifest" | "index";
  stage: string;
  outcome: "running" | "complete" | "canceled" | "failed";
};

export function processingNow() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export function createProcessingPerformance(): ProcessingPerformance {
  return {
    startedAt: processingNow(), totalMs: 0,
    stages: { parse: 0, manifest: 0, indexLoad: 0, indexParseValidation: 0, mtgjsonLookup: 0, scryfallExactBatch: 0, scryfallFuzzy: 0, printHistory: 0 },
    counts: { manifestRequests: 0, indexRequests: 0, indexCacheHits: 0, mtgjsonMatches: 0, mtgjsonMisses: 0, ambiguousMatches: 0, scryfallCollection: 0, scryfallExact: 0, scryfallFuzzy: 0, scryfallSearch: 0, scryfallPrintPages: 0, scryfallSets: 0, scryfallCacheHits: 0, retries: 0, remoteCards: 0, skippedCards: 0 },
    reasons: {}, indexSource: "unused", stage: "parse", outcome: "running",
  };
}

export function countPerformance(report: ProcessingPerformance | undefined, name: string, amount = 1) {
  if (report) report.counts[name] = (report.counts[name] || 0) + amount;
}

export function finishProcessingPerformance(report: ProcessingPerformance, outcome: ProcessingPerformance["outcome"] = "complete") {
  report.totalMs = processingNow() - report.startedAt;
  report.outcome = outcome;
  return { ...report, stages: { ...report.stages }, counts: { ...report.counts }, reasons: { ...report.reasons } };
}

export function formatProcessingPerformance(report: ProcessingPerformance) {
  return [
    "Processing Performance", `Result: ${report.outcome}; stage: ${report.stage}`,
    `Total: ${report.totalMs.toFixed(1)} ms; index: ${report.indexSource}`,
    ...(report.indexFailureStage ? [`Index failure stage: ${report.indexFailureStage}`] : []),
    ...Object.entries(report.stages).map(([key, value]) => `${key}: ${value.toFixed(1)} ms`),
    ...Object.entries(report.counts).map(([key, value]) => `${key}: ${value}`),
    `Enrichment reasons: ${Object.entries(report.reasons).map(([key, value]) => `${key}=${value}`).join(", ") || "none"}`,
  ].join("\n");
}

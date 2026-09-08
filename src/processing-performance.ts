import { resolutionIndexReadiness } from "./mtgjson-resolution-index.js";

/** Session-only aggregate measurements. No customer text, card identifiers or URLs. */
export type ProcessingPerformance = {
  startedAt: number;
  totalMs: number;
  stages: Record<string, number>;
  counts: Record<string, number>;
  reasons: Record<string, number>;
  indexSource: string;
  indexFailureStage?: "manifest" | "index";
  resolutionIndexSchemaVersion: number | null;
  resolutionIndexManifestSchemaVersion: number | null;
  resolutionIndexSchemaMismatch: boolean;
  rarityHistoryComplete: boolean | null;
  resolutionIndexGeneratedAt: string | null;
  resolutionIndexFailedSetCount: number | null;
  legacyIndexCompatibilityMode: boolean;
  providerCircuitState: "closed" | "open";
  providerCircuitReason: string | null;
  providerBudgetMs: number;
  providerElapsedMs: number;
  providerAttemptBudget: number;
  providerAttemptsUsed: number;
  failuresByKind: Record<string, number>;
  failuresByHttpStatus: Record<string, number>;
  rateLimitRetryAfter: number | null;
  malformedRecordsDropped: number;
  exactMissRatio: number | null;
  bulkMissGuardTriggered: boolean;
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
    counts: { manifestRequests: 0, indexRequests: 0, indexCacheHits: 0, mtgjsonMatches: 0, mtgjsonMisses: 0, ambiguousMatches: 0, scryfallCollection: 0, scryfallExact: 0, scryfallFuzzy: 0, scryfallSearch: 0, scryfallPrintPages: 0, scryfallSets: 0, scryfallCacheHits: 0, retries: 0, remoteCards: 0, skippedCards: 0, logicalRemoteCards: 0, printHistoryCardsStarted: 0, printHistoryCardsCompleted: 0, printHistoryCardsFailed: 0, printHistoryCardsSkippedAfterCircuit: 0, requestRetries: 0, logicalCardRetries: 0, malformedRecordsDropped: 0, structuredExportRowsDetected: 0, structuredExportRowsParsed: 0, importedPrintingHints: 0, mojibakeCorrections: 0, fuzzyLookupsPrevented: 0 },
    resolutionIndexSchemaVersion: null, resolutionIndexManifestSchemaVersion: null, resolutionIndexSchemaMismatch: false, rarityHistoryComplete: null, resolutionIndexGeneratedAt: null, resolutionIndexFailedSetCount: null,
    legacyIndexCompatibilityMode: false, providerCircuitState: "closed", providerCircuitReason: null,
    providerBudgetMs: 0, providerElapsedMs: 0, providerAttemptBudget: 0, providerAttemptsUsed: 0,
    failuresByKind: {}, failuresByHttpStatus: {}, rateLimitRetryAfter: null, malformedRecordsDropped: 0,
    exactMissRatio: null, bulkMissGuardTriggered: false,
    reasons: {}, indexSource: "unused", stage: "parse", outcome: "running",
  };
}

export type ParsingPerformance = {
  structuredExportRowsDetected: number;
  structuredExportRowsParsed: number;
  importedPrintingHints: number;
  mojibakeCorrections: number;
};

/** Copies only known nonnegative aggregate counts, never parser input or card data. */
export function recordParsingPerformance(report: ProcessingPerformance | undefined, diagnostics: Partial<ParsingPerformance> | undefined) {
  if (!report) return;
  for (const key of ["structuredExportRowsDetected", "structuredExportRowsParsed", "importedPrintingHints", "mojibakeCorrections"] as const) {
    const count = diagnostics?.[key];
    report.counts[key] = Number.isInteger(count) && count >= 0 ? count : 0;
  }
}

export function recordResolutionIndexReadiness(report: ProcessingPerformance | undefined, index: unknown) {
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

export function snapshotProcessingPerformance(report: ProcessingPerformance): ProcessingPerformance {
  return { ...report, stages: { ...report.stages }, counts: { ...report.counts }, reasons: { ...report.reasons }, failuresByKind: { ...report.failuresByKind }, failuresByHttpStatus: { ...report.failuresByHttpStatus } };
}

export function countPerformance(report: ProcessingPerformance | undefined, name: string, amount = 1) {
  if (report) report.counts[name] = (report.counts[name] || 0) + amount;
}

export function finishProcessingPerformance(report: ProcessingPerformance, outcome: ProcessingPerformance["outcome"] = "complete") {
  report.totalMs = processingNow() - report.startedAt;
  report.outcome = outcome;
  return snapshotProcessingPerformance(report);
}

export function processingReliabilityStatus(report: ProcessingPerformance | null | undefined): string {
  if (!report) return "";
  return [
    report.bulkMissGuardTriggered ? BULK_MISS_GUARD_MESSAGE : "",
    report.legacyIndexCompatibilityMode ? "Card-name index is outdated. Using compatibility verification." : "",
    report.providerCircuitState === "open" ? "Scryfall verification stopped after repeated failures. Affected cards were placed in Needs Review." : "",
  ].filter(Boolean).join(" ");
}

export const BULK_MISS_GUARD_MESSAGE = "Most card names failed exact matching. The pasted list may use an unsupported export format. Automatic provider lookups were stopped.";

const FAILURE_KINDS = new Set(["http-status", "rate-limited", "forbidden", "timeout", "network", "malformed-json", "invalid-response", "pagination-loop", "pagination-limit", "circuit-open", "phase-budget-exhausted", "canceled"]);
const STAGES = new Set(["parse", "index", "manifest", "indexLoad", "indexParseValidation", "mtgjsonLookup", "scryfallExactBatch", "scryfallFuzzy", "printHistory", "scryfall-exact", "scryfall-fuzzy", "print-history", "caseSets", "case-sets", "format", "ready", "savedPersistence"]);
const INDEX_SOURCES = new Set(["unused", "memory", "persistent-cache", "network", "stale-fallback"]);
const REASONS = new Set(["token", "basic-land", "already-complete", "fuzzy-name-required", "mtgjson-ambiguous", "mtgjson-miss", "pricing-recovery", "case-check", "requested-flavor-name", "special-printing-request", "legacy-index-compatibility", "insufficient-paper-confidence", "insufficient-local-rarity", "bulk-exact-miss-guard"]);
const safeNumber = (value: number) => Number.isFinite(value) && value >= 0 ? value : 0;
const known = (value: string, allowed: Set<string>) => allowed.has(value) ? value : "unknown";
const aggregate = (values: Record<string, number>, accept: (key: string) => boolean) => Object.entries(values).filter(([key]) => accept(key)).map(([key, value]) => `${key}=${safeNumber(value)}`).join(", ") || "none";

function circuitReason(value: string | null) {
  if (!value) return "none";
  if (/^HTTP_(?:[1-5]\d\d)$/.test(value)) return value.replace("_", " ");
  if (/^repeated_(?:timeout|network|http_5\d\d|invalid_response|malformed_json)$/.test(value) || ["time_budget", "attempt_budget"].includes(value)) return value.replaceAll("_", " ");
  return "provider failure";
}

export function formatProcessingPerformance(report: ProcessingPerformance) {
  const countNames = new Set(Object.keys(createProcessingPerformance().counts));
  return [
    "Processing Performance", `Result: ${known(report.outcome, new Set(["running", "complete", "canceled", "failed"]))}; stage: ${known(report.stage, STAGES)}`,
    `Total: ${safeNumber(report.totalMs).toFixed(1)} ms; index: ${known(report.indexSource, INDEX_SOURCES)}`,
    ...(report.indexFailureStage ? [`Index failure stage: ${known(report.indexFailureStage, new Set(["manifest", "index"]))}`] : []),
    `resolutionIndexSchemaVersion: ${report.resolutionIndexSchemaVersion ?? "unknown"}`,
    `resolutionIndexManifestSchemaVersion: ${report.resolutionIndexManifestSchemaVersion ?? "unknown"}`,
    `resolutionIndexSchemaMismatch: ${report.resolutionIndexSchemaMismatch}`,
    `rarityHistoryComplete: ${report.rarityHistoryComplete ?? "unknown"}`,
    `resolutionIndexGeneratedAt: ${resolutionIndexReadiness({ generatedAt: report.resolutionIndexGeneratedAt }).generatedAt || "unknown"}`,
    `resolutionIndexFailedSetCount: ${report.resolutionIndexFailedSetCount ?? "unknown"}`,
    `legacyIndexCompatibilityMode: ${report.legacyIndexCompatibilityMode}`,
    `exactMissRatio: ${report.exactMissRatio === null ? "unknown" : Math.min(1, safeNumber(report.exactMissRatio))}`,
    `bulkMissGuardTriggered: ${Boolean(report.bulkMissGuardTriggered)}`,
    `Scryfall circuit: ${report.providerCircuitState === "open" ? "open" : "closed"}`,
    `providerCircuitState: ${report.providerCircuitState === "open" ? "open" : "closed"}`,
    `providerCircuitReason: ${circuitReason(report.providerCircuitReason)}`,
    `providerBudgetMs: ${safeNumber(report.providerBudgetMs)}`,
    `providerElapsedMs: ${safeNumber(report.providerElapsedMs)}`,
    `providerAttemptBudget: ${safeNumber(report.providerAttemptBudget)}`,
    `providerAttemptsUsed: ${safeNumber(report.providerAttemptsUsed)}`,
    `rateLimitRetryAfter: ${report.rateLimitRetryAfter === null ? "none" : `${safeNumber(report.rateLimitRetryAfter)} ms`}`,
    `malformedRecordsDropped: ${Math.max(safeNumber(report.malformedRecordsDropped), safeNumber(report.counts.malformedRecordsDropped))}`,
    ...Object.entries(report.stages).filter(([key]) => STAGES.has(key)).map(([key, value]) => `${key}: ${safeNumber(value).toFixed(1)} ms`),
    ...Object.entries(report.counts).filter(([key]) => countNames.has(key) && key !== "malformedRecordsDropped").map(([key, value]) => `${key}: ${safeNumber(value)}`),
    "Retry counters: retries = requestRetries; logicalCardRetries counts whole-card repeats",
    `failuresByKind: ${aggregate(report.failuresByKind, (key) => FAILURE_KINDS.has(key))}`,
    `failuresByHttpStatus: ${aggregate(report.failuresByHttpStatus, (key) => /^[1-5]\d\d$/.test(key))}`,
    `Enrichment reasons: ${aggregate(report.reasons, (key) => REASONS.has(key))}`,
  ].join("\n");
}

import { countPerformance, type ProcessingPerformance } from "./processing-performance.js";

export type ProviderFailureKind = "http-status" | "rate-limited" | "forbidden" | "timeout" | "network"
  | "malformed-json" | "invalid-response" | "pagination-loop" | "pagination-limit" | "circuit-open"
  | "phase-budget-exhausted" | "canceled";
export type ProviderOperation = "scryfallCollection" | "scryfallExact" | "scryfallFuzzy" | "scryfallSearch" | "scryfallPrintPages" | "scryfallSets";
/** Compact allowlisted facts only: no provider messages, payloads, names, or URLs. */
export type ProviderFailure = {
  kind: ProviderFailureKind;
  status?: number;
  retryable: boolean;
  retryAfterMs?: number;
  operation: ProviderOperation;
  attemptCount: number;
};

export const SCRYFALL_NORMAL_BUDGET_MS = 25000;
export const SCRYFALL_CAREFUL_BUDGET_MS = 45000;
export const SCRYFALL_ATTEMPT_BUDGET = 40;
export const SCRYFALL_REQUEST_TIMEOUT_MS = 8000;
export const SCRYFALL_MAX_ATTEMPTS = 2;
export const SCRYFALL_FAILURE_THRESHOLD = 3;

export type ScryfallRunContext = {
  state: "closed" | "open";
  reason: string | null;
  startedAt: number | null;
  stoppedAt: number | null;
  budgetMs: number;
  attemptBudget: number;
  attemptsUsed: number;
  consecutiveKey: string | null;
  consecutiveFailures: number;
  failuresByKind: Record<string, number>;
  failuresByHttpStatus: Record<string, number>;
  retryAfterMs: number | null;
  malformedRecordsDropped: number;
  controller: AbortController;
  performance?: ProcessingPerformance;
  now: () => number;
  random: () => number;
};

export function createScryfallRunContext(options: {
  carefulMode?: boolean;
  purpose?: "formatter" | "pricing-recovery" | "case-check";
  performance?: ProcessingPerformance;
  now?: () => number;
  random?: () => number;
} = {}): ScryfallRunContext {
  // Explicit pricing recovery has an independent, still bounded operation window.
  const run: ScryfallRunContext = {
    state: "closed", reason: null, startedAt: null, stoppedAt: null,
    budgetMs: options.carefulMode || options.purpose === "pricing-recovery" ? SCRYFALL_CAREFUL_BUDGET_MS : SCRYFALL_NORMAL_BUDGET_MS,
    attemptBudget: SCRYFALL_ATTEMPT_BUDGET, attemptsUsed: 0,
    consecutiveKey: null, consecutiveFailures: 0, failuresByKind: {}, failuresByHttpStatus: {},
    retryAfterMs: null, malformedRecordsDropped: 0, controller: new AbortController(),
    performance: options.performance, now: options.now || (() => Date.now()), random: options.random || Math.random,
  };
  syncScryfallDiagnostics(run);
  return run;
}

export function syncScryfallDiagnostics(run: ScryfallRunContext) {
  const report = run.performance;
  if (!report) return;
  report.providerCircuitState = run.state;
  report.providerCircuitReason = run.reason;
  report.providerBudgetMs = run.budgetMs;
  report.providerElapsedMs = run.startedAt === null ? 0 : Math.max(0, (run.stoppedAt ?? run.now()) - run.startedAt);
  report.providerAttemptBudget = run.attemptBudget;
  report.providerAttemptsUsed = run.attemptsUsed;
  report.failuresByKind = { ...run.failuresByKind };
  report.failuresByHttpStatus = { ...run.failuresByHttpStatus };
  report.rateLimitRetryAfter = run.retryAfterMs;
  report.malformedRecordsDropped = run.malformedRecordsDropped;
  report.counts.malformedRecordsDropped = run.malformedRecordsDropped;
}

export function openScryfallCircuit(run: ScryfallRunContext, reason: string) {
  if (run.state === "open") return;
  run.state = "open";
  run.reason = reason;
  run.stoppedAt = run.now();
  run.controller.abort();
  syncScryfallDiagnostics(run);
}

export function providerCircuitFailure(run: ScryfallRunContext | undefined, operation: ProviderOperation = "scryfallPrintPages"): ProviderFailure | null {
  if (!run) return null;
  if (run.state !== "open" && run.startedAt !== null) {
    if (run.now() - run.startedAt >= run.budgetMs) openScryfallCircuit(run, "time_budget");
    else if (run.attemptsUsed >= run.attemptBudget) openScryfallCircuit(run, "attempt_budget");
  }
  syncScryfallDiagnostics(run);
  if (run.state !== "open") return null;
  return { kind: run.reason === "time_budget" || run.reason === "attempt_budget" ? "phase-budget-exhausted" : "circuit-open", retryable: false, operation, attemptCount: 0 };
}

export function startProviderPhase(run: ScryfallRunContext) {
  if (run.startedAt === null) run.startedAt = run.now();
  syncScryfallDiagnostics(run);
}

export function remainingProviderMs(run: ScryfallRunContext) {
  return Math.max(0, run.budgetMs - (run.startedAt === null ? 0 : run.now() - run.startedAt));
}

export function recordProviderAttempt(run: ScryfallRunContext, operation: ProviderOperation, attempt: number) {
  run.attemptsUsed += 1;
  countPerformance(run.performance, operation);
  if (attempt > 1) {
    countPerformance(run.performance, "requestRetries");
    countPerformance(run.performance, "retries"); // Legacy alias: underlying HTTP retries only.
  }
  syncScryfallDiagnostics(run);
}

export function recordProviderSuccess(run: ScryfallRunContext) {
  run.consecutiveKey = null;
  run.consecutiveFailures = 0;
  syncScryfallDiagnostics(run);
}

export function recordProviderFailure(run: ScryfallRunContext, failure: ProviderFailure) {
  run.failuresByKind[failure.kind] = (run.failuresByKind[failure.kind] || 0) + 1;
  if (failure.status) run.failuresByHttpStatus[failure.status] = (run.failuresByHttpStatus[failure.status] || 0) + 1;
  if (failure.retryAfterMs !== undefined) run.retryAfterMs = failure.retryAfterMs;
  if (failure.kind === "forbidden") openScryfallCircuit(run, "HTTP_403");
  else if (failure.kind === "rate-limited") openScryfallCircuit(run, "HTTP_429");
  else {
    const equivalentKey = failure.kind === "timeout" || failure.kind === "network" || failure.kind === "invalid-response" || failure.kind === "malformed-json"
      ? failure.kind : failure.status && failure.status >= 500 ? `http_${failure.status}` : null;
    run.consecutiveFailures = equivalentKey && equivalentKey === run.consecutiveKey ? run.consecutiveFailures + 1 : equivalentKey ? 1 : 0;
    run.consecutiveKey = equivalentKey;
    if (run.consecutiveFailures >= SCRYFALL_FAILURE_THRESHOLD) openScryfallCircuit(run, `repeated_${equivalentKey?.replaceAll("-", "_")}`);
  }
  syncScryfallDiagnostics(run);
}

export function countMalformedRecords(run: ScryfallRunContext, count: number) {
  run.malformedRecordsDropped += count;
  syncScryfallDiagnostics(run);
}

export function retryAfterDuration(value: string | null, now: number) {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

/** Waits stop immediately on cancel, an open circuit, or the phase deadline. */
export function waitForProvider(run: ScryfallRunContext, ms: number, signal?: AbortSignal | null) {
  if (signal?.aborted) return Promise.reject(new DOMException("Processing canceled.", "AbortError"));
  if (providerCircuitFailure(run)) return Promise.resolve(false);
  return new Promise<boolean>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); run.controller.signal.removeEventListener("abort", stopped); };
    const cancel = () => { cleanup(); reject(new DOMException("Processing canceled.", "AbortError")); };
    const stopped = () => { cleanup(); resolve(false); };
    const remaining = remainingProviderMs(run);
    timer = setTimeout(() => {
      cleanup();
      if (ms >= remaining) { openScryfallCircuit(run, "time_budget"); resolve(false); }
      else resolve(true);
    }, Math.min(ms, remaining));
    signal?.addEventListener("abort", cancel, { once: true });
    run.controller.signal.addEventListener("abort", stopped, { once: true });
  });
}

import assert from "node:assert/strict";
import test from "node:test";
import { importBundledModule } from "./test-module-bundle.mjs";

const provider = await importBundledModule("src/scryfall-reliability.ts", "scryfall-reliability");
const metrics = await importBundledModule("src/processing-performance.ts", "provider-performance");
const failure = (kind, status) => ({ kind, status, operation: "scryfallPrintPages", retryable: true, attemptCount: 1 });

test("successful provider responses reset consecutive systemic failure tracking", () => {
  const run = provider.createScryfallRunContext();
  provider.recordProviderFailure(run, failure("network"));
  provider.recordProviderFailure(run, failure("network"));
  provider.recordProviderSuccess(run);
  provider.recordProviderFailure(run, failure("network"));
  provider.recordProviderFailure(run, failure("network"));
  assert.equal(run.state, "closed");
  provider.recordProviderFailure(run, failure("network"));
  assert.equal(run.state, "open");
  assert.equal(run.reason, "repeated_network");
  assert.equal(run.failuresByKind.network, 5);
});

test("unrelated transient failures do not form an equivalent consecutive threshold", () => {
  const run = provider.createScryfallRunContext();
  for (const kind of ["network", "timeout", "network", "timeout"]) provider.recordProviderFailure(run, failure(kind));
  assert.equal(run.state, "closed");
  for (let attempt = 0; attempt < 3; attempt += 1) provider.recordProviderFailure(run, failure("http-status", 503));
  assert.equal(run.reason, "repeated_http_503");
});

test("Retry-After supports seconds and HTTP dates without retaining provider text", () => {
  const now = Date.parse("2026-09-08T12:00:00Z");
  assert.equal(provider.retryAfterDuration("30", now), 30000);
  assert.equal(provider.retryAfterDuration("Tue, 08 Sep 2026 12:01:00 GMT", now), 60000);
  assert.equal(provider.retryAfterDuration("Tue, 08 Sep 2026 11:01:00 GMT", now), 0);
  assert.equal(provider.retryAfterDuration("invalid private provider text", now), undefined);
});

test("budget diagnostics report measured elapsed time rather than clipping an overrun", () => {
  let now = 100;
  const performance = metrics.createProcessingPerformance();
  const run = provider.createScryfallRunContext({ now: () => now, performance });
  provider.startProviderPhase(run);
  now += 25100;
  assert.equal(provider.providerCircuitFailure(run).kind, "phase-budget-exhausted");
  assert.equal(performance.providerElapsedMs, 25100);
  now += 10000;
  provider.syncScryfallDiagnostics(run);
  assert.equal(performance.providerElapsedMs, 25100, "Elapsed freezes when remote work stops");
});

test("request retry metrics count underlying attempts independently of logical retries", () => {
  const performance = metrics.createProcessingPerformance();
  const run = provider.createScryfallRunContext({ performance });
  provider.recordProviderAttempt(run, "scryfallPrintPages", 1);
  provider.recordProviderAttempt(run, "scryfallPrintPages", 2);
  assert.equal(performance.providerAttemptsUsed, 2);
  assert.equal(performance.counts.scryfallPrintPages, 2);
  assert.equal(performance.counts.requestRetries, 1);
  assert.equal(performance.counts.retries, 1);
  assert.equal(performance.counts.logicalCardRetries, 0);
});

test("opening a circuit interrupts an existing retry wait without issuing another request", async () => {
  const run = provider.createScryfallRunContext();
  provider.startProviderPhase(run);
  const waiting = provider.waitForProvider(run, 5000);
  provider.recordProviderFailure(run, { ...failure("rate-limited", 429), retryable: false, retryAfterMs: 30000 });
  assert.equal(await waiting, false);
  assert.equal(run.retryAfterMs, 30000);
  assert.equal(run.attemptsUsed, 0);
  assert.equal(provider.createScryfallRunContext({ purpose: "pricing-recovery" }).state, "closed");
});

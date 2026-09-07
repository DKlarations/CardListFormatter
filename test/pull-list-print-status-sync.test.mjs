import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { importBundledModule } from "./test-module-bundle.mjs";

const client = await importBundledModule("src/pull-list-job-client.ts", "print-status-client");
const { PullListPrintStatusSynchronizer } = await importBundledModule("src/pull-list-print-status-sync.ts", "print-status-sync");
const { updatePullListJobPrintStatus } = await importBundledModule("src/pull-list-job.ts", "print-status-job");
const { savedPullListPrintStatusBadges } = await importBundledModule("src/saved-pull-list-picker.ts", "print-status-picker");
const pullAt = "2026-09-07T05:41:00.000Z";
const pricingAt = "2026-09-07T06:08:00.000Z";
const workspace = { jobId: "pl_browserprint1234", generation: 1 };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness() {
  const pending = [];
  const events = [];
  const state = { workspace, printStatus: {}, warnings: {}, pricingState: { rows: [{ selectedPrintingUuid: "exact-uuid", manualPrice: "12.34" }] } };
  const sync = new PullListPrintStatusSynchronizer({
    currentWorkspace: () => state.workspace,
    updateLocalStatus: (target, printedAt) => {
      events.push("local");
      state.printStatus = updatePullListJobPrintStatus(state.printStatus, target, printedAt);
    },
    onWarning: (target, warning) => { state.warnings[target] = warning; },
    persistStatus: (id, target, printedAt) => {
      events.push("request");
      const request = deferred();
      pending.push({ ...request, id, target, printedAt });
      return request.promise;
    },
  });
  return { sync, state, events, pending };
}

const saved = (status = "updated", reason) => ({
  job: { id: workspace.jobId, pricingState: { rows: [] } },
  teamsSync: { status, ...(reason ? { reason } : {}) },
});

test("both print actions update locally before waiting for the narrow request and retain pricing work", async () => {
  const { sync, state, events, pending } = harness();
  const pricingBefore = structuredClone(state.pricingState);
  const pull = sync.record(workspace, "pull-list", pullAt);
  events.push("print window");
  assert.deepEqual(events, ["local", "request", "print window"]);
  assert.deepEqual(state.printStatus, { pullListPrintedAt: pullAt, pricingPrintedAt: "" });
  const pricing = sync.record(workspace, "pricing", pricingAt);
  assert.deepEqual(state.printStatus, { pullListPrintedAt: pullAt, pricingPrintedAt: pricingAt });
  assert.deepEqual(pending.map(({ id, target, printedAt }) => ({ id, target, printedAt })), [
    { id: workspace.jobId, target: "pull-list", printedAt: pullAt },
    { id: workspace.jobId, target: "pricing", printedAt: pricingAt },
  ]);
  pending[1].resolve(saved());
  pending[0].resolve(saved());
  await Promise.all([pull, pricing]);
  assert.deepEqual(state.pricingState, pricingBefore, "full response jobs must never replace local pricing progress");
});

test("an unsaved list updates local print status without making a status request", async () => {
  const { sync, state, pending } = harness();
  state.workspace = { jobId: "", generation: 2 };
  await sync.record(state.workspace, "pull-list", pullAt);
  assert.deepEqual(state.printStatus, { pullListPrintedAt: pullAt, pricingPrintedAt: "" });
  assert.equal(pending.length, 0);
});

test("request failure does not reject or undo the print action, and Teams failure reports persisted status accurately", async () => {
  const { sync, state, pending } = harness();
  const pull = sync.record(workspace, "pull-list", pullAt);
  pending[0].reject(new Error("network unavailable"));
  await assert.doesNotReject(pull);
  assert.match(state.warnings["pull-list"], /could not be saved.*local work is still here/);
  assert.equal(state.printStatus.pullListPrintedAt, pullAt);
  const pricing = sync.record(workspace, "pricing", pricingAt);
  pending[1].resolve(saved("failed", "workflow-unavailable"));
  await pricing;
  assert.match(state.warnings.pricing, /Pricing Printed was saved, but the original Teams card could not be updated/);
  assert.equal(state.printStatus.pricingPrintedAt, pricingAt);
  assert.match(state.warnings["pull-list"], /could not be saved/, "the other target must not clear a failure");
});

test("manual-job skips stay quiet while missing email metadata or configuration produces a warning", async () => {
  for (const reason of ["not-email-job", "missing-message-identity", "missing-update-configuration", "missing-email-content"]) {
    const { sync, state, pending } = harness();
    const request = sync.record(workspace, "pull-list", pullAt);
    pending[0].resolve(saved("skipped", reason));
    await request;
    assert.equal(Boolean(state.warnings["pull-list"]), reason !== "not-email-job", reason);
  }
});

test("an older response cannot clear a newer failure or show a stale failure after success", async () => {
  for (const newestFails of [true, false]) {
    const { sync, state, pending } = harness();
    const oldRequest = sync.record(workspace, "pull-list", pullAt);
    const newRequest = sync.record(workspace, "pull-list", pricingAt);
    if (newestFails) pending[1].reject(new Error("new failure"));
    else pending[1].resolve(saved());
    await newRequest;
    const latestWarning = state.warnings["pull-list"];
    if (newestFails) pending[0].resolve(saved());
    else pending[0].reject(new Error("old failure"));
    await oldRequest;
    assert.equal(state.warnings["pull-list"], latestWarning);
    assert.equal(Boolean(latestWarning), newestFails);
    assert.equal(state.printStatus.pullListPrintedAt, pricingAt);
  }
});

test("switching workspaces keeps late responses and delayed print timers attached to the original job", async () => {
  const { sync, state, pending } = harness();
  const oldRequest = sync.record(workspace, "pricing", pricingAt);
  state.workspace = { jobId: "pl_different1234", generation: 2 };
  state.printStatus = {};
  state.warnings = {};
  const currentRequest = sync.record(state.workspace, "pricing", pricingAt);
  // A delayed timer from the old receipt still persists to that receipt's job.
  const delayedOldRequest = sync.record(workspace, "pricing", pullAt);
  assert.equal(pending[2].id, workspace.jobId);
  assert.deepEqual(state.printStatus, { pullListPrintedAt: "", pricingPrintedAt: pricingAt });
  pending[0].reject(new Error("old failure"));
  pending[2].reject(new Error("delayed old failure"));
  await Promise.all([oldRequest, delayedOldRequest]);
  assert.deepEqual(state.warnings, { pricing: "" });
  pending[1].reject(new Error("current failure"));
  await currentRequest;
  assert.match(state.warnings.pricing, /could not be saved/);
});

test("reopening the same job suppresses responses from its earlier workspace generation", async () => {
  const { sync, state, pending } = harness();
  const request = sync.record(workspace, "pull-list", pullAt);
  state.workspace = { ...workspace, generation: 3 };
  state.warnings = {};
  pending[0].reject(new Error("old workspace failure"));
  await request;
  assert.deepEqual(state.warnings, {});
});

test("the narrow client sends only the job ID, target, and timestamp; reloading restores both picker badges", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  const events = [];
  const job = { id: workspace.jobId, source: "email", printStatus: {}, teams: { messageId: "original-message" }, pricingState: { rows: [] } };
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    if (init.method === "POST") {
      const { target, printedAt } = JSON.parse(init.body);
      job.printStatus = updatePullListJobPrintStatus(job.printStatus, target, printedAt);
      return Response.json({ job, teamsSync: { status: "updated" } });
    }
    return Response.json({ job });
  };
  try {
    await client.persistPullListJobPrintStatus(workspace.jobId, "pull-list", pullAt, { onDiagnostic: (event) => events.push(event) });
    await client.persistPullListJobPrintStatus(workspace.jobId, "pricing", pricingAt);
    const restored = await client.loadPullListJob(workspace.jobId);
    assert.deepEqual(restored.printStatus, { pullListPrintedAt: pullAt, pricingPrintedAt: pricingAt });
    assert.deepEqual(savedPullListPrintStatusBadges(restored).map(({ kind }) => kind), ["pull-list", "pricing"]);
    assert.equal(restored.source, "email");
    assert.equal(restored.teams.messageId, "original-message");
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.deepEqual(requests.slice(0, 2).map(({ url, init }) => ({ url, method: init.method, body: JSON.parse(init.body) })), [
    { url: "/api/pull-list-jobs?action=print-status", method: "POST", body: { id: workspace.jobId, target: "pull-list", printedAt: pullAt } },
    { url: "/api/pull-list-jobs?action=print-status", method: "POST", body: { id: workspace.jobId, target: "pricing", printedAt: pricingAt } },
  ]);
  assert.equal(events[0].operation, "print-status");
  assert.equal(events[0].outcome, "success");
});

test("status HTTP failures and mismatched response identities reject with safe request diagnostics", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const response of [
      new Response(JSON.stringify({ error: "Saved Pull List not found." }), { status: 404 }),
      Response.json({ job: { id: "pl_wrongjob1234" }, teamsSync: { status: "updated" } }),
    ]) {
      const events = [];
      globalThis.fetch = async () => response;
      await assert.rejects(client.persistPullListJobPrintStatus(workspace.jobId, "pricing", pricingAt, {
        onDiagnostic: (event) => events.push(event),
      }), (error) => error instanceof client.SavedPullListRequestError);
      assert.equal(events[0].operation, "print-status");
      assert.equal(events[0].outcome, "failed");
      assert.equal(events[0].method, "POST");
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("browser wiring retains legacy list loading and avoids replacing pricing state after status responses", () => {
  const main = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
  const synchronizer = main.match(/const printStatusSynchronizer = useMemo[\s\S]*?const recordPricingPrinted/)?.[0] || "";
  assert.match(synchronizer, /void printStatusSynchronizer\.record/);
  assert.doesNotMatch(synchronizer, /restoreSavedJob|setPricingState|setInitialPricingState/);
  assert.match(main, /fetch\(`\/api\/formatted-lists\?id=\$\{encodeURIComponent\(sharedListId\)\}`\)/);
  assert.match(main, /currentJobPrintStatus=\{printStatus\}/);
  assert.match(main, /setPrintStatus\(job\.printStatus\)/);
});

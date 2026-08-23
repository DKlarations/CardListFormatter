import assert from "node:assert/strict";
import test from "node:test";
import { importBundledModule } from "./test-module-bundle.mjs";

const diagnostics = await importBundledModule("src/saved-pull-list-diagnostics.ts", "saved-pull-list-diagnostics");
const client = await importBundledModule("src/pull-list-job-client.ts", "saved-pull-list-client-diagnostics");

function draft() {
  return {
    customer: { name: "Customer Name", phone: "309-555-1234", email: "customer@example.com" },
    input: "Private pull-list contents",
    output: "Private formatted output",
    formatterItems: [{ inputName: "Lightning Bolt", quantity: 1 }],
    pricingState: { version: 1, rows: [], pricingSource: "tcgplayer-listed-median", includeNotFound: true },
    source: "manual",
    processedAt: "2026-08-23T12:00:00.000Z",
    stats: { resolvedCount: 1, needsReviewCount: 0, printFallbackCount: 0 },
    formatterSettings: { useCheckboxes: true },
  };
}

function withFetch(responseFactory, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = responseFactory;
  return Promise.resolve()
    .then(run)
    .finally(() => { globalThis.fetch = originalFetch; });
}

test("failed Saved Pull List responses preserve safe request metadata and the Vercel request ID", async () => {
  const events = [];
  await withFetch(
    async () => new Response(JSON.stringify({ error: "Redis environment variables are not configured." }), {
      status: 500,
      headers: { "content-type": "application/json", "x-vercel-id": "cle1::abc123" },
    }),
    async () => {
      await assert.rejects(
        client.persistPullListJob(draft(), "", { onDiagnostic: (event) => events.push(event) }),
        (error) => {
          assert.ok(error instanceof client.SavedPullListRequestError);
          assert.equal(error.status, 500);
          assert.equal(error.method, "POST");
          assert.equal(error.endpoint, "/api/pull-list-jobs");
          assert.equal(error.requestId, "cle1::abc123");
          assert.equal(error.message, "Redis environment variables are not configured.");
          return true;
        },
      );
    },
  );
  assert.deepEqual(events.map((event) => ({
    operation: event.operation,
    method: event.method,
    endpoint: event.endpoint,
    outcome: event.outcome,
    status: event.status,
    message: event.message,
    requestId: event.requestId,
  })), [{
    operation: "create",
    method: "POST",
    endpoint: "/api/pull-list-jobs",
    outcome: "failed",
    status: 500,
    message: "Redis environment variables are not configured.",
    requestId: "cle1::abc123",
  }]);
});

test("successful saves and expected duplicate conflicts create distinct diagnostic outcomes", async () => {
  const successEvents = [];
  await withFetch(
    async () => new Response(JSON.stringify({ job: { id: "pl_success1234" } }), {
      status: 201,
      headers: { "content-type": "application/json" },
    }),
    () => client.persistPullListJob(draft(), "", { onDiagnostic: (event) => successEvents.push(event) }),
  );
  assert.equal(successEvents[0].outcome, "success");
  assert.equal(successEvents[0].operation, "create");
  assert.equal(successEvents[0].status, 201);
  assert.equal(successEvents[0].jobId, "pl_success1234");

  const duplicateEvents = [];
  await withFetch(
    async () => new Response(JSON.stringify({ duplicate: true, existingJob: { id: "pl_duplicate1234" } }), {
      status: 409,
      headers: { "content-type": "application/json" },
    }),
    () => client.persistPullListJob(draft(), "", { onDiagnostic: (event) => duplicateEvents.push(event) }),
  );
  assert.equal(duplicateEvents[0].outcome, "duplicate");
  assert.equal(duplicateEvents[0].status, 409);
  assert.equal(duplicateEvents[0].jobId, "pl_duplicate1234");
});

test("load, Recent, and search requests retain their API behavior while recording distinct operations", async () => {
  const events = [];
  const urls = [];
  await withFetch(
    async (url) => {
      const requestUrl = String(url);
      urls.push(requestUrl);
      if (requestUrl.includes("?id=pl_load1234")) {
        return new Response(JSON.stringify({ job: { id: "pl_load1234" } }), { status: 200 });
      }
      return new Response(JSON.stringify({ jobs: [] }), { status: 200 });
    },
    async () => {
      await client.loadPullListJob("pl_load1234", { onDiagnostic: (event) => events.push(event) });
      await client.listPullListJobs({ limit: 15 }, { onDiagnostic: (event) => events.push(event) });
      await client.listPullListJobs({ namePrefix: "john", limit: 15 }, { onDiagnostic: (event) => events.push(event) });
    },
  );
  assert.deepEqual(urls, [
    "/api/pull-list-jobs?id=pl_load1234",
    "/api/pull-list-jobs?limit=15",
    "/api/pull-list-jobs?namePrefix=john&limit=15",
  ]);
  assert.deepEqual(events.map((event) => event.operation), ["load", "recent", "search"]);
  assert.ok(events.every((event) => event.endpoint === "/api/pull-list-jobs"));
});

test("DELETE records safe success and failure diagnostics including Vercel request IDs", async () => {
  const successEvents = [];
  const requested = [];
  await withFetch(
    async (url, init) => {
      requested.push({ url: String(url), method: init.method, body: init.body });
      return new Response(JSON.stringify({ deleted: true, id: "pl_delete1234abcd" }), {
        status: 200,
        headers: { "content-type": "application/json", "x-vercel-id": "cle1::delete-ok" },
      });
    },
    () => client.deletePullListJob("pl_delete1234abcd", { onDiagnostic: (event) => successEvents.push(event) }),
  );
  assert.deepEqual(requested, [{
    url: "/api/pull-list-jobs?id=pl_delete1234abcd",
    method: "DELETE",
    body: undefined,
  }]);
  assert.deepEqual(successEvents.map((event) => ({
    operation: event.operation,
    method: event.method,
    endpoint: event.endpoint,
    outcome: event.outcome,
    status: event.status,
    jobId: event.jobId,
    requestId: event.requestId,
  })), [{
    operation: "delete",
    method: "DELETE",
    endpoint: "/api/pull-list-jobs",
    outcome: "success",
    status: 200,
    jobId: "pl_delete1234abcd",
    requestId: "cle1::delete-ok",
  }]);
  const report = diagnostics.formatSavedPullListDiagnosticReport(successEvents);
  assert.match(report, /DELETE\nDELETE \/api\/pull-list-jobs\nHTTP 200\nSUCCESS/);
  assert.match(report, /Job: #1234abcd/);

  const failureEvents = [];
  await withFetch(
    async () => new Response(JSON.stringify({ error: "Deletion service unavailable." }), {
      status: 500,
      headers: { "content-type": "application/json", "x-vercel-id": "cle1::delete-failed" },
    }),
    () => assert.rejects(
      client.deletePullListJob("pl_delete1234abcd", { onDiagnostic: (event) => failureEvents.push(event) }),
      (error) => {
        assert.equal(error.method, "DELETE");
        assert.equal(error.message, "Deletion service unavailable.");
        return true;
      },
    ),
  );
  assert.equal(failureEvents[0].operation, "delete");
  assert.equal(failureEvents[0].outcome, "failed");
  assert.equal(failureEvents[0].status, 500);
  assert.equal(failureEvents[0].requestId, "cle1::delete-failed");
});

test("diagnostics keep only the five newest allowlisted events and never serialize request payload data", () => {
  const events = Array.from({ length: 6 }, (_, index) => diagnostics.createSavedPullListDiagnostic({
    timestamp: `2026-08-23T12:00:0${index}.000Z`,
    operation: "autosave",
    method: "PUT",
    endpoint: "/api/pull-list-jobs",
    outcome: "success",
    status: 200,
    message: `Autosave ${index}`,
    jobId: `pl_${index}`,
    customer: "Customer Name",
    phone: "309-555-1234",
    email: "customer@example.com",
    input: "Private pull-list contents",
    redisToken: "UPSTASH_REDIS_REST_TOKEN=secret",
  }));
  const history = events.reduce((current, event) => diagnostics.addSavedPullListDiagnostic(current, event), []);
  assert.equal(history.length, 5);
  assert.equal(history[0].message, "Autosave 5");
  assert.equal(history[4].message, "Autosave 1");

  const report = diagnostics.formatSavedPullListDiagnosticReport(history);
  for (const sensitiveValue of [
    "Customer Name",
    "309-555-1234",
    "customer@example.com",
    "Private pull-list contents",
    "UPSTASH_REDIS_REST_TOKEN=secret",
  ]) {
    assert.equal(report.includes(sensitiveValue), false);
  }
});

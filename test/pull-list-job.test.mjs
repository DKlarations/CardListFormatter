import assert from "node:assert/strict";
import test from "node:test";
import { importBundledModule } from "./test-module-bundle.mjs";

const jobs = await importBundledModule("src/pull-list-job.ts", "pull-list-job");
const repository = await importBundledModule("api/_pull-list-job-repository.ts", "pull-list-job-repository");
const jobApi = await importBundledModule("api/pull-list-jobs.ts", "pull-list-jobs-api");
const jobClient = await importBundledModule("src/pull-list-job-client.ts", "pull-list-job-client");

import { FakePullListRedis as FakeRedis } from "./fake-pull-list-redis.mjs";

function draft({ quantity = 1, setCode = "", customerName = "Jane Doe", price = null } = {}) {
  return {
    customer: { name: customerName, phone: "(309) 555-1234", email: "JANE@example.com" },
    input: `${quantity} Lightning Bolt`,
    output: ".\nJane Doe\n1 Lightning Bolt\n.",
    formatterItems: [{
      index: 0,
      quantity,
      inputName: "Lightning Bolt",
      status: "found",
      card: { name: "Lightning Bolt" },
      ...(setCode ? { requestedPrinting: { setCode } } : {}),
    }],
    pricingState: {
      version: 1,
      pricingSource: "tcgplayer-listed-median",
      includeNotFound: true,
      rows: [{
        id: "card-0-original",
        groupId: "card-0",
        sourceIndex: 0,
        requestedQuantity: quantity,
        isBasicLand: false,
        quantity,
        found: true,
        resolved: true,
        displayName: "Lightning Bolt",
        canonicalName: "Lightning Bolt",
        setSelectionSource: "manual",
        setCode: setCode || "2XM",
        selectedPrintingUuid: "exact-uuid",
        finish: "normal",
        treatment: "borderless",
        foilTreatment: "standard",
        priceOverride: price,
      }],
    },
    source: "manual",
    formatterSettings: { useCheckboxes: true },
    processedAt: "2026-08-23T12:00:00.000Z",
    stats: { resolvedCount: 1, needsReviewCount: 0, printFallbackCount: 0 },
  };
}

test("old Saved Pull Lists normalize with empty print status", () => {
  const normalizedDraft = jobs.normalizePullListJobDraft(draft());
  const normalizedJob = jobs.normalizePullListJob({
    ...draft(),
    id: "pl_old",
    createdAt: "2026-08-23T12:00:00.000Z",
    updatedAt: "2026-08-23T12:00:00.000Z",
    expiresAt: "2026-09-22T12:00:00.000Z",
  });
  assert.deepEqual(normalizedDraft.printStatus, jobs.emptyPullListJobPrintStatus());
  assert.deepEqual(normalizedJob.printStatus, jobs.emptyPullListJobPrintStatus());
});

test("valid print timestamps survive draft, job, and summary normalization", () => {
  const printStatus = {
    pullListPrintedAt: "2026-08-30T23:16:00.000Z",
    pricingPrintedAt: "2026-08-30T23:42:00.000Z",
  };
  const normalizedDraft = jobs.normalizePullListJobDraft({ ...draft(), printStatus });
  const normalizedJob = jobs.normalizePullListJob({
    ...draft(),
    printStatus,
    id: "pl_printed",
    createdAt: "2026-08-23T12:00:00.000Z",
    updatedAt: "2026-08-30T23:42:00.000Z",
    expiresAt: "2026-09-29T23:42:00.000Z",
  });
  const summary = jobs.savedJobSummary(normalizedJob);
  const normalizedSummary = jobs.normalizeSavedJobSummary(summary);
  assert.deepEqual(normalizedDraft.printStatus, printStatus);
  assert.deepEqual(normalizedJob.printStatus, printStatus);
  assert.deepEqual(summary.printStatus, printStatus);
  assert.deepEqual(normalizedSummary.printStatus, printStatus);
});

test("malformed print timestamps are ignored without fake fallback dates", () => {
  const malformed = jobs.normalizePullListJobPrintStatus({
    pullListPrintedAt: "not-a-date",
    pricingPrintedAt: 123,
  });
  assert.deepEqual(malformed, { pullListPrintedAt: "", pricingPrintedAt: "" });
});

test("print updates change only their target and repeated prints keep the latest timestamp", () => {
  const firstPull = jobs.updatePullListJobPrintStatus(
    jobs.emptyPullListJobPrintStatus(),
    "pull-list",
    "2026-08-30T23:16:00.000Z",
  );
  assert.deepEqual(firstPull, {
    pullListPrintedAt: "2026-08-30T23:16:00.000Z",
    pricingPrintedAt: "",
  });
  const pricing = jobs.updatePullListJobPrintStatus(firstPull, "pricing", "2026-08-30T23:42:00.000Z");
  assert.deepEqual(pricing, {
    pullListPrintedAt: "2026-08-30T23:16:00.000Z",
    pricingPrintedAt: "2026-08-30T23:42:00.000Z",
  });
  const repeatedPull = jobs.updatePullListJobPrintStatus(pricing, "pull-list", "2026-08-31T00:01:00.000Z");
  assert.deepEqual(repeatedPull, {
    pullListPrintedAt: "2026-08-31T00:01:00.000Z",
    pricingPrintedAt: "2026-08-30T23:42:00.000Z",
  });
  assert.deepEqual(jobs.emptyPullListJobPrintStatus(), {
    pullListPrintedAt: "",
    pricingPrintedAt: "",
  });
});

test("Recent and Search summaries include normalized print status", async () => {
  const store = new FakeRedis();
  const printedDraft = {
    ...draft(),
    printStatus: {
      pullListPrintedAt: "2026-08-30T23:16:00.000Z",
      pricingPrintedAt: "2026-08-30T23:42:00.000Z",
    },
  };
  const created = await repository.createPullListJob(store, printedDraft, Date.parse("2026-08-30T23:42:00Z"));
  const recent = await repository.searchPullListJobs(store, {}, Date.parse("2026-08-30T23:43:00Z"));
  const search = await repository.searchPullListJobs(store, { namePrefix: "jane" }, Date.parse("2026-08-30T23:43:00Z"));
  assert.deepEqual(created.job.printStatus, printedDraft.printStatus);
  assert.deepEqual(recent[0].printStatus, printedDraft.printStatus);
  assert.deepEqual(search[0].printStatus, printedDraft.printStatus);
});

test("saved pricing normalization preserves exact staff selections and manual overrides", () => {
  const raw = draft({ price: "1.25" }).pricingState;
  raw.rows.push({
    ...raw.rows[0],
    id: "manual-sol-ring",
    groupId: "manual-sol-ring",
    sourceIndex: Number.MAX_SAFE_INTEGER,
    manuallyCreated: true,
    displayName: "Sol Ring",
    canonicalName: "Sol Ring",
    selectedPrintingUuid: "manual-exact-uuid",
    finish: "foil",
    foilTreatment: "surge",
    priceOverride: "9.00",
  });
  const state = jobs.normalizeSavedPricingState(raw);
  assert.equal(state.rows[0].found, true);
  assert.equal(state.rows[0].selectedPrintingUuid, "exact-uuid");
  assert.equal(state.rows[0].treatment, "borderless");
  assert.equal(state.rows[0].priceOverride, "1.25");
  assert.equal(state.rows[1].manuallyCreated, true);
  assert.equal(state.rows[1].foilTreatment, "surge");
  assert.equal(state.rows[1].selectedPrintingUuid, "manual-exact-uuid");
  assert.deepEqual(state.excludedSourceIndices, []);
  assert.equal(jobs.pricingStateForWorkspaceLoad("saved-job", state).rows.length, 2);
  assert.equal(jobs.pricingStateForWorkspaceLoad("copy-link", state), null);
});

test("saved pricing normalization safely defaults, deduplicates, and bounds exclusions", () => {
  const oldState = draft().pricingState;
  assert.deepEqual(jobs.normalizeSavedPricingState(oldState).excludedSourceIndices, []);

  const malformed = jobs.normalizeSavedPricingState({
    ...oldState,
    excludedSourceIndices: [4, 4, "bad", null, 7, -1, 2.5, Number.POSITIVE_INFINITY],
  });
  assert.deepEqual(malformed.excludedSourceIndices, [4, 7]);

  const bounded = jobs.normalizeSavedPricingState({
    ...oldState,
    excludedSourceIndices: Array.from({ length: 1005 }, (_, index) => index),
  });
  assert.equal(bounded.excludedSourceIndices.length, 1000);
  assert.equal(bounded.excludedSourceIndices.at(-1), 999);
});

test("Saved Pull Lists restore exclusions while Copy Link deliberately starts fresh", () => {
  const raw = draft().pricingState;
  raw.excludedSourceIndices = [0, 0];
  const saved = jobs.pricingStateForWorkspaceLoad("saved-job", raw);

  assert.deepEqual(saved.excludedSourceIndices, [0]);
  assert.equal(saved.rows.length, 1);
  assert.equal(jobs.pricingStateForWorkspaceLoad("copy-link", raw), null);
});

test("Saved Pull List persistence retains exclusions without changing formatter card counts", async () => {
  const store = new FakeRedis();
  const excludedDraft = draft();
  excludedDraft.pricingState.rows = [];
  excludedDraft.pricingState.excludedSourceIndices = [0];
  const created = await repository.createPullListJob(
    store,
    excludedDraft,
    Date.parse("2026-08-23T12:00:00Z"),
  );
  const restored = await repository.getPullListJob(
    store,
    created.job.id,
    Date.parse("2026-08-23T12:01:00Z"),
  );
  const summary = jobs.savedJobSummary(restored);

  assert.deepEqual(restored.pricingState.excludedSourceIndices, [0]);
  assert.deepEqual(restored.pricingState.rows, []);
  assert.equal(summary.cardCount, 1);
  assert.equal(summary.foundCount, 0);
});

test("creates cross-PC duplicate conflicts, but updates the same current job", async () => {
  const store = new FakeRedis();
  const first = await repository.createPullListJob(store, draft(), Date.parse("2026-08-23T12:00:00Z"));
  assert.equal(first.status, "created");
  const duplicate = await repository.createPullListJob(store, draft({ customerName: "John Smith" }), Date.parse("2026-08-23T13:00:00Z"));
  assert.equal(duplicate.status, "duplicate");
  assert.equal(duplicate.existingJob.id, first.job.id);
  assert.equal(duplicate.existingJob.customer.name, "Jane Doe");

  const ownUpdate = await repository.updatePullListJob(store, first.job.id, draft({ price: "2.50" }), Date.parse("2026-08-23T14:00:00Z"));
  assert.equal(ownUpdate.status, "updated");
  assert.equal(ownUpdate.job.pricingState.rows[0].priceOverride, "2.50");
});

test("expired jobs and stale fingerprint mappings do not block a new job", async () => {
  const store = new FakeRedis();
  const createdAt = Date.parse("2026-07-01T12:00:00Z");
  const first = await repository.createPullListJob(store, draft(), createdAt);
  const afterExpiry = createdAt + (jobs.SAVED_PULL_LIST_TTL_SECONDS + 1) * 1000;
  const second = await repository.createPullListJob(store, draft(), afterExpiry);
  assert.equal(first.status, "created");
  assert.equal(second.status, "created");
  assert.notEqual(second.job.id, first.job.id);
});

test("updating card identity moves the fingerprint and exact search indexes", async () => {
  const store = new FakeRedis();
  const first = await repository.createPullListJob(store, draft(), Date.parse("2026-08-23T12:00:00Z"));
  const oldFingerprintKey = `${repository.PULL_LIST_FINGERPRINT_KEY_PREFIX}${first.job.fingerprint}`;
  const changed = await repository.updatePullListJob(store, first.job.id, draft({ quantity: 2, customerName: "JANE DOE" }), Date.parse("2026-08-23T13:00:00Z"));
  assert.equal(changed.status, "updated");
  assert.equal(await store.get(oldFingerprintKey), null);
  const results = await repository.searchPullListJobs(store, { name: "jane doe" }, Date.parse("2026-08-23T13:00:00Z"));
  assert.equal(results.length, 1);
  assert.equal(results[0].id, first.job.id);
  const byPhone = await repository.searchPullListJobs(store, { phone: "309.555.1234" }, Date.parse("2026-08-23T13:00:00Z"));
  const byEmail = await repository.searchPullListJobs(store, { email: " JANE@EXAMPLE.COM " }, Date.parse("2026-08-23T13:00:00Z"));
  assert.equal(byPhone[0].id, first.job.id);
  assert.equal(byEmail[0].id, first.job.id);
});

test("partial normalized name search returns distinct jobs newest first", async () => {
  const store = new FakeRedis();
  const john = await repository.createPullListJob(
    store,
    draft({ quantity: 1, customerName: "John Smith" }),
    Date.parse("2026-08-21T12:00:00Z"),
  );
  const johnny = await repository.createPullListJob(
    store,
    draft({ quantity: 2, customerName: "Johnny Appleseed" }),
    Date.parse("2026-08-23T12:00:00Z"),
  );
  await repository.createPullListJob(
    store,
    draft({ quantity: 3, customerName: "Jane Doe" }),
    Date.parse("2026-08-22T12:00:00Z"),
  );

  const matches = await repository.searchPullListJobs(
    store,
    { namePrefix: " JoHn " },
    Date.parse("2026-08-23T13:00:00Z"),
  );
  assert.deepEqual(matches.map((job) => job.id), [johnny.job.id, john.job.id]);
  assert.deepEqual(matches.map((job) => job.customer.name), ["Johnny Appleseed", "John Smith"]);
});

test("Recent results and exact normalized phone/email results are newest first", async () => {
  const store = new FakeRedis();
  const older = await repository.createPullListJob(
    store,
    draft({ quantity: 1, customerName: "Older Job" }),
    Date.parse("2026-08-21T12:00:00Z"),
  );
  const newerDraft = draft({ quantity: 2, customerName: "Newer Job" });
  newerDraft.customer.phone = "309.555.1234";
  newerDraft.customer.email = "jane@example.com";
  const newer = await repository.createPullListJob(store, newerDraft, Date.parse("2026-08-23T12:00:00Z"));

  const recent = await repository.searchPullListJobs(store, {}, Date.parse("2026-08-23T13:00:00Z"));
  assert.deepEqual(recent.map((job) => job.id), [newer.job.id, older.job.id]);
  const byPhone = await repository.searchPullListJobs(store, { phone: "(309) 555-1234" }, Date.parse("2026-08-23T13:00:00Z"));
  const byEmail = await repository.searchPullListJobs(store, { email: " JANE@EXAMPLE.COM " }, Date.parse("2026-08-23T13:00:00Z"));
  assert.equal(byPhone[0].id, newer.job.id);
  assert.equal(byEmail[0].id, newer.job.id);
});

test("deleting a job removes every owned reference, preserves same-customer jobs, and releases duplicate detection", async () => {
  const store = new FakeRedis();
  const target = await repository.createPullListJob(
    store,
    draft({ quantity: 1, customerName: "Jake Stimac" }),
    Date.parse("2026-08-23T12:00:00Z"),
  );
  const other = await repository.createPullListJob(
    store,
    draft({ quantity: 2, customerName: "Jake Stimac" }),
    Date.parse("2026-08-23T13:00:00Z"),
  );

  const deleted = await repository.deletePullListJob(store, target.job.id, Date.parse("2026-08-23T14:00:00Z"));
  assert.deepEqual(deleted, { status: "deleted", id: target.job.id });
  assert.equal(await repository.getPullListJob(store, target.job.id), null);
  assert.equal(
    await store.get(`${repository.PULL_LIST_FINGERPRINT_KEY_PREFIX}${target.job.fingerprint}`),
    null,
  );

  const recent = await repository.searchPullListJobs(store, {}, Date.parse("2026-08-23T14:00:00Z"));
  const exactName = await repository.searchPullListJobs(store, { name: "jake stimac" }, Date.parse("2026-08-23T14:00:00Z"));
  const byPhone = await repository.searchPullListJobs(store, { phone: "3095551234" }, Date.parse("2026-08-23T14:00:00Z"));
  const byEmail = await repository.searchPullListJobs(store, { email: "jane@example.com" }, Date.parse("2026-08-23T14:00:00Z"));
  for (const results of [recent, exactName, byPhone, byEmail]) {
    assert.deepEqual(results.map((job) => job.id), [other.job.id]);
  }
  for (const prefix of repository.normalizedCustomerNamePrefixes("Jake Stimac")) {
    const matches = await repository.searchPullListJobs(
      store,
      { namePrefix: prefix },
      Date.parse("2026-08-23T14:00:00Z"),
    );
    assert.deepEqual(matches.map((job) => job.id), [other.job.id], `prefix ${prefix}`);
  }

  const recreated = await repository.createPullListJob(
    store,
    draft({ quantity: 1, customerName: "Replacement Customer" }),
    Date.parse("2026-08-23T15:00:00Z"),
  );
  assert.equal(recreated.status, "created");
  assert.notEqual(recreated.job.id, target.job.id);
  assert.ok(await repository.getPullListJob(store, other.job.id));
});

test("deleting a job does not remove a fingerprint mapping now owned by another job", async () => {
  const store = new FakeRedis();
  const target = await repository.createPullListJob(store, draft(), Date.parse("2026-08-23T12:00:00Z"));
  const fingerprintKey = `${repository.PULL_LIST_FINGERPRINT_KEY_PREFIX}${target.job.fingerprint}`;
  await store.set(fingerprintKey, "pl_new_owner");

  await repository.deletePullListJob(store, target.job.id, Date.parse("2026-08-23T13:00:00Z"));
  assert.equal(await store.get(fingerprintKey), "pl_new_owner");
});

test("job and fingerprint TTLs use 30 days from the latest meaningful update", async () => {
  const store = new FakeRedis();
  const first = await repository.createPullListJob(store, draft(), Date.parse("2026-08-23T12:00:00Z"));
  const jobKey = `${repository.PULL_LIST_JOB_KEY_PREFIX}${first.job.id}`;
  const fingerprintKey = `${repository.PULL_LIST_FINGERPRINT_KEY_PREFIX}${first.job.fingerprint}`;
  assert.equal(jobs.SAVED_PULL_LIST_TTL_SECONDS, 30 * 24 * 60 * 60);
  assert.equal(store.ttls.get(jobKey), jobs.SAVED_PULL_LIST_TTL_SECONDS);
  assert.equal(store.ttls.get(fingerprintKey), jobs.SAVED_PULL_LIST_TTL_SECONDS);

  const updated = await repository.updatePullListJob(store, first.job.id, draft({ price: "3.00" }), Date.parse("2026-08-24T12:00:00Z"));
  assert.equal(updated.job.expiresAt, "2026-09-23T12:00:00.000Z");
  assert.equal(store.ttls.get(jobKey), jobs.SAVED_PULL_LIST_TTL_SECONDS);
});

test("Saved Pull List API creates, updates, loads, lists, searches, and deletes without a staff session", async () => {
  const store = new FakeRedis();
  const api = jobApi.createPullListJobHandlers(() => store);
  const createdResponse = await api.POST(new Request("https://pullsmith.example/api/pull-list-jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ job: draft() }),
  }));
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.ok(created.job.id);

  const updatedDraft = draft({ price: "2.50" });
  const updatedResponse = await api.PUT(new Request("https://pullsmith.example/api/pull-list-jobs", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: created.job.id, job: updatedDraft }),
  }));
  assert.equal(updatedResponse.status, 200);

  const loadedResponse = await api.GET(new Request(`https://pullsmith.example/api/pull-list-jobs?id=${created.job.id}`));
  assert.equal(loadedResponse.status, 200);
  assert.equal((await loadedResponse.json()).job.pricingState.rows[0].priceOverride, "2.50");

  const recentResponse = await api.GET(new Request("https://pullsmith.example/api/pull-list-jobs?limit=15"));
  assert.equal(recentResponse.status, 200);
  assert.equal((await recentResponse.json()).jobs.length, 1);

  const searchedResponse = await api.GET(new Request("https://pullsmith.example/api/pull-list-jobs?namePrefix=jane"));
  assert.equal(searchedResponse.status, 200);
  assert.equal((await searchedResponse.json()).jobs[0].id, created.job.id);

  const phoneResponse = await api.GET(new Request("https://pullsmith.example/api/pull-list-jobs?phone=3095551234"));
  assert.equal(phoneResponse.status, 200);
  assert.equal((await phoneResponse.json()).jobs[0].id, created.job.id);

  const emailResponse = await api.GET(new Request("https://pullsmith.example/api/pull-list-jobs?email=jane%40example.com"));
  assert.equal(emailResponse.status, 200);
  assert.equal((await emailResponse.json()).jobs[0].id, created.job.id);

  const deletedResponse = await api.DELETE(new Request(`https://pullsmith.example/api/pull-list-jobs?id=${created.job.id}`, {
    method: "DELETE",
  }));
  assert.equal(deletedResponse.status, 200);
  assert.deepEqual(await deletedResponse.json(), { deleted: true, id: created.job.id });

  const missingResponse = await api.DELETE(new Request(`https://pullsmith.example/api/pull-list-jobs?id=${created.job.id}`, {
    method: "DELETE",
  }));
  assert.equal(missingResponse.status, 404);
  assert.deepEqual(await missingResponse.json(), { error: "Saved Pull List not found." });
});

test("Copy Link URL construction strips private job identity", () => {
  const source = { href: "https://pullsmith.example/?job=pl_private&list=legacy#formatted=old" };
  const shared = jobClient.formatterShareUrlWithoutJob(source);
  assert.equal(shared.searchParams.has("job"), false);
  assert.equal(shared.searchParams.get("list"), "legacy");
  assert.equal(shared.hash, "");
  const saved = jobClient.pullListJobUrl("pl_next", source);
  assert.equal(saved.searchParams.get("job"), "pl_next");
  assert.equal(saved.searchParams.has("list"), false);
});

test("email display and complete Teams identity survive normalization without truncating content", () => {
  const emailDisplay = { sender: " Sender <sender@example.com> ", subject: "Full subject", receivedAt: "2026-09-07T06:00:00Z", body: "Original list\n".repeat(1000) };
  const teams = { teamId: "team", channelId: "channel", conversationId: "conversation", messageId: "message", messageLink: "https://teams.microsoft.com/message", postedAt: "2026-09-07T06:01:00.000Z" };
  const job = jobs.normalizePullListJobDraft({ ...draft(), source: "email", teams, emailDisplay });
  assert.deepEqual(job.teams, teams);
  assert.equal(job.emailDisplay.body, emailDisplay.body);
  assert.equal(job.emailDisplay.sender, emailDisplay.sender);
  assert.equal(job.emailDisplay.receivedAt, "2026-09-07T06:00:00.000Z");
  assert.equal(jobs.normalizePullListJobDraft(draft()).emailDisplay, undefined);
});

const mutationNow = Date.parse("2026-09-07T08:00:00Z");
function emailDraft() {
  return {
    ...draft({ price: "4.25" }), source: "email",
    teams: { teamId: "team-1", channelId: "channel-1", conversationId: "conversation-1", messageId: "message-1", messageLink: "https://teams.microsoft.com/message-1", postedAt: "2026-09-07T07:00:00.000Z" },
    emailDisplay: { sender: "Jane", subject: "Pull list", receivedAt: "2026-09-07T06:59:00.000Z", body: "Original complete email\n1 Lightning Bolt" },
  };
}

test("narrow print status preserves every unrelated raw field and refreshes existing job and index TTLs", async () => {
  const store = new FakeRedis();
  const created = await repository.createPullListJob(store, emailDraft(), mutationNow);
  const key = `${repository.PULL_LIST_JOB_KEY_PREFIX}${created.job.id}`;
  const before = await store.get(key);
  before.futureServerMetadata = { unknown: [[], { exactly: "001234" }] };
  before.pricingState.futureOption = ["retained"];
  before.printStatus.futureStatus = "retained";
  await store.set(key, before);
  const indexNames = [...store.zsets.keys()];
  const result = await repository.mutatePullListJobPrintStatus(store, before.id, "pull-list", "2026-09-07T03:02:00-05:00", mutationNow + 120000);
  assert.equal(result.status, "updated");
  assert.equal(result.changed, true);
  const after = await store.get(key);
  assert.deepEqual(after, { ...before, printStatus: { ...before.printStatus, pullListPrintedAt: "2026-09-07T08:02:00.000Z" }, updatedAt: "2026-09-07T08:02:00.000Z", expiresAt: "2026-10-07T08:02:00.000Z" });
  assert.deepEqual([...store.zsets.keys()], indexNames);
  for (const index of indexNames) {
    assert.equal(store.zsets.get(index).get(before.id), mutationNow + 120000);
    assert.equal(store.ttls.get(index), jobs.SAVED_PULL_LIST_TTL_SECONDS);
  }
  assert.equal(store.ttls.get(key), jobs.SAVED_PULL_LIST_TTL_SECONDS);
  assert.equal(store.ttls.get(`${repository.PULL_LIST_FINGERPRINT_KEY_PREFIX}${before.fingerprint}`), jobs.SAVED_PULL_LIST_TTL_SECONDS);
  assert.equal([...store.values.keys()].filter((entry) => entry.startsWith(repository.PULL_LIST_JOB_KEY_PREFIX)).length, 1);
});

test("narrow mutation independently handles both statuses, repeat requests, old timestamps, missing jobs, and malformed input", async () => {
  const store = new FakeRedis();
  const { job } = await repository.createPullListJob(store, emailDraft(), mutationNow);
  const first = await repository.mutatePullListJobPrintStatus(store, job.id, "pull-list", "2026-09-07T08:01:00Z", mutationNow + 60000);
  const pricing = await repository.mutatePullListJobPrintStatus(store, job.id, "pricing", "2026-09-07T08:02:00Z", mutationNow + 120000);
  assert.deepEqual(pricing.job.printStatus, { pullListPrintedAt: first.job.printStatus.pullListPrintedAt, pricingPrintedAt: "2026-09-07T08:02:00.000Z" });
  const repeated = await repository.mutatePullListJobPrintStatus(store, job.id, "pull-list", first.job.printStatus.pullListPrintedAt, mutationNow + 180000);
  assert.equal(repeated.changed, false);
  const older = await repository.mutatePullListJobPrintStatus(store, job.id, "pricing", "2026-09-07T08:00:00Z", mutationNow + 180000);
  assert.equal(older.changed, false);
  assert.deepEqual(older.job.printStatus, pricing.job.printStatus);
  assert.deepEqual(await repository.mutatePullListJobPrintStatus(store, "pl_missing", "pricing", "2026-09-07T08:00:00Z", mutationNow), { status: "not-found" });
  for (const values of [["invalid:id", "pricing", "2026-09-07T08:00:00Z"], [job.id, "pricedAt", "2026-09-07T08:00:00Z"], [job.id, "pricing", "bad"], [job.id, "pricing", 123]]) {
    await assert.rejects(repository.mutatePullListJobPrintStatus(store, ...values, mutationNow));
  }
});

test("stale autosave cannot erase a print or protected email metadata when a print wins the write race", async () => {
  const store = new FakeRedis();
  const { job } = await repository.createPullListJob(store, emailDraft(), mutationNow);
  store.beforeCompareAndSet = async () => {
    await repository.mutatePullListJobPrintStatus(store, job.id, "pull-list", "2026-09-07T08:01:00Z", mutationNow + 60000);
  };
  const stale = { ...draft({ price: "9.99" }), source: "manual", teams: { messageId: "forged" }, emailDisplay: { body: "forged" }, printStatus: jobs.emptyPullListJobPrintStatus() };
  const result = await repository.updatePullListJob(store, job.id, stale, mutationNow + 120000);
  assert.equal(result.job.source, "email");
  assert.deepEqual(result.job.teams, job.teams);
  assert.deepEqual(result.job.emailDisplay, job.emailDisplay);
  assert.equal(result.job.printStatus.pullListPrintedAt, "2026-09-07T08:01:00.000Z");
  assert.equal(result.job.pricingState.rows[0].priceOverride, "9.99");
  assert.deepEqual(result.job.customer, job.customer);
  assert.deepEqual(result.job.formatterItems, job.formatterItems);
  assert.equal(result.job.fingerprint, job.fingerprint);
});

test("print CAS retries against the newest autosave and two concurrent print targets both survive", async () => {
  const store = new FakeRedis();
  const { job } = await repository.createPullListJob(store, emailDraft(), mutationNow);
  store.beforeCompareAndSet = async () => {
    await repository.updatePullListJob(store, job.id, draft({ price: "12.50" }), mutationNow + 60000);
  };
  await repository.mutatePullListJobPrintStatus(store, job.id, "pull-list", "2026-09-07T08:02:00Z", mutationNow + 120000);
  store.beforeCompareAndSet = async () => {
    await repository.mutatePullListJobPrintStatus(store, job.id, "pull-list", "2026-09-07T08:03:00Z", mutationNow + 180000);
  };
  const result = await repository.mutatePullListJobPrintStatus(store, job.id, "pricing", "2026-09-07T08:04:00Z", mutationNow + 240000);
  assert.equal(result.job.pricingState.rows[0].priceOverride, "12.50");
  assert.deepEqual(result.job.printStatus, { pullListPrintedAt: "2026-09-07T08:03:00.000Z", pricingPrintedAt: "2026-09-07T08:04:00.000Z" });
  assert.deepEqual(result.job.teams, job.teams);
});

test("a deletion racing with print status never recreates the job", async () => {
  const store = new FakeRedis();
  const { job } = await repository.createPullListJob(store, emailDraft(), mutationNow);
  store.beforeCompareAndSet = async () => { await repository.deletePullListJob(store, job.id, mutationNow); };
  const result = await repository.mutatePullListJobPrintStatus(store, job.id, "pricing", "2026-09-07T08:01:00Z", mutationNow + 60000);
  assert.deepEqual(result, { status: "not-found" });
  assert.equal(await repository.getPullListJob(store, job.id, mutationNow), null);
});

test("protected Teams registration is idempotent, enriches missing identifiers, and rejects replacement", async () => {
  const store = new FakeRedis();
  const { job } = await repository.createPullListJob(store, { ...emailDraft(), teams: undefined }, mutationNow);
  const metadata = emailDraft().teams;
  const first = await repository.registerPullListJobTeams(store, job.id, { messageId: metadata.messageId }, mutationNow + 60000);
  assert.equal(first.changed, true);
  const enriched = await repository.registerPullListJobTeams(store, job.id, metadata, mutationNow + 120000);
  assert.equal(enriched.changed, true);
  assert.equal(enriched.job.teams.messageLink, metadata.messageLink);
  assert.equal(enriched.job.teams.conversationId, metadata.conversationId);
  assert.equal(enriched.job.teams.postedAt, first.job.teams.postedAt);
  const repeated = await repository.registerPullListJobTeams(store, job.id, metadata, mutationNow + 180000);
  assert.equal(repeated.changed, false);
  for (const field of ["teamId", "channelId", "conversationId", "messageId", "messageLink"]) {
    const rejected = await repository.registerPullListJobTeams(store, job.id, { ...metadata, [field]: "another-identity" }, mutationNow + 240000);
    assert.equal(rejected.status, "conflict");
  }
  assert.deepEqual((await repository.getPullListJob(store, job.id, mutationNow + 300000)).teams, enriched.job.teams);
});

function statusRequest(body, headers = {}) {
  return new Request("https://pullsmith.example/api/pull-list-jobs?action=print-status", {
    method: "POST", headers: { "content-type": "application/json", origin: "https://pullsmith.example", ...headers }, body: JSON.stringify(body),
  });
}

test("public narrow print endpoint validates its boundary and preserves the complete stored job", async () => {
  const store = new FakeRedis();
  const { job } = await repository.createPullListJob(store, emailDraft());
  const synchronized = [];
  const api = jobApi.createPullListJobHandlers(() => store, async (targetStore, id) => {
    assert.equal(targetStore, store);
    synchronized.push(id);
    return { status: "updated" };
  });
  const before = await store.get(`${repository.PULL_LIST_JOB_KEY_PREFIX}${job.id}`);
  const response = await api.POST(statusRequest({ id: job.id, target: "pricing", printedAt: "2026-09-07T08:05:00Z", job: { input: "must not replace" } }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.teamsSync, { status: "updated" });
  assert.deepEqual(synchronized, [job.id]);
  assert.deepEqual(body.job.pricingState, before.pricingState);
  assert.deepEqual(body.job.teams, before.teams);
  assert.deepEqual(body.job.emailDisplay, before.emailDisplay);
  assert.equal(body.job.input, before.input);
  assert.equal(body.job.printStatus.pricingPrintedAt, "2026-09-07T08:05:00.000Z");
  for (const invalid of [{ id: job.id, target: "other", printedAt: "2026-09-07T08:05:00Z" }, { id: "../bad", target: "pricing", printedAt: "2026-09-07T08:05:00Z" }, { id: job.id, target: "pricing", printedAt: "bad" }]) {
    assert.equal((await api.POST(statusRequest(invalid))).status, 400);
  }
  assert.equal((await api.POST(statusRequest({ id: "pl_missing", target: "pricing", printedAt: "2026-09-07T08:05:00Z" }))).status, 404);
  assert.equal((await api.POST(statusRequest({ id: job.id, target: "pricing", printedAt: "2026-09-07T08:05:00Z" }, { origin: "https://elsewhere.example" }))).status, 403);
  assert.equal((await api.POST(statusRequest({}, { "content-type": "text/plain" }))).status, 415);
  assert.deepEqual(synchronized, [job.id]);
});

test("Teams sync failure cannot roll back a persisted print status", async () => {
  const store = new FakeRedis();
  const { job } = await repository.createPullListJob(store, emailDraft());
  const api = jobApi.createPullListJobHandlers(() => store, async () => { throw new Error("sensitive internal detail"); });
  const response = await api.POST(statusRequest({ id: job.id, target: "pull-list", printedAt: "2026-09-07T08:06:00Z" }));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.teamsSync.status, "failed");
  assert.ok(!JSON.stringify(body).includes("sensitive internal detail"));
  assert.equal((await repository.getPullListJob(store, job.id)).printStatus.pullListPrintedAt, "2026-09-07T08:06:00.000Z");
});

test("ordinary browser creation and autosave cannot impersonate email ingestion or Teams registration", async () => {
  const store = new FakeRedis();
  const api = jobApi.createPullListJobHandlers(() => store);
  const create = await api.POST(new Request("https://pullsmith.example/api/pull-list-jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ job: emailDraft() }) }));
  assert.equal(create.status, 201);
  const { job } = await create.json();
  assert.equal(job.source, "manual");
  assert.equal(job.teams, undefined);
  assert.equal(job.emailDisplay, undefined);
  const update = await api.PUT(new Request("https://pullsmith.example/api/pull-list-jobs", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: job.id, job: emailDraft() }) }));
  assert.equal(update.status, 200);
  const updated = (await update.json()).job;
  assert.equal(updated.source, "manual");
  assert.equal(updated.teams, undefined);
  assert.equal(updated.emailDisplay, undefined);
});

test("simultaneous identical ingestion atomically creates one job and reuses its ID", async () => {
  const store = new FakeRedis();
  let winner;
  store.beforeCreate = async () => {
    winner = await repository.createPullListJob(store, emailDraft(), mutationNow);
  };
  const raced = await repository.createPullListJob(store, emailDraft(), mutationNow);
  assert.equal(winner.status, "created");
  assert.equal(raced.status, "duplicate");
  assert.equal(raced.existingJob.id, winner.job.id);
  assert.equal([...store.values.keys()].filter((key) => key.startsWith(repository.PULL_LIST_JOB_KEY_PREFIX)).length, 1);
  assert.deepEqual((await repository.searchPullListJobs(store, {}, mutationNow)).map((entry) => entry.id), [winner.job.id]);
  const simultaneous = await Promise.all(Array.from({ length: 8 }, () => repository.createPullListJob(store, emailDraft(), mutationNow)));
  assert.ok(simultaneous.every((result) => result.status === "duplicate" && result.existingJob.id === winner.job.id));
});

test("duplicate email attachment promotes a manual job once and retains its pricing, print status, and original email", async () => {
  const store = new FakeRedis();
  const created = await repository.createPullListJob(store, { ...draft({ price: "8.25" }), printStatus: { pullListPrintedAt: "2026-09-07T07:30:00Z" } }, mutationNow);
  const before = await store.get(`${repository.PULL_LIST_JOB_KEY_PREFIX}${created.job.id}`);
  const first = await repository.attachPullListJobEmail(store, before.id, emailDraft().emailDisplay, mutationNow + 60000);
  assert.equal(first.changed, true);
  assert.deepEqual(first.job, { ...before, source: "email", emailDisplay: emailDraft().emailDisplay, updatedAt: "2026-09-07T08:01:00.000Z", expiresAt: "2026-10-07T08:01:00.000Z" });
  const second = await repository.attachPullListJobEmail(store, before.id, { ...emailDraft().emailDisplay, body: "later duplicate content" }, mutationNow + 120000);
  assert.equal(second.changed, false);
  assert.deepEqual(second.job.emailDisplay, first.job.emailDisplay);
});

test("initial Teams post claim is atomic, persists with autosave, and allows only one root post attempt", async () => {
  const store = new FakeRedis();
  const { job } = await repository.createPullListJob(store, { ...emailDraft(), teams: undefined }, mutationNow);
  const claims = await Promise.all(Array.from({ length: 5 }, () => repository.claimPullListJobTeamsPost(store, job.id, mutationNow + 60000)));
  assert.equal(claims.filter((result) => result.shouldPost).length, 1);
  assert.equal(claims[0].job.teams.initialPostClaimedAt, "2026-09-07T08:01:00.000Z");
  const afterSave = await repository.updatePullListJob(store, job.id, draft({ price: "11.25" }), mutationNow + 120000);
  assert.equal(afterSave.job.teams.initialPostClaimedAt, "2026-09-07T08:01:00.000Z");
  const retry = await repository.claimPullListJobTeamsPost(store, job.id, mutationNow + 180000);
  assert.equal(retry.shouldPost, false);
  await repository.registerPullListJobTeams(store, job.id, emailDraft().teams, mutationNow + 240000);
  const afterCallback = await repository.claimPullListJobTeamsPost(store, job.id, mutationNow + 300000);
  assert.equal(afterCallback.shouldPost, false);
  assert.equal(afterCallback.job.teams.messageId, emailDraft().teams.messageId);
  assert.equal(afterCallback.job.teams.initialPostClaimedAt, "2026-09-07T08:01:00.000Z");
});

test("the original Check Email Now URL survives normalization and browser autosave exactly", async () => {
  const store = new FakeRedis();
  const checkEmailNowUrl = "https://pullsmith.example/api/check-email-now?secret=original%2BCapability&source=teams";
  const original = { ...emailDraft(), emailDisplay: { ...emailDraft().emailDisplay, checkEmailNowUrl } };
  const { job } = await repository.createPullListJob(store, original, mutationNow);
  assert.equal(jobs.normalizePullListJob(job).emailDisplay.checkEmailNowUrl, checkEmailNowUrl);
  const changed = await repository.updatePullListJob(store, job.id, { ...draft({ price: "14.00" }), emailDisplay: { ...original.emailDisplay, checkEmailNowUrl: "https://forged.example/action" } }, mutationNow + 60000);
  assert.equal(changed.job.emailDisplay.checkEmailNowUrl, checkEmailNowUrl);
  const omitted = await repository.updatePullListJob(store, job.id, draft({ price: "15.00" }), mutationNow + 120000);
  assert.equal(omitted.job.emailDisplay.checkEmailNowUrl, checkEmailNowUrl);
  assert.equal(jobs.normalizePullListJobDraft({ ...original, emailDisplay: { ...original.emailDisplay, checkEmailNowUrl: ` ${checkEmailNowUrl} ` } }).emailDisplay.checkEmailNowUrl, ` ${checkEmailNowUrl} `);
});

test("autosave only synchronizes Teams when a print timestamp increases and keeps pricing saves successful", async () => {
  const store = new FakeRedis();
  const { job } = await repository.createPullListJob(store, emailDraft());
  const synchronized = [];
  let storeGets = 0;
  let failSync = false;
  const api = jobApi.createPullListJobHandlers(() => { storeGets++; return store; }, async (targetStore, id) => {
    assert.equal(targetStore, store);
    synchronized.push(id);
    if (failSync) throw new Error("private transport detail");
    return { status: "updated" };
  });
  const put = (next) => api.PUT(new Request("https://pullsmith.example/api/pull-list-jobs", {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: job.id, job: next }),
  }));
  const pricingOnly = await put(draft({ price: "13.25" }));
  assert.equal(pricingOnly.status, 200);
  assert.equal((await pricingOnly.json()).teamsSync, undefined);
  assert.deepEqual(synchronized, []);
  assert.equal(storeGets, 1);

  const printed = { ...draft({ price: "14.25" }), printStatus: { pullListPrintedAt: "2026-09-07T08:07:00Z", pricingPrintedAt: "" } };
  const printResponse = await put(printed);
  assert.equal(printResponse.status, 200);
  const printBody = await printResponse.json();
  assert.deepEqual(printBody.teamsSync, { status: "updated" });
  assert.equal(printBody.job.pricingState.rows[0].priceOverride, "14.25");
  assert.deepEqual(synchronized, [job.id]);
  assert.equal(storeGets, 2);

  const repeated = await put(printed);
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json()).teamsSync, undefined);
  assert.deepEqual(synchronized, [job.id]);

  failSync = true;
  const pricingPrint = await put({ ...printed, printStatus: { ...printed.printStatus, pricingPrintedAt: "2026-09-07T08:08:00Z" } });
  assert.equal(pricingPrint.status, 200);
  const failedBody = await pricingPrint.json();
  assert.deepEqual(failedBody.teamsSync, { status: "failed", reason: "Teams synchronization failed." });
  assert.ok(!JSON.stringify(failedBody).includes("private transport detail"));
  assert.deepEqual(synchronized, [job.id, job.id]);
  assert.equal((await repository.getPullListJob(store, job.id)).printStatus.pricingPrintedAt, "2026-09-07T08:08:00.000Z");
  assert.equal(failedBody.job.pricingState.rows[0].priceOverride, "14.25");
  assert.deepEqual(failedBody.job.teams, job.teams);
});

import assert from "node:assert/strict";
import test from "node:test";
import { importBundledModule } from "./test-module-bundle.mjs";

const jobs = await importBundledModule("src/pull-list-job.ts", "pull-list-job");
const repository = await importBundledModule("api/_pull-list-job-repository.ts", "pull-list-job-repository");
const jobApi = await importBundledModule("api/pull-list-jobs.ts", "pull-list-jobs-api");
const jobClient = await importBundledModule("src/pull-list-job-client.ts", "pull-list-job-client");

class FakeRedis {
  values = new Map();
  ttls = new Map();
  zsets = new Map();

  async get(key) { return this.values.get(key) ?? null; }
  async set(key, value, options = {}) {
    if (options.nx && this.values.has(key)) return null;
    this.values.set(key, structuredClone(value));
    if (options.ex) this.ttls.set(key, options.ex);
    return "OK";
  }
  async del(...keys) {
    keys.forEach((key) => { this.values.delete(key); this.ttls.delete(key); });
    return keys.length;
  }
  async expire(key, seconds) { this.ttls.set(key, seconds); return 1; }
  async zadd(key, { score, member }) {
    const entries = this.zsets.get(key) || new Map();
    entries.set(member, score);
    this.zsets.set(key, entries);
    return 1;
  }
  async zrange(key, start, stop, options = {}) {
    const entries = Array.from(this.zsets.get(key)?.entries() || []);
    entries.sort((left, right) => options.rev ? right[1] - left[1] : left[1] - right[1]);
    return entries.slice(start, stop + 1).map(([member]) => member);
  }
  async zrem(key, ...members) {
    const entries = this.zsets.get(key);
    members.forEach((member) => entries?.delete(member));
    return members.length;
  }
}

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
  assert.equal(jobs.pricingStateForWorkspaceLoad("saved-job", state).rows.length, 2);
  assert.equal(jobs.pricingStateForWorkspaceLoad("copy-link", state), null);
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

test("Saved Pull List API creates, updates, loads, lists, and searches without a staff session", async () => {
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

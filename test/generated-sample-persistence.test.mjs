import assert from "node:assert/strict";
import test from "node:test";
import { importBundledModule } from "./test-module-bundle.mjs";

const generatedSample = await importBundledModule("src/generated-sample.ts", "generated-sample");
const jobs = await importBundledModule("src/pull-list-job.ts", "pull-list-job-samples");
const repository = await importBundledModule("api/_pull-list-job-repository.ts", "pull-list-job-repository-samples");
const jobApi = await importBundledModule("api/pull-list-jobs.ts", "pull-list-jobs-api-samples");

function draft(customerName) {
  return {
    customer: { name: customerName },
    input: "1 Lightning Bolt",
    output: ".\n1 Lightning Bolt\n.",
    formatterItems: [{ index: 0, quantity: 1, inputName: "Lightning Bolt", status: "found", card: { name: "Lightning Bolt" } }],
    pricingState: { version: 1, pricingSource: "tcgplayer-listed-median", includeNotFound: true, rows: [] },
    source: "manual",
    processedAt: "2026-08-23T12:00:00.000Z",
    stats: { resolvedCount: 1, needsReviewCount: 0, printFallbackCount: 0 },
    formatterSettings: { useCheckboxes: true },
  };
}

class FakeRedis {
  async get() { return null; }
  async set() { return "OK"; }
  async del() { return 1; }
  async expire() { return 1; }
  async zadd() { return 1; }
  async zrange() { return []; }
  async zrem() { return 1; }
}

test("every randomized starter-list name is recognized regardless of casing or spacing", () => {
  for (const name of generatedSample.GENERATED_SAMPLE_CUSTOMER_NAMES) {
    assert.equal(generatedSample.isGeneratedSampleCustomerName(`  ${name.toUpperCase()}  `), true);
  }
  assert.equal(generatedSample.isGeneratedSampleCustomerName("Mark Rosewood"), false);
});

test("generated starter lists cannot become Saved Pull Lists through the normal draft or repository paths", async () => {
  const sampleDraft = draft(generatedSample.GENERATED_SAMPLE_CUSTOMER_NAMES[0]);
  assert.equal(jobs.isGeneratedSamplePullListJobDraft(sampleDraft), true);
  assert.equal(jobs.isPersistablePullListJobDraft(sampleDraft), false);
  await assert.rejects(
    repository.createPullListJob(new FakeRedis(), sampleDraft),
    /Generated sample pull lists are not saved/,
  );
  assert.equal(jobs.isPersistablePullListJobDraft(draft("A Real Customer")), true);
});

test("the Saved Pull List API rejects generated starter lists before reaching Redis", async () => {
  const api = jobApi.createPullListJobHandlers(() => {
    throw new Error("Redis should not be reached for a generated sample.");
  });
  const response = await api.POST(new Request("https://pullsmith.example/api/pull-list-jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ job: draft(generatedSample.GENERATED_SAMPLE_CUSTOMER_NAMES[0]) }),
  }));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "Generated sample pull lists are not saved.");
});

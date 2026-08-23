import assert from "node:assert/strict";
import test from "node:test";
import { importBundledModule } from "./test-module-bundle.mjs";

const picker = await importBundledModule("src/saved-pull-list-picker.ts", "saved-pull-list-picker");
const client = await importBundledModule("src/pull-list-job-client.ts", "saved-pull-list-client");

test("picker open state closes for Escape, outside clicks, and successful Open", () => {
  assert.equal(picker.nextSavedPullListsPickerOpen(false, "open"), true);
  assert.equal(picker.nextSavedPullListsPickerOpen(false, "toggle"), true);
  assert.equal(picker.nextSavedPullListsPickerOpen(true, "toggle"), false);
  for (const event of ["close", "escape", "outside", "job-opened"]) {
    assert.equal(picker.nextSavedPullListsPickerOpen(true, event), false);
  }
});

test("empty queries use Recent while text infers name, phone, or email search", () => {
  assert.deepEqual(picker.savedPullListSearchRequest(""), {
    mode: "recent",
    limit: 15,
  });
  assert.deepEqual(picker.savedPullListSearchRequest("  JoHn  "), {
    mode: "name",
    namePrefix: "john",
    limit: 15,
  });
  assert.deepEqual(picker.savedPullListSearchRequest("(309) 555-1234"), {
    mode: "phone",
    phone: "3095551234",
    limit: 15,
  });
  assert.deepEqual(picker.savedPullListSearchRequest(" JOHN@Example.COM "), {
    mode: "email",
    email: "john@example.com",
    limit: 15,
  });
  assert.equal(picker.SAVED_PULL_LIST_SEARCH_DEBOUNCE_MS, 300);
});

test("opening another job uses New List's unsaved-work protection philosophy", () => {
  assert.equal(picker.savedJobOpenDisposition("saved").requiresConfirmation, false);
  assert.equal(picker.savedJobOpenDisposition("dirty").requiresConfirmation, true);
  assert.equal(picker.savedJobOpenDisposition("failed").requiresConfirmation, true);
  assert.equal(picker.savedJobOpenDisposition("stale").requiresConfirmation, true);
});

test("picker queries work without a staff session", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ jobs: [] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  try {
    assert.deepEqual(await client.listPullListJobs({ limit: 15 }), []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { importBundledModule } from "./test-module-bundle.mjs";

const picker = await importBundledModule("src/saved-pull-list-picker.ts", "saved-pull-list-picker");
const client = await importBundledModule("src/pull-list-job-client.ts", "saved-pull-list-client");
const pickerComponentSource = await readFile(new URL("../src/SavedPullListsPicker.tsx", import.meta.url), "utf8");
const deleteDialogSource = await readFile(new URL("../src/DeleteSavedPullListDialog.tsx", import.meta.url), "utf8");

test("picker opens from the full details control and keeps Delete as the only sibling action", () => {
  assert.match(pickerComponentSource, /className="saved-pull-list-result-main"/);
  assert.match(pickerComponentSource, /onClick=\{\(\) => void handleOpenJob\(job\.id\)\}/);
  assert.doesNotMatch(pickerComponentSource, /saved-pull-list-open/);
  assert.match(pickerComponentSource, /className="icon-button danger saved-pull-list-delete"/);
});

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

test("deletion dialog identifies named and unnamed lists without a browser confirmation", () => {
  const named = {
    id: "pl_named",
    customer: { name: "Jake Stimac", phone: "", email: "" },
    createdAt: "2026-08-23T21:10:00.000Z",
    updatedAt: "2026-08-23T21:10:00.000Z",
    processedAt: "2026-08-23T21:10:00.000Z",
    cardCount: 12,
    foundCount: 1,
    source: "manual",
  };
  const when = picker.formatSavedPullListDate(named.updatedAt);
  assert.deepEqual(picker.savedPullListDeleteDialogDetails(named), {
    title: "Delete Saved Pull List?",
    customerName: "Jake Stimac",
    updatedAt: when,
    warning: "This permanently deletes this saved pull list. This cannot be undone.",
  });
  assert.deepEqual(
    picker.savedPullListDeleteDialogDetails({ ...named, customer: { name: "", phone: "", email: "" } }),
    {
      title: "Delete Saved Pull List?",
      customerName: "Unnamed customer",
      updatedAt: when,
      warning: "This permanently deletes this saved pull list. This cannot be undone.",
    },
  );
  assert.doesNotMatch(pickerComponentSource, /window\.confirm/);
  assert.doesNotMatch(deleteDialogSource, /window\.confirm/);
});

test("trash opens a portal dialog, while deletion remains delegated to the existing handler", () => {
  assert.match(pickerComponentSource, /setDeleteConfirmationJob\(job\)/);
  assert.match(pickerComponentSource, /<DeleteSavedPullListDialog/);
  assert.match(pickerComponentSource, /onConfirm=\{handleConfirmedDeleteJob\}/);
  assert.match(pickerComponentSource, /await onDeleteJob\(job\.id\)/);
  assert.match(pickerComponentSource, /deleteRequestInFlightRef\.current/);
  assert.match(deleteDialogSource, /createPortal\(/);
  assert.match(deleteDialogSource, /role="dialog"/);
  assert.match(deleteDialogSource, /aria-modal="true"/);
  assert.match(deleteDialogSource, /event\.key === "Escape"/);
  assert.match(deleteDialogSource, /event\.target === event\.currentTarget/);
  assert.match(deleteDialogSource, /cancelButtonRef\.current\?\.focus\(\)/);
  assert.match(deleteDialogSource, /event\.key !== "Tab"/);
});

test("successful picker deletion removes only the deleted result and exposes the empty state input", () => {
  const jobs = [{ id: "pl_delete" }, { id: "pl_keep" }];
  assert.deepEqual(picker.removeDeletedSavedPullList(jobs, "pl_delete"), [{ id: "pl_keep" }]);
  assert.deepEqual(picker.removeDeletedSavedPullList([{ id: "pl_delete" }], "pl_delete"), []);
});

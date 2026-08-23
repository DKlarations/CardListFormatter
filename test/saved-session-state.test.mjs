import assert from "node:assert/strict";
import test from "node:test";
import { importBundledModule } from "./test-module-bundle.mjs";

const session = await importBundledModule("src/saved-session-state.ts", "saved-session-state");

test("save-state transitions retain failed local work and expose the 750ms debounce", () => {
  assert.equal(session.SAVED_JOB_AUTOSAVE_DEBOUNCE_MS, 750);
  assert.equal(session.nextSavedJobSaveState("saved", "change"), "dirty");
  assert.equal(session.nextSavedJobSaveState("dirty", "save-start"), "saving");
  assert.equal(session.nextSavedJobSaveState("saving", "save-success"), "saved");
  assert.equal(session.nextSavedJobSaveState("saving", "save-failure"), "failed");
  assert.equal(session.saveStateLabel("failed"), "Save failed");
});

test("multiple rapid changes invalidate earlier autosave revisions", () => {
  const first = session.nextAutosaveRevision(0);
  const second = session.nextAutosaveRevision(first);
  const third = session.nextAutosaveRevision(second);
  assert.equal(session.isLatestAutosaveRevision(first, third), false);
  assert.equal(session.isLatestAutosaveRevision(second, third), false);
  assert.equal(session.isLatestAutosaveRevision(third, third), true);
});

test("New List is immediate only for saved work and never deletes the persisted job", () => {
  assert.deepEqual(session.newListDisposition("saved"), {
    requiresConfirmation: false,
    deletePersistedJob: false,
  });
  assert.equal(session.newListDisposition("failed").requiresConfirmation, true);
  assert.equal(session.newListDisposition("dirty").requiresConfirmation, true);
  assert.equal(session.newListDisposition("stale").requiresConfirmation, true);
});

test("quick pricing without a processed job is not autosave eligible", () => {
  assert.equal(session.canAutosaveCurrentJob({ currentJobId: "", processedAt: null, output: "" }), false);
  assert.equal(session.canAutosaveCurrentJob({ currentJobId: "pl_1", processedAt: "2026-08-23", output: "formatted" }), true);
});

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

test("deleting the current job detaches identity while preserving the complete local workspace", () => {
  const workspace = {
    currentJobId: "pl_current",
    saveState: "dirty",
    customer: { name: "Jake Stimac", phone: "309-555-1234", email: "jake@example.com" },
    input: "1 Lightning Bolt",
    output: "formatted output",
    formatterItems: [{ name: "Lightning Bolt" }],
    pricingRows: [{ id: "row-1", price: "1.25" }],
  };
  const detached = session.savedSessionAfterJobDeletion(workspace, "pl_current");
  assert.deepEqual(detached, {
    ...workspace,
    currentJobId: "",
    saveState: "idle",
  });
  assert.equal(session.saveStateLabel(detached.saveState), "Not saved");
  assert.equal(session.savedSessionAfterJobDeletion(workspace, "pl_other"), workspace);
});

test("a current job being deleted blocks stale autosave work but allows future new-job creation", () => {
  assert.equal(session.canPersistSavedJobRequest({
    requestJobId: "pl_current",
    currentJobId: "pl_current",
    blockedJobId: "pl_current",
  }), false);
  assert.equal(session.canPersistSavedJobRequest({
    requestJobId: "",
    currentJobId: "pl_current",
    blockedJobId: "pl_current",
  }), false);
  assert.equal(session.canPersistSavedJobRequest({
    requestJobId: "",
    currentJobId: "",
    blockedJobId: "pl_deleted",
  }), true);

  const scheduledRevision = session.nextAutosaveRevision(3);
  const invalidatedRevision = session.nextAutosaveRevision(scheduledRevision);
  assert.equal(session.isLatestAutosaveRevision(scheduledRevision, invalidatedRevision), false);
});

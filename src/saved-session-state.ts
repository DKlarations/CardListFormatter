export const SAVED_JOB_AUTOSAVE_DEBOUNCE_MS = 750;

export type SavedJobSaveState = "idle" | "dirty" | "saving" | "saved" | "failed" | "stale";
export type SavedJobSaveEvent = "change" | "save-start" | "save-success" | "save-failure" | "invalidate" | "reset";

export function nextSavedJobSaveState(
  current: SavedJobSaveState,
  event: SavedJobSaveEvent,
): SavedJobSaveState {
  if (event === "reset") return "idle";
  if (event === "invalidate") return "stale";
  if (event === "save-start") return "saving";
  if (event === "save-success") return "saved";
  if (event === "save-failure") return "failed";
  if (event === "change") return current === "stale" ? "stale" : "dirty";
  return current;
}

export function shouldConfirmNewList(saveState: SavedJobSaveState) {
  return ["dirty", "saving", "failed", "stale"].includes(saveState);
}

export function newListDisposition(saveState: SavedJobSaveState) {
  return {
    requiresConfirmation: shouldConfirmNewList(saveState),
    deletePersistedJob: false,
  };
}

export function nextAutosaveRevision(currentRevision: number) {
  return Math.max(0, Math.floor(currentRevision)) + 1;
}

export function isLatestAutosaveRevision(scheduledRevision: number, currentRevision: number) {
  return scheduledRevision === currentRevision;
}

export function saveStateLabel(saveState: SavedJobSaveState) {
  if (saveState === "saving") return "Saving…";
  if (saveState === "saved") return "Saved";
  if (saveState === "failed") return "Save failed";
  if (saveState === "dirty") return "Unsaved changes";
  if (saveState === "stale") return "Process to save";
  return "Not saved";
}

export function canAutosaveCurrentJob({
  currentJobId,
  processedAt,
  output,
}: {
  currentJobId?: string | null;
  processedAt?: string | null;
  output?: string | null;
}) {
  return Boolean(currentJobId && processedAt && output);
}

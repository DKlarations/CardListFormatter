import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Loader2, RefreshCw, Search, Trash2 } from "lucide-react";
import DeleteSavedPullListDialog from "./DeleteSavedPullListDialog";
import { listPullListJobs } from "./pull-list-job-client";
import type { SavedJobSummary } from "./pull-list-job";
import type { SavedPullListDiagnosticReporter } from "./saved-pull-list-diagnostics";
import {
  formatSavedPullListDate,
  nextSavedPullListsPickerOpen,
  removeDeletedSavedPullList,
  savedPullListSearchRequest,
  SAVED_PULL_LIST_SEARCH_DEBOUNCE_MS,
  type SavedPullListOpenResult,
} from "./saved-pull-list-picker";

type SavedPullListsPickerProps = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onOpenJob: (jobId: string) => Promise<SavedPullListOpenResult>;
  onDeleteJob: (jobId: string) => Promise<void>;
  onDiagnostic: SavedPullListDiagnosticReporter;
  currentJobId: string;
  currentJobSaveInFlight: boolean;
};

function resultDetails(job: SavedJobSummary) {
  return [
    formatSavedPullListDate(job.updatedAt),
    `${job.cardCount} card${job.cardCount === 1 ? "" : "s"}`,
    `${job.foundCount} found`,
  ].join(" · ");
}

export default function SavedPullListsPicker({
  isOpen,
  onOpenChange,
  onOpenJob,
  onDeleteJob,
  onDiagnostic,
  currentJobId,
  currentJobSaveInFlight,
}: SavedPullListsPickerProps) {
  const panelId = useId();
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const hasFocusedPickerSearchRef = useRef(false);
  const deleteConfirmationTriggerRef = useRef<HTMLButtonElement | null>(null);
  const deleteRequestInFlightRef = useRef(false);
  const requestGenerationRef = useRef(0);
  const deletedJobIdsRef = useRef(new Set<string>());
  const [query, setQuery] = useState("");
  const [jobs, setJobs] = useState<SavedJobSummary[]>([]);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [retryRevision, setRetryRevision] = useState(0);
  const [openingJobId, setOpeningJobId] = useState("");
  const [deletingJobId, setDeletingJobId] = useState("");
  const [deleteConfirmationJob, setDeleteConfirmationJob] = useState<SavedJobSummary | null>(null);
  const searchRequest = savedPullListSearchRequest(query);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handlePointerDown = (event: PointerEvent) => {
      if (!deleteConfirmationJob && !pickerRef.current?.contains(event.target as Node)) {
        onOpenChange(nextSavedPullListsPickerOpen(true, "outside"));
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deleteConfirmationJob) {
        event.preventDefault();
        onOpenChange(nextSavedPullListsPickerOpen(true, "escape"));
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [deleteConfirmationJob, isOpen, onOpenChange]);

  useEffect(() => {
    if (!isOpen) {
      hasFocusedPickerSearchRef.current = false;
      return undefined;
    }
    if (hasFocusedPickerSearchRef.current) return undefined;
    const focusTimer = window.setTimeout(() => {
      searchRef.current?.focus();
      hasFocusedPickerSearchRef.current = true;
    }, 0);
    return () => window.clearTimeout(focusTimer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const generation = ++requestGenerationRef.current;
    setLoadState("loading");
    setErrorMessage("");
    const timer = window.setTimeout(async () => {
      try {
        const results = await listPullListJobs(searchRequest, { onDiagnostic });
        if (generation !== requestGenerationRef.current) return;
        setJobs(results.filter((job) => !deletedJobIdsRef.current.has(job.id)));
        setLoadState("ready");
      } catch (error) {
        if (generation !== requestGenerationRef.current) return;
        setJobs([]);
        setErrorMessage(error instanceof Error ? error.message : "Saved Pull Lists could not be loaded.");
        setLoadState("error");
      }
    }, searchRequest.mode === "recent" ? 0 : SAVED_PULL_LIST_SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      if (requestGenerationRef.current === generation) requestGenerationRef.current += 1;
    };
  }, [isOpen, onDiagnostic, onOpenChange, query, retryRevision]);

  async function handleOpenJob(jobId: string) {
    if (openingJobId || deletingJobId) return;
    setOpeningJobId(jobId);
    setErrorMessage("");
    const result = await onOpenJob(jobId);
    if (result.status === "opened") {
      onOpenChange(nextSavedPullListsPickerOpen(true, "job-opened"));
    } else if (result.status === "error") {
      setErrorMessage(result.message);
      setLoadState("error");
    }
    setOpeningJobId("");
  }

  function returnFocusToDeleteButton() {
    window.requestAnimationFrame(() => {
      window.setTimeout(() => {
        const trigger = deleteConfirmationTriggerRef.current;
        if (trigger?.isConnected) trigger.focus();
      }, 0);
    });
  }

  function closeDeleteConfirmation() {
    if (!deleteConfirmationJob) return;
    setDeleteConfirmationJob(null);
    returnFocusToDeleteButton();
  }

  function requestDeleteConfirmation(job: SavedJobSummary, trigger: HTMLButtonElement) {
    if (openingJobId || deletingJobId) return;
    if (job.id === currentJobId && currentJobSaveInFlight) {
      setErrorMessage("Wait for the current save to finish before deleting this list.");
      return;
    }
    deleteConfirmationTriggerRef.current = trigger;
    setDeleteConfirmationJob(job);
  }

  async function handleConfirmedDeleteJob() {
    const job = deleteConfirmationJob;
    if (!job || openingJobId || deletingJobId || deleteRequestInFlightRef.current) return;

    deleteRequestInFlightRef.current = true;
    setDeletingJobId(job.id);
    setErrorMessage("");
    try {
      await onDeleteJob(job.id);
      deletedJobIdsRef.current.add(job.id);
      setJobs((current) => removeDeletedSavedPullList(current, job.id));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Saved Pull List could not be deleted.");
    } finally {
      deleteRequestInFlightRef.current = false;
      setDeletingJobId("");
      setDeleteConfirmationJob(null);
      returnFocusToDeleteButton();
    }
  }

  function togglePicker() {
    const nextOpen = nextSavedPullListsPickerOpen(isOpen, "toggle");
    if (nextOpen) {
      setJobs([]);
      setLoadState("loading");
      setErrorMessage("");
    }
    onOpenChange(nextOpen);
  }

  return (
    <div className="saved-pull-lists-picker" ref={pickerRef}>
      <button
        className={`icon-button saved-pull-lists-trigger ${isOpen ? "is-active" : ""}`}
        type="button"
        onClick={togglePicker}
        title="Saved Pull Lists"
        aria-label="Saved Pull Lists"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={isOpen ? panelId : undefined}
      >
        <ChevronDown size={16} aria-hidden="true" />
      </button>

      {isOpen && (
        <div id={panelId} className="saved-pull-lists-panel" role="dialog" aria-label="Saved Pull Lists">
          <div className="saved-pull-lists-heading">
            <strong>Saved Pull Lists</strong>
            <span>{searchRequest.mode === "recent" ? "Recent" : "Search results"}</span>
          </div>
          <label className="saved-pull-lists-search">
            <span className="sr-only">Search customer, phone, or email</span>
            <Search size={15} aria-hidden="true" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search customer, phone, or email"
              aria-label="Search customer, phone, or email"
              autoComplete="off"
            />
          </label>

          <div className="saved-pull-lists-results" aria-live="polite">
            {loadState === "loading" && (
              <div className="saved-pull-lists-message">
                <Loader2 size={16} className="spin" aria-hidden="true" />
                {searchRequest.mode === "recent" ? "Loading recent pull lists…" : "Searching…"}
              </div>
            )}
            {loadState === "error" && (
              <div className="saved-pull-lists-message is-error" role="alert">
                <span>{errorMessage}</span>
                <button className="icon-button" type="button" onClick={() => setRetryRevision((current) => current + 1)}>
                  <RefreshCw size={14} aria-hidden="true" /><span>Retry</span>
                </button>
              </div>
            )}
            {loadState !== "error" && errorMessage && (
              <p className="saved-pull-lists-action-error" role="alert">{errorMessage}</p>
            )}
            {loadState === "ready" && jobs.length === 0 && (
              <p className="saved-pull-lists-message">No saved pull lists found.</p>
            )}
            {loadState === "ready" && jobs.length > 0 && (
              <div className="saved-pull-lists-list" role="list">
                {jobs.map((job) => {
                  const contacts = [job.customer.phone, job.customer.email].filter(Boolean).join(" · ");
                  const isOpening = openingJobId === job.id;
                  const isDeleting = deletingJobId === job.id;
                  const waitForCurrentSave = job.id === currentJobId && currentJobSaveInFlight;
                  const actionsDisabled = Boolean(openingJobId || deletingJobId || deleteConfirmationJob);
                  return (
                    <article className="saved-pull-list-result" role="listitem" key={job.id}>
                      <button
                        className="saved-pull-list-result-main"
                        type="button"
                        onClick={() => void handleOpenJob(job.id)}
                        disabled={actionsDisabled}
                        aria-busy={isOpening}
                        aria-label={`Open ${job.customer.name || "unnamed customer"} Saved Pull List from ${formatSavedPullListDate(job.updatedAt)}`}
                      >
                        <strong>
                          {isOpening && <Loader2 size={13} className="spin" aria-hidden="true" />}
                          {job.customer.name || "Unnamed customer"}
                        </strong>
                        {contacts && <span>{contacts}</span>}
                        <small>{resultDetails(job)}</small>
                      </button>
                      <div className="saved-pull-list-result-actions">
                        <button
                          className="icon-button danger saved-pull-list-delete"
                          type="button"
                          onClick={(event) => requestDeleteConfirmation(job, event.currentTarget)}
                          disabled={actionsDisabled || waitForCurrentSave}
                          title={waitForCurrentSave
                            ? "Wait for the current save to finish before deleting this list."
                            : "Delete Saved Pull List"}
                          aria-label={`${isDeleting ? "Deleting" : "Delete"} ${job.customer.name || "unnamed customer"} Saved Pull List from ${formatSavedPullListDate(job.updatedAt)}`}
                        >
                          {isDeleting
                            ? <Loader2 size={14} className="spin" aria-hidden="true" />
                            : <Trash2 size={14} aria-hidden="true" />}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
      {deleteConfirmationJob && (
        <DeleteSavedPullListDialog
          job={deleteConfirmationJob}
          isDeleting={deletingJobId === deleteConfirmationJob.id}
          onCancel={closeDeleteConfirmation}
          onConfirm={handleConfirmedDeleteJob}
        />
      )}
    </div>
  );
}

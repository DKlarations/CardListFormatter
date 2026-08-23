import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, Loader2, RefreshCw, Search } from "lucide-react";
import {
  listPullListJobs,
  StaffAuthorizationRequiredError,
} from "./pull-list-job-client";
import type { SavedJobSummary } from "./pull-list-job";
import {
  nextSavedPullListsPickerOpen,
  savedPullListSearchRequest,
  SAVED_PULL_LIST_SEARCH_DEBOUNCE_MS,
  type SavedPullListOpenResult,
} from "./saved-pull-list-picker";

type SavedPullListsPickerProps = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onAuthorizationRequired: () => void;
  onOpenJob: (jobId: string) => Promise<SavedPullListOpenResult>;
};

function formatSavedListDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently updated";
  return new Intl.DateTimeFormat(undefined, {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function resultDetails(job: SavedJobSummary) {
  return [
    formatSavedListDate(job.updatedAt),
    `${job.cardCount} card${job.cardCount === 1 ? "" : "s"}`,
    `${job.foundCount} found`,
  ].join(" · ");
}

export default function SavedPullListsPicker({
  isOpen,
  onOpenChange,
  onAuthorizationRequired,
  onOpenJob,
}: SavedPullListsPickerProps) {
  const panelId = useId();
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const requestGenerationRef = useRef(0);
  const [query, setQuery] = useState("");
  const [jobs, setJobs] = useState<SavedJobSummary[]>([]);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [retryRevision, setRetryRevision] = useState(0);
  const [openingJobId, setOpeningJobId] = useState("");
  const searchRequest = savedPullListSearchRequest(query);

  useEffect(() => {
    if (!isOpen) return undefined;
    const focusTimer = window.setTimeout(() => searchRef.current?.focus(), 0);
    const handlePointerDown = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        onOpenChange(nextSavedPullListsPickerOpen(true, "outside"));
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onOpenChange(nextSavedPullListsPickerOpen(true, "escape"));
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onOpenChange]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const generation = ++requestGenerationRef.current;
    setLoadState("loading");
    setErrorMessage("");
    const timer = window.setTimeout(async () => {
      try {
        const results = await listPullListJobs(searchRequest);
        if (generation !== requestGenerationRef.current) return;
        setJobs(results);
        setLoadState("ready");
      } catch (error) {
        if (generation !== requestGenerationRef.current) return;
        if (error instanceof StaffAuthorizationRequiredError) {
          setJobs([]);
          onOpenChange(nextSavedPullListsPickerOpen(true, "authorization-required"));
          onAuthorizationRequired();
          return;
        }
        setJobs([]);
        setErrorMessage(error instanceof Error ? error.message : "Saved Pull Lists could not be loaded.");
        setLoadState("error");
      }
    }, searchRequest.mode === "recent" ? 0 : SAVED_PULL_LIST_SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      if (requestGenerationRef.current === generation) requestGenerationRef.current += 1;
    };
  }, [isOpen, onAuthorizationRequired, onOpenChange, query, retryRevision]);

  async function handleOpenJob(jobId: string) {
    if (openingJobId) return;
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
            {loadState === "ready" && jobs.length === 0 && (
              <p className="saved-pull-lists-message">No saved pull lists found.</p>
            )}
            {loadState === "ready" && jobs.length > 0 && (
              <div className="saved-pull-lists-list" role="list">
                {jobs.map((job) => {
                  const contacts = [job.customer.phone, job.customer.email].filter(Boolean).join(" · ");
                  const isOpening = openingJobId === job.id;
                  return (
                    <article className="saved-pull-list-result" role="listitem" key={job.id}>
                      <div>
                        <strong>{job.customer.name || "Unnamed customer"}</strong>
                        {contacts && <span>{contacts}</span>}
                        <small>{resultDetails(job)}</small>
                      </div>
                      <button
                        className="icon-button saved-pull-list-open"
                        type="button"
                        onClick={() => void handleOpenJob(job.id)}
                        disabled={Boolean(openingJobId)}
                        aria-label={`Open ${job.customer.name || "unnamed customer"} Saved Pull List from ${formatSavedListDate(job.updatedAt)}`}
                      >
                        {isOpening && <Loader2 size={14} className="spin" aria-hidden="true" />}
                        <span>{isOpening ? "Opening…" : "Open"}</span>
                      </button>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

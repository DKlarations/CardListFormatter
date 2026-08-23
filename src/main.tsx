import type { ButtonHTMLAttributes, ReactNode } from "react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Check,
  CircleAlert,
  CircleX,
  Clipboard,
  Bug,
  Download,
  Link2,
  ListPlus,
  Loader2,
  Printer,
  RefreshCw,
  Search,
  Send,
  Settings,
  Sparkles,
  Trash2,
} from "lucide-react";
import SavedPullListsPicker from "./SavedPullListsPicker";
import {
  beginScryfallRun,
  clearMtgjsonIndexCache,
  compactFormatterItems,
  createSampleList,
  endScryfallRun,
  enrichPrintHistories,
  fetchRecentCaseSets,
  formatOutput,
  inferBoundaryCustomer,
  parsePullList,
  reliabilityMessage,
  resolveCardNames,
  safeFileName,
} from "./formatter";
import { decodeFormatterHash, encodeFormattedHash } from "./share-link";
import { documentTitle } from "./document-title";
import {
  EMPTY_CUSTOMER,
  mergeCustomerPreservingExisting,
  normalizeCustomer,
  type Customer,
} from "./customer";
import {
  deletePullListJob,
  formatterShareUrlWithoutJob,
  loadPullListJob,
  persistPullListJob,
  pullListJobUrl,
} from "./pull-list-job-client";
import {
  addSavedPullListDiagnostic,
  formatSavedPullListDiagnosticReport,
  savedPullListDiagnosticOperationLabel,
  savedPullListDiagnosticOutcomeLabel,
  shortenedSavedPullListJobId,
  type SavedPullListDiagnostic,
  type SavedPullListDiagnosticReporter,
} from "./saved-pull-list-diagnostics";
import {
  addPricingDataDiagnostic,
  formatPricingDataDiagnosticReport,
  pricingDataDiagnosticOutcomeLabel,
  pricingDataDiagnosticStageLabel,
  type PricingDataDiagnostic,
  type PricingDataDiagnosticReporter,
} from "./pricing-data-diagnostics";
import {
  emptySavedPricingState,
  isGeneratedSamplePullListJobDraft,
  normalizePullListJobDraft,
  pricingStateForWorkspaceLoad,
  type PullListJobDraft,
  type SavedJobSummary,
  type SavedPricingState,
} from "./pull-list-job";
import {
  canAutosaveCurrentJob,
  canPersistSavedJobRequest,
  isLatestAutosaveRevision,
  newListDisposition,
  nextAutosaveRevision,
  nextSavedJobSaveState,
  saveStateLabel,
  savedSessionAfterJobDeletion,
  SAVED_JOB_AUTOSAVE_DEBOUNCE_MS,
  type SavedJobSaveState,
} from "./saved-session-state";
import {
  savedJobOpenDisposition,
  type SavedPullListOpenResult,
} from "./saved-pull-list-picker";
import { shouldShowPricingAssistant } from "./pricing-ui-state";
import {
  formatterPrimaryAction,
  FORMATTER_REPROCESS_ACTION,
  formatterStatusMetrics,
  shouldShowFormatterReprocess,
} from "./workspace-ui";
import "./styles.css";
import rrgLogo from "../images/LOGO_PNG_HEADER.png";
import receiptLogo from "../images/Logo-LineArt.png";

const PricingPanel = lazy(() => import("./PricingPanel"));

// Reusable little icon button so the toolbar does not turn into copy-paste soup.
type IconButtonProps = {
  children: ReactNode;
  title: string;
  ariaLabel?: string;
  className?: string;
  variant?: "primary" | "secondary" | "danger";
} & Pick<ButtonHTMLAttributes<HTMLButtonElement>, "disabled" | "onClick">;

const sharedFormatterState = decodeFormatterHash(window.location.hash);
const sharedListId = new URLSearchParams(window.location.search).get("list") || "";
const requestedSavedJobId = new URLSearchParams(window.location.search).get("job") || "";
const isTeamsTestPage = window.location.pathname === "/teams-test";
const PRODUCTION_ORIGIN = "https://card-list-formatter.vercel.app";

function IconButton({ children, onClick, title, ariaLabel, className = "", disabled = false, variant = "secondary" }: IconButtonProps) {
  return (
    <button type="button" className={`icon-button ${variant} ${className}`} onClick={onClick} title={title} aria-label={ariaLabel} disabled={disabled}>
      {children}
    </button>
  );
}

function joinValues(values) {
  return values?.length ? values.join(", ") : "";
}

function diagnosticRows(parsedCards, resolvedItems) {
  const sourceItems = resolvedItems.length ? resolvedItems : parsedCards;

  return sourceItems.map((item) => {
    const mtgjsonRarities = item.mtgjsonCard?.nonSecretRarities?.length
      ? item.mtgjsonCard.nonSecretRarities
      : item.mtgjsonCard?.rarities || [];
    const resolvedRarities = item.nonSecretRarities?.length ? item.nonSecretRarities : item.rarities || [];
    const rarityParts = [
      item.statedRarities?.length ? `typed: ${joinValues(item.statedRarities)}` : "",
      mtgjsonRarities.length ? `mtgjson: ${joinValues(mtgjsonRarities)}` : "",
      resolvedRarities.length ? `using: ${joinValues(resolvedRarities)}` : "",
    ].filter(Boolean);

    return {
      key: `${item.index}-${item.inputName}`,
      raw: item.originals?.join(" | ") || item.original || "",
      parsed: `${item.quantity || 1} ${item.inputName}`,
      provider: item.lookupSource || (item.status === "found" ? "preset" : "not run"),
      matched: item.card?.name || item.mtgjsonExactName || item.mtgjsonCard?.name || "",
      rarity: rarityParts.join(" / ") || "none",
      result: item.status
        ? `${item.status}${item.note ? `: ${item.note}` : ""}`
        : "parsed",
    };
  });
}

function formatterApiOrigin() {
  return window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost"
    ? PRODUCTION_ORIGIN
    : window.location.origin;
}

type PanelSettingsPopoverProps = {
  children: ReactNode;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
};

function PanelSettingsPopover({ children, isOpen, onOpenChange, title }: PanelSettingsPopoverProps) {
  const popoverRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!popoverRef.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen, onOpenChange]);

  return (
    <div className="workspace-settings" ref={popoverRef}>
      <button
        className={`icon-button ${isOpen ? "is-active" : ""}`}
        type="button"
        onClick={() => onOpenChange(!isOpen)}
        title={title}
        aria-label={title}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
      >
        <Settings size={17} />
      </button>
      {isOpen && (
        <div className="workspace-settings-panel" role="dialog" aria-label={title}>
          <strong className="workspace-settings-title">{title}</strong>
          {children}
        </div>
      )}
    </div>
  );
}

type FormatterStatusBarProps = {
  isProcessing: boolean;
  message: string;
  needsReview: number;
  onRetry: () => void;
  printFallbacks: number;
  reliabilityNote: string;
  resolvedCount: number;
  totalParsed: number;
};

function FormatterStatusBar({
  isProcessing,
  message,
  needsReview,
  onRetry,
  printFallbacks,
  reliabilityNote,
  resolvedCount,
  totalParsed,
}: FormatterStatusBarProps) {
  const metrics = formatterStatusMetrics({ totalParsed, resolvedCount, printFallbacks });
  const canReprocess = shouldShowFormatterReprocess(needsReview, isProcessing);

  return (
    <footer
      className="status-bar formatter-status-bar"
      data-status-placement="workspace"
      aria-live="polite"
    >
      <div className="status-message">
        <strong>{message}</strong>
        {reliabilityNote && <em>{reliabilityNote}</em>}
      </div>
      <div className="formatter-status-metrics">
        {metrics.map((metric) => (
          <span key={metric.key} data-status-metric={metric.key}>
            {metric.key === "parsed" && <Clipboard size={14} aria-hidden="true" />}
            {metric.key === "resolved" && <Check size={14} aria-hidden="true" />}
            {metric.label}
          </span>
        ))}
      </div>
      {canReprocess && (
        <button
          className="formatter-status-action"
          type="button"
          onClick={onRetry}
          title={FORMATTER_REPROCESS_ACTION.title}
          aria-label={FORMATTER_REPROCESS_ACTION.ariaLabel}
        >
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      )}
    </footer>
  );
}

function formatSavedPullListDiagnosticTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Time unavailable"
    : new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
    }).format(date);
}

function SavedPullListReport({ events }: { events: SavedPullListDiagnostic[] }) {
  const [copyLabel, setCopyLabel] = useState("Copy Report");

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(formatSavedPullListDiagnosticReport(events));
      setCopyLabel("Copied");
      window.setTimeout(() => setCopyLabel("Copy Report"), 1500);
    } catch {
      setCopyLabel("Copy failed");
      window.setTimeout(() => setCopyLabel("Copy Report"), 1500);
    }
  }

  return (
    <section className="saved-pull-list-report" aria-label="Saved Pull List Report">
      <div className="saved-pull-list-report-heading">
        <h3>Saved Pull List Report</h3>
        <IconButton onClick={copyReport} title={copyLabel} ariaLabel="Copy Saved Pull List Report" className="saved-pull-list-report-copy">
          <Clipboard size={14} aria-hidden="true" /><span>{copyLabel}</span>
        </IconButton>
      </div>
      {!events.length && <p className="saved-pull-list-report-empty">No Saved Pull List requests recorded this session.</p>}
      {events.length > 0 && (
        <div className="saved-pull-list-report-list">
          {events.map((event, index) => (
            <article className={`saved-pull-list-report-event is-${event.outcome}`} key={`${event.timestamp}-${event.operation}-${index}`}>
              <div className="saved-pull-list-report-event-meta">
                <time dateTime={event.timestamp}>{formatSavedPullListDiagnosticTime(event.timestamp)}</time>
                <strong>{savedPullListDiagnosticOperationLabel(event.operation)}</strong>
                <span>{event.method}</span>
                {event.status && <span>HTTP {event.status}</span>}
                <b>{savedPullListDiagnosticOutcomeLabel(event.outcome, event.operation)}</b>
              </div>
              <p>{event.endpoint}</p>
              <p>{event.message}</p>
              {(event.jobId || event.requestId) && (
                <small>
                  {event.jobId && `Job: ${shortenedSavedPullListJobId(event.jobId)}`}
                  {event.jobId && event.requestId && " / "}
                  {event.requestId && `Vercel: ${event.requestId}`}
                </small>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function PricingDataReport({ events }: { events: PricingDataDiagnostic[] }) {
  const [copyLabel, setCopyLabel] = useState("Copy Pricing Report");

  async function copyReport() {
    try {
      await navigator.clipboard.writeText(formatPricingDataDiagnosticReport(events));
      setCopyLabel("Copied");
      window.setTimeout(() => setCopyLabel("Copy Pricing Report"), 1500);
    } catch {
      setCopyLabel("Copy failed");
      window.setTimeout(() => setCopyLabel("Copy Pricing Report"), 1500);
    }
  }

  return (
    <section className="saved-pull-list-report pricing-data-report" aria-label="Pricing Data Report">
      <div className="saved-pull-list-report-heading">
        <h3>Pricing Data Report</h3>
        <IconButton onClick={copyReport} title={copyLabel} ariaLabel="Copy Pricing Data Report" className="saved-pull-list-report-copy">
          <Clipboard size={14} aria-hidden="true" /><span>{copyLabel}</span>
        </IconButton>
      </div>
      {!events.length && <p className="saved-pull-list-report-empty">No pricing-data events recorded this session.</p>}
      {events.length > 0 && (
        <div className="saved-pull-list-report-list">
          {events.map((event, index) => (
            <article className={`saved-pull-list-report-event is-${event.outcome}`} key={`${event.timestamp}-${event.stage}-${index}`}>
              <div className="saved-pull-list-report-event-meta">
                <time dateTime={event.timestamp}>{formatSavedPullListDiagnosticTime(event.timestamp)}</time>
                <strong>{pricingDataDiagnosticStageLabel(event.stage)}</strong>
                {event.status && <span>HTTP {event.status}</span>}
                {event.shardKey && <span>Shard {event.shardKey}</span>}
                <b>{pricingDataDiagnosticOutcomeLabel(event.outcome)}</b>
              </div>
              {event.requested !== undefined && (
                <p>{event.cataloged || 0}/{event.requested} cards cataloged · {event.missing || 0} unresolved</p>
              )}
              <p>{event.message}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function formatMtgjsonManifestLabel(manifest) {
  const generatedAt = manifest?.generatedAt || manifest?.source?.downloadedAt || "";
  const date = generatedAt ? new Date(generatedAt) : null;
  const updatedAt = date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat(undefined, {
      timeZone: "America/Chicago",
      month: "numeric",
      day: "numeric",
      year: "2-digit",
      hour: "numeric",
      minute: "2-digit",
    }).format(date)
    : "unknown";
  const cardCount = Number(manifest?.counts?.cards || 0);
  return cardCount
    ? `MTGJSON updated ${updatedAt} - ${cardCount.toLocaleString()} cards`
    : `MTGJSON updated ${updatedAt}`;
}

function TeamsTestPage() {
  const [text, setText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [message, setMessage] = useState("Paste test text, then send.");
  const [formatterUrl, setFormatterUrl] = useState("");

  async function sendTestPost() {
    if (!text.trim()) {
      setMessage("No test text entered.");
      return;
    }

    setIsSending(true);
    setFormatterUrl("");
    setMessage("Processing and sending test post...");

    try {
      const apiOrigin = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost"
        ? PRODUCTION_ORIGIN
        : window.location.origin;
      const response = await fetch(`${apiOrigin}/api/send-test-teams`, {
        // Vite dev serves the page locally, but Vercel serves the API route.
        // Use the deployed API for temporary manual testing from localhost.
        ...(
          apiOrigin === window.location.origin
            ? {}
            : { mode: "cors" as RequestMode }
        ),
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ text }),
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(result.error || `Test post failed (${response.status}).`);
      }

      setFormatterUrl(result.formatterUrl || "");
      setMessage(`Test post sent. Saved list ${result.id}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Test post failed.");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="formatter test-page">
        <header className="app-header">
          <div className="logo-slot">
            <img src={rrgLogo} alt="Red Raccoon Games logo" />
          </div>
          <div>
            <div className="title-row">
              <h1>Teams Test Post</h1>
              <span>v0.5.2</span>
            </div>
          </div>
          <div className="logo-slot logo-slot-right" aria-hidden="true">
            <img src={rrgLogo} alt="" />
          </div>
        </header>

        <section className="input-section test-input-section">
          <div className="section-heading">
            <div>
              <h2>Test Email Text</h2>
              <p>This posts to Teams using the formatter email flow.</p>
            </div>
            <div className="actions">
              <IconButton onClick={() => setText("")} title="Clear test text" disabled={isSending}>
                <Trash2 size={18} />
              </IconButton>
              <IconButton onClick={sendTestPost} title="Send test post to Teams" disabled={isSending} variant="primary">
                {isSending ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
                <span>Send</span>
              </IconButton>
            </div>
          </div>

          <textarea
            className="input-box test-input-box"
            value={text}
            onChange={(event) => setText(event.target.value)}
            spellCheck="false"
            aria-label="Test pull list text"
            placeholder="Paste a test pull list here."
          />
        </section>

        <footer className="status-bar" aria-live="polite">
          <strong>{message}</strong>
          {formatterUrl && (
            <a className="status-link" href={formatterUrl} target="_blank" rel="noreferrer">
              Open saved list
            </a>
          )}
        </footer>
      </section>
    </main>
  );
}

// Main app brain: state, actions, and the actual UI all live here for now.
function App() {
  const [input, setInput] = useState(() => {
    const sharedInput = sharedFormatterState.input;
    return sharedInput || createSampleList();
  });
  const [resolvedItems, setResolvedItems] = useState([]);
  const [customer, setCustomer] = useState<Customer>(() => normalizeCustomer(sharedFormatterState.customer));
  const [processedAt, setProcessedAt] = useState(() => sharedFormatterState.processedAt || null);
  const [preloadedOutput, setPreloadedOutput] = useState(() => sharedFormatterState.output || "");
  const [preloadedStats, setPreloadedStats] = useState(() => sharedFormatterState.stats || null);
  const [useCheckboxes, setUseCheckboxes] = useState(true);
  const [caseCheck, setCaseCheck] = useState(false);
  const [carefulMode, setCarefulMode] = useState(false);
  const [useMtgjson, setUseMtgjson] = useState(true);
  const [useScryfall, setUseScryfall] = useState(true);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [inputSettingsOpen, setInputSettingsOpen] = useState(false);
  const [outputSettingsOpen, setOutputSettingsOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRefreshingMtgjson, setIsRefreshingMtgjson] = useState(false);
  const [mtgjsonUpdateLabel, setMtgjsonUpdateLabel] = useState("MTGJSON update unknown");
  const [message, setMessage] = useState(() => (
    requestedSavedJobId
      ? "Loading Saved Pull List..."
      : sharedFormatterState.output
      ? "Shared processed list loaded."
      : sharedListId
        ? "Loading saved formatted list..."
      : sharedFormatterState.input
        ? "Input loaded from Teams link. Process when ready."
        : "Paste a customer list, then process."
  ));
  const [reliabilityNote, setReliabilityNote] = useState(() => sharedFormatterState.reliabilityNote || "");
  const [formatterItems, setFormatterItems] = useState<any[]>(() => sharedFormatterState.formatterItems || []);
  const [copyLinkLabel, setCopyLinkLabel] = useState("Copy Link");
  const [currentJobId, setCurrentJobId] = useState("");
  const [saveState, setSaveState] = useState<SavedJobSaveState>("idle");
  const [savedPullListDiagnostics, setSavedPullListDiagnostics] = useState<SavedPullListDiagnostic[]>([]);
  const [pricingDataDiagnostics, setPricingDataDiagnostics] = useState<PricingDataDiagnostic[]>([]);
  const [duplicateJob, setDuplicateJob] = useState<SavedJobSummary | null>(null);
  const [savedPickerOpen, setSavedPickerOpen] = useState(false);
  const [autosaveRestartRevision, setAutosaveRestartRevision] = useState(0);
  const [pricingState, setPricingState] = useState<SavedPricingState>(() => emptySavedPricingState());
  const [initialPricingState, setInitialPricingState] = useState<SavedPricingState | null>(() => (
    pricingStateForWorkspaceLoad("copy-link", null)
  ));
  const [pricingSessionKey, setPricingSessionKey] = useState(() => (
    sharedFormatterState.output ? `shared:${sharedFormatterState.processedAt || Date.now()}` : "fresh:0"
  ));
  const abortControllerRef = useRef(null);
  const copyLinkResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedSignatureRef = useRef("");
  const persistenceGenerationRef = useRef(0);
  const pricingStateRef = useRef(pricingState);
  const currentJobIdRef = useRef(currentJobId);
  const saveStateRef = useRef(saveState);
  const acceptNextJobDraftAsSavedRef = useRef(false);
  const autosaveRevisionRef = useRef(0);
  const workspaceGenerationRef = useRef(0);
  const saveRequestInFlightRef = useRef(false);
  const persistenceBlockedJobIdRef = useRef("");
  const queuedPersistenceRef = useRef<{ id: string; draft: PullListJobDraft } | null>(null);
  const persistJobDraftRef = useRef<(draft: PullListJobDraft, id?: string) => Promise<unknown>>(async () => null);

  const parsed = useMemo(() => parsePullList(input), [input]);
  const outputCustomer = customer;
  const output = useMemo(
    () => (resolvedItems.length ? formatOutput(outputCustomer, resolvedItems, useCheckboxes, processedAt) : preloadedOutput),
    [outputCustomer, resolvedItems, useCheckboxes, processedAt, preloadedOutput],
  );
  const showPricing = shouldShowPricingAssistant({ processedAt, output });
  const canShareProcessedList = Boolean(processedAt && output);
  const totalQuantity = parsed.cards.reduce((sum, item) => sum + item.quantity, 0);
  const needsReview = resolvedItems.length
    ? resolvedItems.filter((item) => item.status !== "found").length
    : preloadedStats?.needsReviewCount || 0;
  const resolvedCount = resolvedItems.length
    ? resolvedItems.length - needsReview
    : preloadedStats?.resolvedCount || 0;
  const printFallbacks = resolvedItems.length
    ? resolvedItems.filter((item) => item.status === "found" && item.printLookupFailed).length
    : preloadedStats?.printFallbackCount || 0;
  const rows = useMemo(() => diagnosticRows(parsed.cards, resolvedItems), [parsed.cards, resolvedItems]);
  const primaryFormatterAction = formatterPrimaryAction(isProcessing);
  const jobDraft = useMemo(() => normalizePullListJobDraft({
    customer,
    input,
    output,
    formatterItems: compactFormatterItems(formatterItems.length ? formatterItems : resolvedItems),
    pricingState,
    source: "manual",
    formatterSettings: { useCheckboxes },
    processedAt: processedAt || new Date().toISOString(),
    stats: { resolvedCount, needsReviewCount: needsReview, printFallbackCount: printFallbacks },
  }), [customer, input, output, formatterItems, resolvedItems, pricingState, processedAt, resolvedCount, needsReview, printFallbacks, useCheckboxes]);
  const jobDraftSignature = useMemo(() => JSON.stringify(jobDraft), [jobDraft]);

  const handlePricingStateChange = useCallback((state: SavedPricingState) => {
    setPricingState(state);
    if (!currentJobIdRef.current && state.rows.length) {
      setSaveState((current) => current === "idle" ? "dirty" : current);
    }
  }, []);

  const recordSavedPullListDiagnostic = useCallback<SavedPullListDiagnosticReporter>((event) => {
    setSavedPullListDiagnostics((current) => addSavedPullListDiagnostic(current, event));
  }, []);

  const recordPricingDataDiagnostic = useCallback<PricingDataDiagnosticReporter>((event) => {
    setPricingDataDiagnostics((current) => addPricingDataDiagnostic(current, event));
  }, []);

  const persistJobDraft = useCallback(async (draft: PullListJobDraft, id = "") => {
    if (isGeneratedSamplePullListJobDraft(draft)) {
      return null;
    }
    if (!canPersistSavedJobRequest({
      requestJobId: id,
      currentJobId: currentJobIdRef.current,
      blockedJobId: persistenceBlockedJobIdRef.current,
    })) {
      return null;
    }
    if (saveRequestInFlightRef.current) {
      queuedPersistenceRef.current = { id, draft };
      setSaveState((current) => nextSavedJobSaveState(current, "change"));
      return null;
    }
    saveRequestInFlightRef.current = true;
    const generation = ++persistenceGenerationRef.current;
    setSaveState((current) => nextSavedJobSaveState(current, "save-start"));
    try {
      const result = await persistPullListJob(draft, id, { onDiagnostic: recordSavedPullListDiagnostic });
      if (generation !== persistenceGenerationRef.current) return result;
      if (result.status === "duplicate") {
        setDuplicateJob(result.existingJob);
        setSaveState(id ? "failed" : "dirty");
        return result;
      }

      setDuplicateJob(null);
      currentJobIdRef.current = result.job.id;
      setCurrentJobId(result.job.id);
      lastSavedSignatureRef.current = JSON.stringify(normalizePullListJobDraft(draft));
      setSaveState((current) => nextSavedJobSaveState(current, "save-success"));
      window.history.replaceState(null, "", pullListJobUrl(result.job.id));
      return result;
    } catch (error) {
      if (generation !== persistenceGenerationRef.current) return null;
      setSaveState((current) => nextSavedJobSaveState(current, "save-failure"));
      setMessage("Saved Pull List save failed. Your local work is still here. Enable Diagnostics for details.");
      return null;
    } finally {
      saveRequestInFlightRef.current = false;
      const queued = queuedPersistenceRef.current;
      queuedPersistenceRef.current = null;
      if (queued) {
        const nextId = queued.id || currentJobIdRef.current;
        queueMicrotask(() => void persistJobDraftRef.current(queued.draft, nextId));
      }
    }
  }, [recordSavedPullListDiagnostic]);

  useEffect(() => {
    persistJobDraftRef.current = persistJobDraft;
  }, [persistJobDraft]);

  const restoreSavedJob = useCallback((job) => {
    abortControllerRef.current?.abort();
    workspaceGenerationRef.current += 1;
    persistenceGenerationRef.current += 1;
    autosaveRevisionRef.current += 1;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    queuedPersistenceRef.current = null;
    const restoredPricing = pricingStateForWorkspaceLoad("saved-job", job.pricingState) || emptySavedPricingState();
    currentJobIdRef.current = job.id;
    setCurrentJobId(job.id);
    setCustomer(normalizeCustomer(job.customer));
    setInput(job.input);
    setResolvedItems(Array.isArray(job.formatterItems) ? job.formatterItems : []);
    setFormatterItems(Array.isArray(job.formatterItems) ? job.formatterItems : []);
    setProcessedAt(job.processedAt || job.updatedAt);
    setPreloadedOutput(job.output);
    setPreloadedStats(job.stats);
    setUseCheckboxes(job.formatterSettings?.useCheckboxes !== false);
    setReliabilityNote("");
    setPricingState(restoredPricing);
    setInitialPricingState(restoredPricing);
    setPricingSessionKey(`job:${job.id}:${job.updatedAt}`);
    setDuplicateJob(null);
    setSavedPickerOpen(false);
    setSaveState("saved");
    setMessage("Saved Pull List loaded.");
    acceptNextJobDraftAsSavedRef.current = true;
    window.history.replaceState(null, "", pullListJobUrl(job.id));
  }, []);

  const openSavedPullList = useCallback(async (
    id: string,
    { protectCurrentWorkspace = true } = {},
  ): Promise<SavedPullListOpenResult> => {
    if (!id) return { status: "error", message: "Saved Pull List ID is required." };
    if (protectCurrentWorkspace && savedJobOpenDisposition(saveStateRef.current).requiresConfirmation) {
      const confirmed = window.confirm("This workspace has work that may not be saved. Open this Saved Pull List anyway?");
      if (!confirmed) return { status: "canceled" };
    }
    try {
      const job = await loadPullListJob(id, { onDiagnostic: recordSavedPullListDiagnostic });
      restoreSavedJob(job);
      return { status: "opened" };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Saved Pull List could not be loaded.";
      setMessage(errorMessage);
      return { status: "error", message: errorMessage };
    }
  }, [recordSavedPullListDiagnostic, restoreSavedJob]);

  const openSavedPullListFromWorkspace = useCallback(
    (id: string) => openSavedPullList(id, { protectCurrentWorkspace: true }),
    [openSavedPullList],
  );

  useEffect(() => {
    document.title = documentTitle(customer.name);
  }, [customer.name]);

  useEffect(() => {
    pricingStateRef.current = pricingState;
  }, [pricingState]);

  useEffect(() => {
    currentJobIdRef.current = currentJobId;
  }, [currentJobId]);

  useEffect(() => {
    saveStateRef.current = saveState;
  }, [saveState]);

  useEffect(() => () => {
    if (copyLinkResetRef.current) clearTimeout(copyLinkResetRef.current);
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    persistenceGenerationRef.current += 1;
    autosaveRevisionRef.current += 1;
  }, []);

  useEffect(() => {
    if (requestedSavedJobId) void openSavedPullList(requestedSavedJobId, { protectCurrentWorkspace: false });
  }, [openSavedPullList]);

  useEffect(() => {
    if (!canAutosaveCurrentJob({ currentJobId, processedAt, output })) return;
    if (acceptNextJobDraftAsSavedRef.current) {
      acceptNextJobDraftAsSavedRef.current = false;
      lastSavedSignatureRef.current = jobDraftSignature;
      setSaveState("saved");
      return;
    }
    if (jobDraftSignature === lastSavedSignatureRef.current) return;

    setSaveState((current) => nextSavedJobSaveState(current, "change"));
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    const scheduledRevision = nextAutosaveRevision(autosaveRevisionRef.current);
    autosaveRevisionRef.current = scheduledRevision;
    autosaveTimerRef.current = setTimeout(() => {
      if (!isLatestAutosaveRevision(scheduledRevision, autosaveRevisionRef.current)) return;
      void persistJobDraft(jobDraft, currentJobId);
    }, SAVED_JOB_AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    };
  }, [currentJobId, processedAt, output, jobDraftSignature, jobDraft, persistJobDraft, autosaveRestartRevision]);

  useEffect(() => {
    if (!sharedListId || requestedSavedJobId || sharedFormatterState.output) return;

    let ignore = false;

    async function loadSavedFormattedList() {
      try {
        const response = await fetch(`/api/formatted-lists?id=${encodeURIComponent(sharedListId)}`);
        const saved = await response.json().catch(() => ({}));

        if (ignore) return;

        if (!response.ok || !saved.output) {
          setMessage(
            sharedFormatterState.input
              ? "Saved formatted list expired. Input loaded from Teams link; process when ready."
              : "Saved formatted list expired.",
          );
          return;
        }

        if (saved.input) setInput(saved.input);
        setCustomer(normalizeCustomer(saved.customer));
        setProcessedAt(saved.processedAt || null);
        setPreloadedOutput(saved.output);
        setPreloadedStats(saved.stats || null);
        setReliabilityNote(saved.reliabilityNote || "");
        setResolvedItems([]);
        setFormatterItems(Array.isArray(saved.formatterItems)
          ? saved.formatterItems
          : Array.isArray(saved.pricingItems) ? saved.pricingItems : []);
        setMessage("Formatted list loaded from Teams.");
      } catch (error) {
        if (ignore) return;
        setMessage(
          sharedFormatterState.input
            ? "Could not load saved formatted list. Input loaded from Teams link; process when ready."
            : "Could not load saved formatted list.",
        );
      }
    }

    loadSavedFormattedList();

    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    if (!showDiagnostics) return;

    let ignore = false;

    async function loadMtgjsonManifest() {
      try {
        const response = await fetch(`${formatterApiOrigin()}/api/mtgjson-index`, {
          headers: { Accept: "application/json" },
        });
        const manifest = await response.json().catch(() => ({}));

        if (ignore) return;

        if (!response.ok) {
          setMtgjsonUpdateLabel(manifest.error || "MTGJSON update unavailable");
          return;
        }

        setMtgjsonUpdateLabel(formatMtgjsonManifestLabel(manifest));
      } catch {
        if (!ignore) setMtgjsonUpdateLabel("MTGJSON update unavailable");
      }
    }

    loadMtgjsonManifest();

    return () => {
      ignore = true;
    };
  }, [showDiagnostics]);

  // Runs the full formatter pipeline from raw paste to sorted, printable output.
  async function processList() {
    if (!parsed.cards.length) {
      setMessage("No card lines found yet.");
      return;
    }

    if (!useMtgjson && !useScryfall) {
      setMessage("Turn on MTGJSON or Scryfall before processing.");
      return;
    }

    const workspaceGeneration = workspaceGenerationRef.current;
    const setProcessingMessage = (nextMessage: string) => {
      if (workspaceGeneration === workspaceGenerationRef.current) setMessage(nextMessage);
    };
    setIsProcessing(true);
    setReliabilityNote("");
    setMessage(`Checking ${parsed.cards.length} unique card names...`);
    abortControllerRef.current = new AbortController();
    beginScryfallRun(abortControllerRef.current.signal, carefulMode);

    try {
      let recentCaseSets = [];
      if (caseCheck && useScryfall) {
        setProcessingMessage("Checking recent set list for case rules...");
        recentCaseSets = await fetchRecentCaseSets();
      }

      const providerOptions = { useMtgjson, useScryfall, pricingMode: true };
      const fuzzyResolved = await resolveCardNames(parsed.cards, setProcessingMessage, carefulMode, providerOptions);
      const withRarities = await enrichPrintHistories(fuzzyResolved, caseCheck && useScryfall, recentCaseSets, setProcessingMessage, carefulMode, providerOptions);

      if (workspaceGeneration !== workspaceGenerationRef.current) return;

      const inferred = inferBoundaryCustomer(parsed.customer, withRarities, parsed.cardLineCount);
      const mergedCustomer = mergeCustomerPreservingExisting(customer, inferred.customer);
      const nextProcessedAt = new Date().toISOString();
      const nextOutput = formatOutput(mergedCustomer, inferred.items, useCheckboxes, nextProcessedAt);
      const compactItems = compactFormatterItems(inferred.items);
      setCustomer(mergedCustomer);
      setResolvedItems(inferred.items);
      setFormatterItems(inferred.items);
      setPreloadedOutput("");
      setPreloadedStats(null);
      setProcessedAt(nextProcessedAt);
      const reviewCount = inferred.items.filter((item) => item.status !== "found").length;
      const nextReliabilityNote = reliabilityMessage(inferred.items, providerOptions);
      setReliabilityNote(nextReliabilityNote);
      setMessage(reviewCount ? `${reviewCount} line${reviewCount === 1 ? "" : "s"} need review.` : "List formatted.");
      const resolvedNextCount = inferred.items.length - reviewCount;
      const nextFallbackCount = inferred.items.filter((item) => item.status === "found" && item.printLookupFailed).length;
      const draft = normalizePullListJobDraft({
        customer: mergedCustomer,
        input,
        output: nextOutput,
        formatterItems: compactItems,
        pricingState: pricingStateRef.current,
        source: "manual",
        formatterSettings: { useCheckboxes },
        processedAt: nextProcessedAt,
        stats: {
          resolvedCount: resolvedNextCount,
          needsReviewCount: reviewCount,
          printFallbackCount: nextFallbackCount,
        },
      });
      if (isGeneratedSamplePullListJobDraft(draft)) {
        setMessage(reviewCount
          ? `${reviewCount} line${reviewCount === 1 ? "" : "s"} need review. Generated sample pull lists are not saved.`
          : "List formatted. Generated sample pull lists are not saved.");
      } else {
        void persistJobDraft(draft, currentJobId);
      }
    } catch (error) {
      if (workspaceGeneration === workspaceGenerationRef.current) {
        setMessage(error?.name === "AbortError" ? "Processing canceled." : error.message || "Something went wrong while processing.");
      }
    } finally {
      endScryfallRun();
      abortControllerRef.current = null;
      setIsProcessing(false);
    }
  }

  // Gives Needs Review items another pass without making the user reprocess the whole list.
  async function retryNeedsReview() {
    const reviewEntries = resolvedItems
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => item.status !== "found");

    if (!reviewEntries.length || isProcessing) return;

    if (!useMtgjson && !useScryfall) {
      setMessage("Turn on MTGJSON or Scryfall before retrying.");
      return;
    }

    const workspaceGeneration = workspaceGenerationRef.current;
    const setProcessingMessage = (nextMessage: string) => {
      if (workspaceGeneration === workspaceGenerationRef.current) setMessage(nextMessage);
    };
    setIsProcessing(true);
    setReliabilityNote("");
    setMessage(`Retrying ${reviewEntries.length} review item${reviewEntries.length === 1 ? "" : "s"}...`);
    abortControllerRef.current = new AbortController();
    beginScryfallRun(abortControllerRef.current.signal, carefulMode);

    try {
      let recentCaseSets = [];
      if (caseCheck && useScryfall) {
        setProcessingMessage("Checking recent set list for case rules...");
        recentCaseSets = await fetchRecentCaseSets();
      }

      const providerOptions = { useMtgjson, useScryfall, pricingMode: true };
      const namesResolved = await resolveCardNames(
        reviewEntries.map(({ item }) => ({ ...item, status: "missing", note: "" })),
        setProcessingMessage,
        carefulMode,
        providerOptions,
      );
      const retried = await enrichPrintHistories(namesResolved, caseCheck && useScryfall, recentCaseSets, setProcessingMessage, carefulMode, providerOptions);
      if (workspaceGeneration !== workspaceGenerationRef.current) return;
      const nextItems = [...resolvedItems];
      reviewEntries.forEach(({ index }, retryIndex) => {
        nextItems[index] = retried[retryIndex] || nextItems[index];
      });

      setResolvedItems(nextItems);
      setFormatterItems(nextItems);
      const reviewCount = nextItems.filter((item) => item.status !== "found").length;
      setReliabilityNote(reliabilityMessage(nextItems, providerOptions));
      setMessage(reviewCount ? `${reviewCount} line${reviewCount === 1 ? "" : "s"} still need review.` : "Review items resolved.");
    } catch (error) {
      if (workspaceGeneration === workspaceGenerationRef.current) {
        setMessage(error?.name === "AbortError" ? "Processing canceled." : error.message || "Something went wrong while retrying.");
      }
    } finally {
      endScryfallRun();
      abortControllerRef.current = null;
      setIsProcessing(false);
    }
  }

  // Cancels the current Scryfall run when the user wants off the ride.
  function abortProcessing() {
    abortControllerRef.current?.abort();
    setMessage("Canceling current Scryfall work...");
  }

  function sharedFormatterItems() {
    return formatterItems.length ? formatterItems : resolvedItems;
  }

  function sharedUrl() {
    const hash = encodeFormattedHash({
      input,
      output,
      processedAt: processedAt || "",
      reliabilityNote,
      customer: outputCustomer,
      stats: { resolvedCount, needsReviewCount: needsReview, printFallbackCount: printFallbacks },
      formatterItems: compactFormatterItems(sharedFormatterItems()),
    });
    const base = formatterShareUrlWithoutJob();
    return `${base.origin}${base.pathname}${base.search}${hash}`;
  }

  async function copyShareLink() {
    if (!canShareProcessedList) return;
    try {
      await navigator.clipboard.writeText(sharedUrl());
      setMessage("Link copied.");
      setCopyLinkLabel("Copied");
      if (copyLinkResetRef.current) clearTimeout(copyLinkResetRef.current);
      copyLinkResetRef.current = setTimeout(() => {
        setCopyLinkLabel("Copy Link");
      }, 1200);
    } catch {
      setMessage("Could not copy the share link. Your browser may block clipboard access.");
      setCopyLinkLabel("Copy Failed");
      if (copyLinkResetRef.current) clearTimeout(copyLinkResetRef.current);
      copyLinkResetRef.current = setTimeout(() => {
        setCopyLinkLabel("Copy Link");
      }, 1200);
    }
  }

  // Downloads the formatted output as a plain text file.
  function downloadOutput() {
    if (!output) return;
    const blob = new Blob([output], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = safeFileName(outputCustomer, processedAt);
    link.click();
    URL.revokeObjectURL(link.href);
    setMessage("Text file downloaded.");
  }

  // Opens a simple print window with monospace text for receipt-printer friendliness.
  function printOutput() {
    if (!output) return;

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setMessage("Print window was blocked.");
      return;
    }

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>${safeFileName(outputCustomer, processedAt)}</title>
          <style>
            body { font-family: Consolas, monospace; font-size: 11pt; line-height: 1.35; white-space: pre-wrap; }
          </style>
        </head>
        <body>${output.replace(/[&<>"']/g, (char) => ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#039;",
        }[char]))}</body>
      </html>
    `);
    printWindow.document.close();
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 100);
  }

  // Resets processed results whenever the paste changes, so stale output does not cosplay as current.
  function handleInputChange(value) {
    if (isProcessing) {
      abortControllerRef.current?.abort();
      workspaceGenerationRef.current += 1;
    }
    setInput(value);
    setResolvedItems([]);
    setProcessedAt(null);
    setPreloadedOutput("");
    setPreloadedStats(null);
    setReliabilityNote("");
    setFormatterItems([]);
    setDuplicateJob(null);
    setSaveState((current) => currentJobId
      ? nextSavedJobSaveState(current, "invalidate")
      : nextSavedJobSaveState(current, "change"));
    setMessage("Input changed. Process again when ready.");
  }

  async function refreshMtgjsonIndex() {
    if (isRefreshingMtgjson) return;

    const secret = window.prompt("Enter the MTGJSON refresh secret.");
    if (!secret?.trim()) {
      setMessage("MTGJSON refresh canceled.");
      return;
    }

    setIsRefreshingMtgjson(true);
    setMessage("Refreshing MTGJSON index...");

    try {
      const response = await fetch(`${formatterApiOrigin()}/api/refresh-mtgjson-index`, {
        headers: {
          Authorization: `Bearer ${secret.trim()}`,
          Accept: "application/json",
        },
      });
      const result = await response.json().catch(() => ({}));

      if (!response.ok || !result.ok) {
        throw new Error(result.error || `MTGJSON refresh failed (${response.status}).`);
      }

      clearMtgjsonIndexCache();
      setMtgjsonUpdateLabel(formatMtgjsonManifestLabel(result));
      const cardCount = Number(result.counts?.cards || 0).toLocaleString();
      const failedSets = Number(result.source?.mtgjsonMeta?.failedSetCount || 0);
      setMessage(failedSets
        ? `MTGJSON refreshed: ${cardCount} cards; ${failedSets} set${failedSets === 1 ? "" : "s"} failed.`
        : `MTGJSON refreshed: ${cardCount} cards.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "MTGJSON refresh failed.");
    } finally {
      setIsRefreshingMtgjson(false);
    }
  }

  function handleCustomerField(field: "name" | "phone" | "email", value: string) {
    setCustomer((current) => normalizeCustomer({ ...current, [field]: value }));
    if (!currentJobId) setSaveState((current) => nextSavedJobSaveState(current, "change"));
  }

  const deleteSavedPullListFromWorkspace = useCallback(async (jobId: string) => {
    const deletingCurrentJob = currentJobIdRef.current === jobId;
    if (deletingCurrentJob) {
      if (saveRequestInFlightRef.current) {
        throw new Error("Wait for the current save to finish before deleting this list.");
      }
      persistenceBlockedJobIdRef.current = jobId;
      persistenceGenerationRef.current += 1;
      autosaveRevisionRef.current += 1;
      queuedPersistenceRef.current = null;
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    }

    try {
      await deletePullListJob(jobId, { onDiagnostic: recordSavedPullListDiagnostic });
      const nextSession = savedSessionAfterJobDeletion({
        currentJobId: currentJobIdRef.current,
        saveState: saveStateRef.current,
      }, jobId);
      if (nextSession.currentJobId === currentJobIdRef.current) return;

      persistenceGenerationRef.current += 1;
      autosaveRevisionRef.current += 1;
      queuedPersistenceRef.current = null;
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      currentJobIdRef.current = nextSession.currentJobId;
      saveStateRef.current = nextSession.saveState;
      acceptNextJobDraftAsSavedRef.current = false;
      lastSavedSignatureRef.current = "";
      setCurrentJobId(nextSession.currentJobId);
      setSaveState(nextSession.saveState);
      setDuplicateJob((current) => current?.id === jobId ? null : current);
      setMessage("Saved Pull List deleted. Your local workspace is intact and is now not saved.");
      const url = new URL(window.location.href);
      url.searchParams.delete("job");
      window.history.replaceState(null, "", url);
    } catch (error) {
      if (deletingCurrentJob && currentJobIdRef.current === jobId) {
        setAutosaveRestartRevision((current) => current + 1);
      }
      throw error;
    } finally {
      if (persistenceBlockedJobIdRef.current === jobId) {
        persistenceBlockedJobIdRef.current = "";
      }
    }
  }, [recordSavedPullListDiagnostic]);

  function startNewList() {
    if (newListDisposition(saveState).requiresConfirmation) {
      const confirmed = window.confirm("This workspace has work that may not be saved. Start a new list anyway?");
      if (!confirmed) return;
    }
    if (isProcessing) abortControllerRef.current?.abort();
    workspaceGenerationRef.current += 1;
    persistenceGenerationRef.current += 1;
    autosaveRevisionRef.current += 1;
    queuedPersistenceRef.current = null;
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    currentJobIdRef.current = "";
    setCurrentJobId("");
    setCustomer(EMPTY_CUSTOMER);
    setInput("");
    setResolvedItems([]);
    setFormatterItems([]);
    setProcessedAt(null);
    setPreloadedOutput("");
    setPreloadedStats(null);
    setReliabilityNote("");
    setDuplicateJob(null);
    setPricingState(emptySavedPricingState());
    setInitialPricingState(null);
    setPricingSessionKey((current) => `fresh:${current}:${Date.now()}`);
    setSaveState("idle");
    setSavedPickerOpen(false);
    setMessage("New list ready.");
    if (copyLinkResetRef.current) clearTimeout(copyLinkResetRef.current);
    setCopyLinkLabel("Copy Link");
    lastSavedSignatureRef.current = "";
    const url = new URL(window.location.href);
    url.searchParams.delete("job");
    url.searchParams.delete("list");
    url.hash = "";
    window.history.replaceState(null, "", url);
  }

  function duplicateWarningText(existing: SavedJobSummary) {
    const name = existing.customer?.name?.trim();
    const date = new Date(existing.updatedAt);
    const when = Number.isNaN(date.getTime())
      ? "recently"
      : new Intl.DateTimeFormat(undefined, {
        timeZone: "America/Chicago",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(date);
    return name
      ? `This pull list is already saved for ${name} from ${when}.`
      : `This pull list matches a Saved Pull List from ${when}.`;
  }

  return (
    <main className="app-shell">
      <section className="formatter">
        <header className="app-header">
          <div className="logo-slot">
            <img src={rrgLogo} alt="Red Raccoon Games logo" />
          </div>
          <div>
            <div className="title-row">
              <h1>MIKE PULLSMITH</h1>
              <span>v0.5.2</span>
            </div>
          </div>
          <div className="logo-slot logo-slot-right">
            <img src={rrgLogo} alt="" />
          </div>
        </header>

        <section className="session-bar" aria-label="Current pull list session">
          <div className="session-customer-fields">
            <div className="session-customer-left">
              <div className="session-customer-with-picker">
                <SavedPullListsPicker
                  isOpen={savedPickerOpen}
                  onOpenChange={setSavedPickerOpen}
                  onOpenJob={openSavedPullListFromWorkspace}
                  onDeleteJob={deleteSavedPullListFromWorkspace}
                  onDiagnostic={recordSavedPullListDiagnostic}
                  currentJobId={currentJobId}
                  currentJobSaveInFlight={saveRequestInFlightRef.current}
                />
                <input
                  value={customer.name}
                  onChange={(event) => handleCustomerField("name", event.target.value)}
                  placeholder="Customer"
                  aria-label="Customer"
                  autoComplete="name"
                />
              </div>
              <input
                value={customer.phone}
                onChange={(event) => handleCustomerField("phone", event.target.value)}
                placeholder="Phone"
                aria-label="Phone"
                autoComplete="tel"
                inputMode="tel"
              />
            </div>
            <div className="session-customer-right">
              <input
                value={customer.email}
                onChange={(event) => handleCustomerField("email", event.target.value)}
                placeholder="Email"
                aria-label="Email"
                autoComplete="email"
                inputMode="email"
              />
              <div className="session-actions">
                <span
                  className={`save-state is-${saveState}`}
                  aria-live="polite"
                  title={currentJobId ? `Saved Pull List ${currentJobId}` : "No Saved Pull List has been created yet"}
                >
                  <span>{saveStateLabel(saveState)}</span>
                  {currentJobId && <small aria-hidden="true">#{currentJobId.slice(-8)}</small>}
                </span>
                <button className="icon-button session-new-list" type="button" onClick={startNewList} title="Start a clean pull-list workspace">
                  <ListPlus size={16} /><span>New List</span>
                </button>
              </div>
            </div>
          </div>
        </section>

        {duplicateJob && (
          <aside className="duplicate-warning" role="status">
            <CircleAlert size={19} aria-hidden="true" />
            <strong>{duplicateWarningText(duplicateJob)}</strong>
            <button type="button" onClick={() => void openSavedPullListFromWorkspace(duplicateJob.id)}>Open saved job</button>
          </aside>
        )}

        <div className="formatter-workspace">
        <section className="input-section">
          <div className="section-heading">
            <div className="workspace-panel-title">
              <h2>Input Text</h2>
            </div>
            <div className="actions workspace-panel-actions">
              <IconButton onClick={() => handleInputChange("")} title="Clear input">
                <Trash2 size={18} />
              </IconButton>
              <PanelSettingsPopover title="Input settings" isOpen={inputSettingsOpen} onOpenChange={setInputSettingsOpen}>
              <label className="workspace-settings-option" title="Use the local MTGJSON index for fast exact matches.">
                <input
                  type="checkbox"
                  checked={useMtgjson}
                  onChange={(event) => {
                    setUseMtgjson(event.target.checked);
                    setResolvedItems([]);
                    if (currentJobId) setSaveState("stale");
                    setProcessedAt(null);
                    setFormatterItems([]);
                    setReliabilityNote("");
                    setMessage("MTGJSON setting changed. Process again when ready.");
                  }}
                />
                MTGJSON
              </label>
              <label className="workspace-settings-option" title="Use Scryfall for misses, fuzzy matches, special versions, and richer verification.">
                <input
                  type="checkbox"
                  checked={useScryfall}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    setUseScryfall(enabled);
                    if (!enabled) setCaseCheck(false);
                    setResolvedItems([]);
                    if (currentJobId) setSaveState("stale");
                    setProcessedAt(null);
                    setFormatterItems([]);
                    setReliabilityNote("");
                    setMessage(enabled
                      ? "Scryfall enabled. Process again when ready."
                      : "Scryfall disabled. Output will be less verified.");
                  }}
                />
                Scryfall
              </label>
              <label className="workspace-settings-option" title="Use slower one-at-a-time Scryfall lookups.">
                <input
                  type="checkbox"
                  checked={carefulMode}
                  onChange={(event) => {
                    setCarefulMode(event.target.checked);
                    setResolvedItems([]);
                    if (currentJobId) setSaveState("stale");
                    setProcessedAt(null);
                    setFormatterItems([]);
                    setReliabilityNote("");
                    setMessage("Careful Mode setting changed. Process again when ready.");
                  }}
                />
                Careful Mode
              </label>
              <label className="workspace-settings-option is-disabled" title="Coming Soon">
                <input type="checkbox" disabled />
                <Sparkles size={16} />
                Smart Cleanup
              </label>
              </PanelSettingsPopover>
              <IconButton
                onClick={primaryFormatterAction.action === "cancel-processing" ? abortProcessing : processList}
                title={primaryFormatterAction.title}
                ariaLabel={primaryFormatterAction.label}
                variant={primaryFormatterAction.variant}
              >
                {primaryFormatterAction.action === "cancel-processing" ? <CircleX size={18} /> : <Search size={18} />}
                <span>{primaryFormatterAction.label}</span>
              </IconButton>
            </div>
          </div>

          <textarea
            className="input-box"
            value={input}
            onChange={(event) => handleInputChange(event.target.value)}
            spellCheck="false"
            aria-label="Raw pull list text"
          />
        </section>

        <section className="output-section">
          <div className="section-heading">
            <div className="workspace-panel-title">
              <h2>Output Text</h2>
              <p>{parsed.cards.length} unique / {totalQuantity} total cards</p>
            </div>
            <div className="actions workspace-panel-actions">
              <IconButton onClick={downloadOutput} title="Download .txt" disabled={!output}>
                <Download size={18} />
              </IconButton>
              <IconButton
                onClick={copyShareLink}
                title={copyLinkLabel}
                ariaLabel={copyLinkLabel}
                className="copy-link-action"
                disabled={!canShareProcessedList}
              >
                <Link2 size={18} /><span className="copy-link-label">{copyLinkLabel}</span>
              </IconButton>
              <PanelSettingsPopover title="Output settings" isOpen={outputSettingsOpen} onOpenChange={setOutputSettingsOpen}>
              <label className="workspace-settings-option">
                <input
                  type="checkbox"
                  checked={useCheckboxes}
                  onChange={(event) => setUseCheckboxes(event.target.checked)}
                />
                Checkboxes
              </label>
              <label className={`workspace-settings-option ${!useScryfall ? "is-disabled" : ""}`} title={useScryfall ? "Still working on this!" : "Case Check requires Scryfall."}>
                <input
                  type="checkbox"
                  checked={caseCheck}
                  disabled={!useScryfall}
                  onChange={(event) => {
                    setCaseCheck(event.target.checked);
                    setResolvedItems([]);
                    if (currentJobId) setSaveState("stale");
                    setProcessedAt(null);
                    setFormatterItems([]);
                    setReliabilityNote("");
                    setMessage("Case check setting changed. Process again when ready.");
                  }}
                />
                Case Check
              </label>
              </PanelSettingsPopover>
              <IconButton onClick={printOutput} title="Print output" disabled={!output} variant="primary">
                <Printer size={18} /><span>Print Pull List</span>
              </IconButton>
            </div>
          </div>

          <textarea
            className="output-box"
            value={output || "Printable pull list will appear here!"}
            readOnly
            aria-label="Formatted output text"
            onFocus={(event) => event.target.select()}
          />
        </section>
        <FormatterStatusBar
          isProcessing={isProcessing}
          message={message}
          needsReview={needsReview}
          onRetry={retryNeedsReview}
          printFallbacks={printFallbacks}
          reliabilityNote={reliabilityNote}
          resolvedCount={resolvedCount}
          totalParsed={parsed.cards.length}
        />
        </div>

        <Suspense fallback={<div className="pricing-loading-panel">Loading pricing assistant…</div>}>
            <PricingPanel
              visible={showPricing}
              items={formatterItems.length ? formatterItems : resolvedItems}
              customer={outputCustomer || {}}
              processedAt={processedAt}
              apiOrigin={formatterApiOrigin()}
              logoUrl={receiptLogo}
              onMessage={setMessage}
              initialPricingState={initialPricingState}
              sessionKey={pricingSessionKey}
              onPricingStateChange={handlePricingStateChange}
              onPricingDataDiagnostic={recordPricingDataDiagnostic}
            />
        </Suspense>

        {showDiagnostics && (
          <section className="diagnostics-section">
            <div className="section-heading">
              <div>
                <h2>Diagnostics</h2>
                <p>{rows.length} line{rows.length === 1 ? "" : "s"}</p>
                <p className="diagnostics-meta">{mtgjsonUpdateLabel}</p>
              </div>
              <div className="actions diagnostics-actions">
                <IconButton onClick={refreshMtgjsonIndex} title="Refresh MTGJSON data" disabled={isRefreshingMtgjson || isProcessing}>
                  {isRefreshingMtgjson ? <Loader2 size={16} className="spin" /> : <RefreshCw size={16} />}
                  <span>MTGJSON</span>
                </IconButton>
                <Bug size={19} />
              </div>
            </div>
            <div className="diagnostics-table-wrap">
              <table className="diagnostics-table">
                <thead>
                  <tr>
                    <th>Raw</th>
                    <th>Parsed</th>
                    <th>Provider</th>
                    <th>Matched</th>
                    <th>Rarity</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.key}>
                      <td>{row.raw}</td>
                      <td>{row.parsed}</td>
                      <td>{row.provider}</td>
                      <td>{row.matched}</td>
                      <td>{row.rarity}</td>
                      <td>{row.result}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <PricingDataReport events={pricingDataDiagnostics} />
            <SavedPullListReport events={savedPullListDiagnostics} />
          </section>
        )}

        <div className="footer-note-row">
          <div className="quiet-mode-toggles">
            <label className="quiet-footer-toggle" title="Show diagnostics">
              <input
                type="checkbox"
                checked={showDiagnostics}
                aria-label="Show diagnostics"
                onChange={(event) => setShowDiagnostics(event.target.checked)}
              />
              <Bug size={12} />
            </label>
          </div>
          <p className="work-note">Updated 8.23.2026, Now we cookin' - Derek</p>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(isTeamsTestPage ? <TeamsTestPage /> : <App />);

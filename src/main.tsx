import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Check,
  CircleX,
  Clipboard,
  Copy,
  Download,
  Loader2,
  Printer,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Trash2,
} from "lucide-react";
import {
  beginScryfallRun,
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
import { decodeFormatterHash } from "./share-link";
import "./styles.css";
import rrgLogo from "../images/LOGO_PNG_HEADER.png";

// Reusable little icon button so the toolbar does not turn into copy-paste soup.
type IconButtonProps = {
  children: ReactNode;
  title: string;
  variant?: "primary" | "secondary" | "danger";
} & Pick<ButtonHTMLAttributes<HTMLButtonElement>, "disabled" | "onClick">;

const sharedFormatterState = decodeFormatterHash(window.location.hash);
const sharedListId = new URLSearchParams(window.location.search).get("list") || "";
const isTeamsTestPage = window.location.pathname === "/teams-test";
const PRODUCTION_ORIGIN = "https://card-list-formatter.vercel.app";

function IconButton({ children, onClick, title, disabled = false, variant = "secondary" }: IconButtonProps) {
  return (
    <button className={`icon-button ${variant}`} onClick={onClick} title={title} disabled={disabled}>
      {children}
    </button>
  );
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
              <span>v0.3.0</span>
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
  const [processedCustomer, setProcessedCustomer] = useState(() => (
    sharedFormatterState.customer?.name || sharedFormatterState.customer?.contact
      ? sharedFormatterState.customer
      : null
  ));
  const [processedAt, setProcessedAt] = useState(() => sharedFormatterState.processedAt || null);
  const [preloadedOutput, setPreloadedOutput] = useState(() => sharedFormatterState.output || "");
  const [preloadedStats, setPreloadedStats] = useState(() => sharedFormatterState.stats || null);
  const [useCheckboxes, setUseCheckboxes] = useState(true);
  const [caseCheck, setCaseCheck] = useState(false);
  const [carefulMode, setCarefulMode] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState(() => (
    sharedFormatterState.output
      ? "Formatted list loaded from Teams."
      : sharedListId
        ? "Loading saved formatted list..."
      : sharedFormatterState.input
        ? "Input loaded from Teams link. Process when ready."
        : "Paste a customer list, then process."
  ));
  const [reliabilityNote, setReliabilityNote] = useState(() => sharedFormatterState.reliabilityNote || "");
  const abortControllerRef = useRef(null);

  const parsed = useMemo(() => parsePullList(input), [input]);
  const outputCustomer = processedCustomer || parsed.customer;
  const output = useMemo(
    () => (resolvedItems.length ? formatOutput(outputCustomer, resolvedItems, useCheckboxes, processedAt) : preloadedOutput),
    [outputCustomer, resolvedItems, useCheckboxes, processedAt, preloadedOutput],
  );
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

  useEffect(() => {
    if (!sharedListId || sharedFormatterState.output) return;

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
        setProcessedCustomer(saved.customer || null);
        setProcessedAt(saved.processedAt || null);
        setPreloadedOutput(saved.output);
        setPreloadedStats(saved.stats || null);
        setReliabilityNote(saved.reliabilityNote || "");
        setResolvedItems([]);
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

  // Runs the full formatter pipeline from raw paste to sorted, printable output.
  async function processList() {
    if (!parsed.cards.length) {
      setMessage("No card lines found yet.");
      return;
    }

    setIsProcessing(true);
    setReliabilityNote("");
    setMessage(`Checking ${parsed.cards.length} unique card names with Scryfall...`);
    abortControllerRef.current = new AbortController();
    beginScryfallRun(abortControllerRef.current.signal, carefulMode);

    try {
      let recentCaseSets = [];
      if (caseCheck) {
        setMessage("Checking recent set list for case rules...");
        recentCaseSets = await fetchRecentCaseSets();
      }

      const fuzzyResolved = await resolveCardNames(parsed.cards, setMessage, carefulMode);
      const withRarities = await enrichPrintHistories(fuzzyResolved, caseCheck, recentCaseSets, setMessage, carefulMode);

      const inferred = inferBoundaryCustomer(parsed.customer, withRarities, parsed.cardLineCount);
      setProcessedCustomer(inferred.customer);
      setResolvedItems(inferred.items);
      setPreloadedOutput("");
      setPreloadedStats(null);
      setProcessedAt(new Date().toISOString());
      const reviewCount = inferred.items.filter((item) => item.status !== "found").length;
      setReliabilityNote(reliabilityMessage(inferred.items));
      setMessage(reviewCount ? `${reviewCount} line${reviewCount === 1 ? "" : "s"} need review.` : "List formatted.");
    } catch (error) {
      setMessage(error?.name === "AbortError" ? "Processing canceled." : error.message || "Something went wrong while processing.");
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

    setIsProcessing(true);
    setReliabilityNote("");
    setMessage(`Retrying ${reviewEntries.length} review item${reviewEntries.length === 1 ? "" : "s"}...`);
    abortControllerRef.current = new AbortController();
    beginScryfallRun(abortControllerRef.current.signal, carefulMode);

    try {
      let recentCaseSets = [];
      if (caseCheck) {
        setMessage("Checking recent set list for case rules...");
        recentCaseSets = await fetchRecentCaseSets();
      }

      const namesResolved = await resolveCardNames(
        reviewEntries.map(({ item }) => ({ ...item, status: "missing", note: "" })),
        setMessage,
        carefulMode,
      );
      const retried = await enrichPrintHistories(namesResolved, caseCheck, recentCaseSets, setMessage, carefulMode);
      const nextItems = [...resolvedItems];
      reviewEntries.forEach(({ index }, retryIndex) => {
        nextItems[index] = retried[retryIndex] || nextItems[index];
      });

      setResolvedItems(nextItems);
      const reviewCount = nextItems.filter((item) => item.status !== "found").length;
      setReliabilityNote(reliabilityMessage(nextItems));
      setMessage(reviewCount ? `${reviewCount} line${reviewCount === 1 ? "" : "s"} still need review.` : "Review items resolved.");
    } catch (error) {
      setMessage(error?.name === "AbortError" ? "Processing canceled." : error.message || "Something went wrong while retrying.");
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

  // Copies the formatted text to the clipboard for quick paste-and-go store work.
  async function copyOutput() {
    if (!output) return;
    await navigator.clipboard.writeText(output);
    setMessage("Output copied.");
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
    setInput(value);
    setResolvedItems([]);
    setProcessedCustomer(null);
    setProcessedAt(null);
    setPreloadedOutput("");
    setPreloadedStats(null);
    setReliabilityNote("");
    setMessage("Input changed. Process again when ready.");
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
              <h1>RRG Pull List Formatter</h1>
              <span>v0.3.0</span>
            </div>
          </div>
          <div className="logo-slot logo-slot-right" aria-hidden="true">
            <img src={rrgLogo} alt="" />
          </div>
        </header>

        <section className="input-section">
          <div className="section-heading">
            <h2>Input Text</h2>
            <div className="actions">
              <label className="checkbox-option help-option" title="Still working on this!">
                <input
                  type="checkbox"
                  checked={caseCheck}
                  onChange={(event) => {
                    setCaseCheck(event.target.checked);
                    setResolvedItems([]);
                    setProcessedCustomer(null);
                    setProcessedAt(null);
                    setReliabilityNote("");
                    setMessage("Case check setting changed. Process again when ready.");
                  }}
                />
                Case Check
              </label>
              <label className="checkbox-option" title="Use slower one-at-a-time Scryfall lookups.">
                <input
                  type="checkbox"
                  checked={carefulMode}
                  onChange={(event) => {
                    setCarefulMode(event.target.checked);
                    setResolvedItems([]);
                    setProcessedCustomer(null);
                    setProcessedAt(null);
                    setReliabilityNote("");
                    setMessage("Careful Mode setting changed. Process again when ready.");
                  }}
                />
                Careful Mode
              </label>
              <span className="checkbox-option disabled-option" title="Coming Soon">
                <Sparkles size={16} />
                Smart Cleanup
              </span>
              <IconButton onClick={() => handleInputChange("")} title="Clear input">
                <Trash2 size={18} />
              </IconButton>
              <IconButton onClick={processList} title="Process list" disabled={isProcessing} variant="primary">
                {isProcessing ? <Loader2 size={18} className="spin" /> : <Search size={18} />}
                <span>Process</span>
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
            <div>
              <h2>Output Text</h2>
              <p>{parsed.cards.length} unique / {totalQuantity} total cards</p>
            </div>
            <div className="actions">
              <label className="checkbox-option">
                <input
                  type="checkbox"
                  checked={useCheckboxes}
                  onChange={(event) => setUseCheckboxes(event.target.checked)}
                />
                Checkboxes
              </label>
              <IconButton onClick={copyOutput} title="Copy output" disabled={!output}>
                <Copy size={18} />
              </IconButton>
              <IconButton onClick={downloadOutput} title="Download .txt" disabled={!output}>
                <Download size={18} />
              </IconButton>
              <IconButton onClick={printOutput} title="Print output" disabled={!output}>
                <Printer size={18} />
              </IconButton>
            </div>
          </div>

          <textarea
            className="output-box"
            value={output || "Processed output will appear here! :-)"}
            readOnly
            aria-label="Formatted output text"
            onFocus={(event) => event.target.select()}
          />
        </section>

        <footer className="status-bar" aria-live="polite">
          {isProcessing && (
            <IconButton onClick={abortProcessing} title="Cancel processing" variant="danger">
              <CircleX size={18} />
            </IconButton>
          )}
          <strong>{message}</strong>
          {reliabilityNote && <em>{reliabilityNote}</em>}
          <div className="status-counts">
            <span><Clipboard size={17} /> {parsed.cards.length} parsed</span>
            <span><Check size={17} /> {resolvedCount} resolved</span>
            <IconButton onClick={retryNeedsReview} title="Retry Needs Review items" disabled={!needsReview || isProcessing}>
              <RefreshCw size={18} />
            </IconButton>
            {printFallbacks > 0 && <span>{printFallbacks} fallback</span>}
          </div>
        </footer>

        <p className="work-note">Updated 8/9/26, Continue to let me know if and when this breaks! -Derek</p>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(isTeamsTestPage ? <TeamsTestPage /> : <App />);

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { useMemo, useRef, useState } from "react";
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
import { decodeInputHash } from "./share-link";
import "./styles.css";
import rrgLogo from "../images/LOGO_PNG_HEADER.png";

// Reusable little icon button so the toolbar does not turn into copy-paste soup.
type IconButtonProps = {
  children: ReactNode;
  title: string;
  variant?: "primary" | "secondary" | "danger";
} & Pick<ButtonHTMLAttributes<HTMLButtonElement>, "disabled" | "onClick">;

function IconButton({ children, onClick, title, disabled = false, variant = "secondary" }: IconButtonProps) {
  return (
    <button className={`icon-button ${variant}`} onClick={onClick} title={title} disabled={disabled}>
      {children}
    </button>
  );
}

// Main app brain: state, actions, and the actual UI all live here for now.
function App() {
  const [input, setInput] = useState(() => {
    const sharedInput = decodeInputHash(window.location.hash);
    return sharedInput || createSampleList();
  });
  const [resolvedItems, setResolvedItems] = useState([]);
  const [processedCustomer, setProcessedCustomer] = useState(null);
  const [processedAt, setProcessedAt] = useState(null);
  const [useCheckboxes, setUseCheckboxes] = useState(true);
  const [caseCheck, setCaseCheck] = useState(false);
  const [carefulMode, setCarefulMode] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState(() => (
    decodeInputHash(window.location.hash) ? "Input loaded from Teams link. Process when ready." : "Paste a customer list, then process."
  ));
  const [reliabilityNote, setReliabilityNote] = useState("");
  const abortControllerRef = useRef(null);

  const parsed = useMemo(() => parsePullList(input), [input]);
  const outputCustomer = processedCustomer || parsed.customer;
  const output = useMemo(
    () => (resolvedItems.length ? formatOutput(outputCustomer, resolvedItems, useCheckboxes, processedAt) : ""),
    [outputCustomer, resolvedItems, useCheckboxes, processedAt],
  );
  const totalQuantity = parsed.cards.reduce((sum, item) => sum + item.quantity, 0);
  const needsReview = resolvedItems.filter((item) => item.status !== "found").length;
  const printFallbacks = resolvedItems.filter((item) => item.status === "found" && item.printLookupFailed).length;

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
              <span>v0.2.4</span>
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
            <span><Check size={17} /> {resolvedItems.length - needsReview} resolved</span>
            <IconButton onClick={retryNeedsReview} title="Retry Needs Review items" disabled={!needsReview || isProcessing}>
              <RefreshCw size={18} />
            </IconButton>
            {printFallbacks > 0 && <span>{printFallbacks} fallback</span>}
          </div>
        </footer>

        <p className="work-note">Still working on this, let me know if you come across any weirdness! -Derek</p>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);

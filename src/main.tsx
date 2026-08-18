import type { ButtonHTMLAttributes, ReactNode } from "react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Check,
  CircleX,
  Clipboard,
  Copy,
  Bug,
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
  clearMtgjsonIndexCache,
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
import receiptLogo from "../images/Logo-LineArt.png";

const PricingPanel = lazy(() => import("./PricingPanel"));

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
              <span>v0.4.4</span>
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
  const [useMtgjson, setUseMtgjson] = useState(true);
  const [useScryfall, setUseScryfall] = useState(true);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRefreshingMtgjson, setIsRefreshingMtgjson] = useState(false);
  const [mtgjsonUpdateLabel, setMtgjsonUpdateLabel] = useState("MTGJSON update unknown");
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
  const showPricing = Boolean(processedAt && output);
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

    setIsProcessing(true);
    setReliabilityNote("");
    setMessage(`Checking ${parsed.cards.length} unique card names...`);
    abortControllerRef.current = new AbortController();
    beginScryfallRun(abortControllerRef.current.signal, carefulMode);

    try {
      let recentCaseSets = [];
      if (caseCheck && useScryfall) {
        setMessage("Checking recent set list for case rules...");
        recentCaseSets = await fetchRecentCaseSets();
      }

      const providerOptions = { useMtgjson, useScryfall, pricingMode: true };
      const fuzzyResolved = await resolveCardNames(parsed.cards, setMessage, carefulMode, providerOptions);
      const withRarities = await enrichPrintHistories(fuzzyResolved, caseCheck && useScryfall, recentCaseSets, setMessage, carefulMode, providerOptions);

      const inferred = inferBoundaryCustomer(parsed.customer, withRarities, parsed.cardLineCount);
      setProcessedCustomer(inferred.customer);
      setResolvedItems(inferred.items);
      setPreloadedOutput("");
      setPreloadedStats(null);
      setProcessedAt(new Date().toISOString());
      const reviewCount = inferred.items.filter((item) => item.status !== "found").length;
      setReliabilityNote(reliabilityMessage(inferred.items, providerOptions));
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

    if (!useMtgjson && !useScryfall) {
      setMessage("Turn on MTGJSON or Scryfall before retrying.");
      return;
    }

    setIsProcessing(true);
    setReliabilityNote("");
    setMessage(`Retrying ${reviewEntries.length} review item${reviewEntries.length === 1 ? "" : "s"}...`);
    abortControllerRef.current = new AbortController();
    beginScryfallRun(abortControllerRef.current.signal, carefulMode);

    try {
      let recentCaseSets = [];
      if (caseCheck && useScryfall) {
        setMessage("Checking recent set list for case rules...");
        recentCaseSets = await fetchRecentCaseSets();
      }

      const providerOptions = { useMtgjson, useScryfall, pricingMode: true };
      const namesResolved = await resolveCardNames(
        reviewEntries.map(({ item }) => ({ ...item, status: "missing", note: "" })),
        setMessage,
        carefulMode,
        providerOptions,
      );
      const retried = await enrichPrintHistories(namesResolved, caseCheck && useScryfall, recentCaseSets, setMessage, carefulMode, providerOptions);
      const nextItems = [...resolvedItems];
      reviewEntries.forEach(({ index }, retryIndex) => {
        nextItems[index] = retried[retryIndex] || nextItems[index];
      });

      setResolvedItems(nextItems);
      const reviewCount = nextItems.filter((item) => item.status !== "found").length;
      setReliabilityNote(reliabilityMessage(nextItems, providerOptions));
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
              <span>v0.4.4</span>
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
              <label className="checkbox-option" title="Use the local MTGJSON index for fast exact matches.">
                <input
                  type="checkbox"
                  checked={useMtgjson}
                  onChange={(event) => {
                    setUseMtgjson(event.target.checked);
                    setResolvedItems([]);
                    setProcessedCustomer(null);
                    setProcessedAt(null);
                    setReliabilityNote("");
                    setMessage("MTGJSON setting changed. Process again when ready.");
                  }}
                />
                MTGJSON
              </label>
              <label className="checkbox-option" title="Use Scryfall for misses, fuzzy matches, special versions, and richer verification.">
                <input
                  type="checkbox"
                  checked={useScryfall}
                  onChange={(event) => {
                    const enabled = event.target.checked;
                    setUseScryfall(enabled);
                    if (!enabled) setCaseCheck(false);
                    setResolvedItems([]);
                    setProcessedCustomer(null);
                    setProcessedAt(null);
                    setReliabilityNote("");
                    setMessage(enabled
                      ? "Scryfall enabled. Process again when ready."
                      : "Scryfall disabled. Output will be less verified.");
                  }}
                />
                Scryfall
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
              <label className="checkbox-option help-option" title={useScryfall ? "Still working on this!" : "Case Check requires Scryfall."}>
                <input
                  type="checkbox"
                  checked={caseCheck}
                  disabled={!useScryfall}
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

        {showPricing && (
          <Suspense fallback={showPricing ? <div className="pricing-loading-panel">Loading pricing assistant…</div> : null}>
            <PricingPanel
              visible
              items={resolvedItems}
              customer={outputCustomer || {}}
              processedAt={processedAt}
              apiOrigin={formatterApiOrigin()}
              logoUrl={receiptLogo}
              onMessage={setMessage}
            />
          </Suspense>
        )}

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
          </section>
        )}

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
          <p className="work-note">Updated 8/16/26, Continue to let me know if and when this breaks! -Derek</p>
        </div>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(isTeamsTestPage ? <TeamsTestPage /> : <App />);

import {
  cardFromCatalog,
  editionOptions,
  pricingNameKey,
  type PricingAssistantRowState,
  type PricingCatalog,
  type PricingCard,
  type PricingPrinting,
} from "./pricing";
import type { PricingCatalogCoverage } from "./pricing-catalog-state";
import type { PricingDataDiagnosticOutcome } from "./pricing-data-diagnostics";

type RecoveryCandidateOptions = {
  force?: boolean;
  excludedCardKeys?: Iterable<string>;
};

export type PricingCatalogRecoveryBatchSummary = {
  outcome: PricingDataDiagnosticOutcome;
  requested: number;
  cataloged: number;
  missing: number;
  failed: number;
  message: string;
};

/**
 * Claims would-be missing canonical cards before recovery starts. The mutable
 * attempt set is deliberately session-only and lets React rerenders see the
 * claim synchronously rather than starting duplicate requests.
 */
export function claimPricingCatalogRecoveryCards(
  cardNames: string[],
  coverage: PricingCatalogCoverage,
  catalog: PricingCatalog,
  attemptedCardKeys: Set<string>,
  options: RecoveryCandidateOptions = {},
) {
  const excludedCardKeys = new Set(options.excludedCardKeys || []);
  const claimed: string[] = [];
  const claimedKeys = new Set<string>();

  cardNames.forEach((cardName) => {
    const key = pricingNameKey(cardName);
    if (!key || claimedKeys.has(key) || excludedCardKeys.has(key)) return;
    if (coverage[key]?.status !== "missing") return;
    if (editionOptions(cardFromCatalog(catalog, cardName)).length) return;
    if (!options.force && attemptedCardKeys.has(key)) return;

    claimedKeys.add(key);
    claimed.push(cardName);
    if (!options.force) attemptedCardKeys.add(key);
  });

  return claimed;
}

export function resetPricingCatalogRecoveryAttempts(attemptedCardKeys: Set<string>) {
  attemptedCardKeys.clear();
}

export function pendingPricingCatalogRecoveryCoverage(
  coverage: PricingCatalogCoverage,
  cardNames: string[],
) {
  const next = { ...coverage };
  cardNames.forEach((cardName) => {
    next[pricingNameKey(cardName)] = { status: "pending" };
  });
  return next;
}

/** A background catalog load must not reinterpret a consumed failed attempt as conclusive absence. */
export function preserveConsumedPricingCatalogRecoveryCoverage(
  coverage: PricingCatalogCoverage,
  previous: PricingCatalogCoverage,
  attemptedCardKeys: Set<string>,
) {
  const next = { ...coverage };
  Object.entries(coverage).forEach(([key, entry]) => {
    if (entry.status !== "missing" || !attemptedCardKeys.has(key)) return;
    if (previous[key]?.status === "error") {
      next[key] = previous[key];
    } else if (previous[key]?.status === "pending") {
      next[key] = {
        status: "error",
        message: "Automatic printing-history recovery was interrupted. Retry pricing data.",
      };
    }
  });
  return next;
}

/** Merge recovered printings without replacing any already-good catalog entry. */
export function mergeRecoveredPricingCatalog(
  currentCatalog: PricingCatalog,
  recoveredCatalog: PricingCatalog,
) {
  const nextCatalog = { ...currentCatalog };
  Object.entries(recoveredCatalog).forEach(([key, recoveredCard]) => {
    const currentCard = nextCatalog[key];
    if (!currentCard) {
      nextCatalog[key] = recoveredCard;
      return;
    }

    const printingIdentity = (printing: PricingPrinting) => printing.uuid || [
      printing.setCode,
      printing.number,
      printing.finishes.join("/"),
      printing.foilTreatment,
      printing.treatments.join("/"),
    ].join("|");
    const mergedPrintings = new Map<string, PricingPrinting>();
    recoveredCard.printings.forEach((printing) => mergedPrintings.set(printingIdentity(printing), printing));
    currentCard.printings.forEach((printing) => mergedPrintings.set(printingIdentity(printing), printing));
    nextCatalog[key] = {
      ...recoveredCard,
      ...currentCard,
      name: currentCard.name || recoveredCard.name,
      printings: Array.from(mergedPrintings.values()),
    } satisfies PricingCard;
  });
  return nextCatalog;
}

export function completedPricingCatalogRecoveryCoverage(
  coverage: PricingCatalogCoverage,
  cardNames: string[],
  catalog: PricingCatalog,
  failedCardKeys: Iterable<string> = [],
  errorMessage = "Automatic printing-history recovery failed. Retry pricing data.",
) {
  const failed = new Set(failedCardKeys);
  const next = { ...coverage };
  cardNames.forEach((cardName) => {
    const key = pricingNameKey(cardName);
    if (editionOptions(cardFromCatalog(catalog, cardName)).length) {
      next[key] = { status: "ready" };
    } else if (failed.has(key)) {
      next[key] = { status: "error", message: errorMessage };
    } else {
      next[key] = {
        status: "missing",
        message: "No supported physical printing is available for this card.",
      };
    }
  });
  return next;
}

export function summarizePricingCatalogRecoveryBatch(
  cardNames: string[],
  catalog: PricingCatalog,
  failedCardKeys: Iterable<string> = [],
  failureMessage = "",
  automatic = true,
): PricingCatalogRecoveryBatchSummary {
  const uniqueNames = Array.from(new Map(cardNames.map((name) => [pricingNameKey(name), name])).values());
  const failed = new Set(failedCardKeys);
  const cataloged = uniqueNames.filter((name) => (
    editionOptions(cardFromCatalog(catalog, name)).length > 0
  )).length;
  const requested = uniqueNames.length;
  const missing = requested - cataloged;
  const failedCount = uniqueNames.filter((name) => failed.has(pricingNameKey(name))).length;
  const prefix = automatic ? "Automatic recovery" : "Manual recovery";
  const outcome: PricingDataDiagnosticOutcome = failedCount === requested && requested > 0
    ? "failed"
    : cataloged === requested
      ? "success"
      : "partial";
  const message = outcome === "failed"
    ? `${automatic ? "Automatic" : "Manual"} printing-history recovery failed.${failureMessage ? ` ${failureMessage}` : ""}`
    : `${prefix}: ${cataloged}/${requested} cards cataloged.${missing ? ` ${missing} card${missing === 1 ? "" : "s"} still missing${failedCount ? `; ${failedCount} failed` : ""}.` : ""}${failureMessage && failedCount ? ` ${failureMessage}` : ""}`;
  return { outcome, requested, cataloged, missing, failed: failedCount, message };
}

/** Listed Median remains downstream of an explicit staff Found decision. */
export function foundPricingRowsForListedMedian(rows: PricingAssistantRowState[]) {
  return rows.filter((row) => row.found && row.quantity > 0);
}

import {
  cardFromCatalog,
  editionOptions,
  initializePricingRowSelection,
  pricingNameKey,
  pricingShardKey,
  type PricingAssistantRowState,
  type PricingCatalog,
} from "./pricing";

export type PricingCatalogCoverageStatus = "pending" | "ready" | "error" | "missing";

export type PricingCatalogCoverageEntry = {
  status: PricingCatalogCoverageStatus;
  message?: string;
};

export type PricingCatalogCoverage = Record<string, PricingCatalogCoverageEntry>;

export type PricingCatalogRowState =
  | "needs-review"
  | "loading"
  | "ready"
  | "load-error"
  | "unavailable";

export type PricingCatalogLoadState = "loading" | "ready" | "error";

export function pendingPricingCatalogCoverage(
  cardNames: string[],
  catalog: PricingCatalog,
  previous: PricingCatalogCoverage = {},
  force = false,
) {
  return Object.fromEntries(cardNames.map((cardName) => {
    const key = pricingNameKey(cardName);
    const card = cardFromCatalog(catalog, cardName);
    const existing = previous[key];
    if (!force && editionOptions(card).length) return [key, { status: "ready" as const }];
    if (!force && (existing?.status === "missing" || existing?.status === "error")) return [key, existing];
    return [key, { status: "pending" as const }];
  }));
}

/**
 * A loaded shard is conclusive, while fallback recovery is only conclusive for
 * cards it actually recovered. Missing cards behind a failed source stay errors.
 */
export function completedPricingCatalogCoverage(
  cardNames: string[],
  catalog: PricingCatalog,
  options: {
    completedShardKeys?: Iterable<string>;
    failedShardKeys?: Iterable<string>;
    recoveryAttempted?: boolean;
    errorMessage?: string;
  } = {},
) {
  const completedShardKeys = new Set(options.completedShardKeys || []);
  const failedShardKeys = new Set(options.failedShardKeys || []);
  const errorMessage = options.errorMessage || "Printing data failed to load. Retry pricing data.";
  return Object.fromEntries(cardNames.map((cardName) => {
    const key = pricingNameKey(cardName);
    const card = cardFromCatalog(catalog, cardName);
    if (editionOptions(card).length) return [key, { status: "ready" as const }];
    const shardKey = pricingShardKey(cardName);
    if (completedShardKeys.has(shardKey)) {
      return [key, {
        status: "missing" as const,
        message: "No supported physical printing is available for this card.",
      }];
    }
    if (failedShardKeys.has(shardKey) || options.recoveryAttempted) {
      return [key, { status: "error" as const, message: errorMessage }];
    }
    return [key, { status: "pending" as const }];
  }));
}

export function pricingCatalogCoverageCounts(coverage: PricingCatalogCoverage) {
  const entries = Object.values(coverage);
  return {
    requested: entries.length,
    cataloged: entries.filter((entry) => entry.status === "ready").length,
    unavailable: entries.filter((entry) => entry.status === "missing").length,
    errors: entries.filter((entry) => entry.status === "error").length,
    pending: entries.filter((entry) => entry.status === "pending").length,
  };
}

export function pricingCatalogLoadStateForCoverage(coverage: PricingCatalogCoverage): PricingCatalogLoadState {
  const counts = pricingCatalogCoverageCounts(coverage);
  if (counts.pending) return "loading";
  if (counts.errors) return "error";
  return "ready";
}

export function pricingCatalogRowState(
  row: Pick<PricingAssistantRowState, "resolved" | "canonicalName">,
  coverage: PricingCatalogCoverage,
  catalog: PricingCatalog,
): PricingCatalogRowState {
  if (!row.resolved) return "needs-review";
  const entry = coverage[pricingNameKey(row.canonicalName)];
  if (!entry || entry.status === "pending") return "loading";
  if (entry.status === "error") return "load-error";
  if (entry.status === "missing") return "unavailable";
  // A ready marker and missing catalog record should never occur in a committed
  // load. Treat the inconsistent transition as still loading, never unavailable.
  return editionOptions(cardFromCatalog(catalog, row.canonicalName)).length ? "ready" : "loading";
}

export function pricingCatalogRowPresentation(
  state: PricingCatalogRowState,
  hasSelectedEdition = false,
) {
  if (state === "needs-review") {
    return { label: "Needs review", title: "This card needs review before it can be priced.", loading: false, error: false };
  }
  if (state === "loading") {
    return { label: "Loading…", title: "Printing data is still loading.", loading: true, error: false };
  }
  if (state === "load-error") {
    return { label: "Load failed", title: "Printing data failed to load. Retry pricing data.", loading: false, error: true };
  }
  if (state === "unavailable") {
    return { label: "Unavailable", title: "No supported physical printing is available for this card.", loading: false, error: false };
  }
  return {
    label: hasSelectedEdition ? "" : "Choose printing",
    title: hasSelectedEdition ? "Choose this card's physical printing." : "Choose a supported physical printing.",
    loading: false,
    error: false,
  };
}

export function pricingCatalogControlsAvailable(state: PricingCatalogRowState, isBasicLand = false) {
  return state === "ready" || (isBasicLand && state === "unavailable");
}

export function applyPricingCatalogToRows(rows: PricingAssistantRowState[], catalog: PricingCatalog) {
  return rows.map((row) => (
    row.resolved ? initializePricingRowSelection(row, cardFromCatalog(catalog, row.canonicalName)) : row
  ));
}

export function isCurrentPricingLoad(loadGeneration: number, currentGeneration: number) {
  return loadGeneration === currentGeneration;
}

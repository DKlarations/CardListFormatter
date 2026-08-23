export const EMPTY_PRICING_MESSAGE = "Process a customer list or add a card manually.";

/** Pricing is a first-class workspace even when no formatter session exists. */
export function shouldShowPricingAssistant(_formatterState?: {
  processedAt?: string | null;
  output?: string;
}) {
  return true;
}

export function pricingAssistantViewState(rowCount: number) {
  const isEmpty = rowCount === 0;
  return {
    isEmpty,
    emptyMessage: EMPTY_PRICING_MESSAGE,
    emptyTextAlignment: "center" as const,
    showAddCard: true,
    showTotals: !isEmpty,
  };
}

import type { PricingAssistantRowState } from "./pricing";

/** Normalizes serializable Pricing Assistant work without loading market catalogs. */
export function normalizePricingAssistantRow(row: Partial<PricingAssistantRowState>): PricingAssistantRowState {
  const canonicalName = row.canonicalName || row.cardName || row.displayName || "";
  const legacySurge = row.treatment === "surge" && row.finish === "foil";
  return {
    id: row.id || "",
    groupId: row.groupId || "",
    sourceIndex: Number(row.sourceIndex) || 0,
    requestedQuantity: Math.max(1, Number(row.requestedQuantity) || 1),
    isBasicLand: Boolean(row.isBasicLand),
    quantity: Math.max(0, Number(row.quantity) || 0),
    found: Boolean(row.found),
    resolved: Boolean(row.resolved),
    displayName: row.displayName || row.cardName || canonicalName,
    canonicalName,
    manuallyCreated: Boolean(row.manuallyCreated),
    requestedFlavorName: row.requestedFlavorName || "",
    requestedSetCode: row.requestedSetCode || "",
    requestedFinish: row.requestedFinish,
    requestedFoilTreatment: row.requestedFoilTreatment,
    requestedTreatment: row.requestedTreatment || "",
    setSelectionSource: row.setSelectionSource === "manual" ? "manual" : "default",
    setCode: row.setCode || "",
    selectedPrintingUuid: row.selectedPrintingUuid || "",
    finish: row.finish || "normal",
    treatment: legacySurge ? "standard" : row.treatment || "standard",
    foilTreatment: legacySurge ? "surge" : row.foilTreatment || "standard",
    priceOverride: row.priceOverride ?? null,
  };
}

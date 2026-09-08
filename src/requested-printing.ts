/** Customer printing intent, separate from canonical card-name identity. */
export type RequestedPrintingPreference = {
  setCode?: string;
  /** Exact source text: never coerce to a number or strip meaningful characters. */
  collectorNumber?: string;
  treatment?: string;
  finish?: "normal" | "foil" | "etched";
  foilTreatment?: "standard" | "surge";
  flavorName?: string;
  /** An imported hint can be checked later by Pricing Assistant. */
  sourceFormat?: "set-collector-export";
};

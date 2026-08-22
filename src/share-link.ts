import LZString from "lz-string";
import { normalizePricingAssistantRow, type PricingAssistantState } from "./pricing";

const INPUT_HASH_PREFIX = "#input=";
const FORMATTED_HASH_PREFIX = "#formatted=";

export type SharedFormatterState = {
  input?: string;
  output?: string;
  processedAt?: string;
  reliabilityNote?: string;
  customer?: {
    name?: string;
    contact?: string;
  };
  stats?: {
    resolvedCount?: number;
    needsReviewCount?: number;
    printFallbackCount?: number;
  };
  /** Compact resolved items used to rebuild Pricing Assistant rows, not provider catalogs. */
  pricingItems?: Array<Record<string, unknown>>;
  pricing?: PricingAssistantState;
};

export function encodeInputHash(text: string) {
  return `${INPUT_HASH_PREFIX}${LZString.compressToEncodedURIComponent(text)}`;
}

export function decodeInputHash(hash: string) {
  if (!hash.startsWith(INPUT_HASH_PREFIX)) return "";
  return LZString.decompressFromEncodedURIComponent(hash.slice(INPUT_HASH_PREFIX.length)) || "";
}

export function encodeFormattedHash(state: SharedFormatterState) {
  return `${FORMATTED_HASH_PREFIX}${LZString.compressToEncodedURIComponent(JSON.stringify({
    version: 4,
    input: state.input || "",
    output: state.output || "",
    processedAt: state.processedAt || "",
    reliabilityNote: state.reliabilityNote || "",
    customer: {
      name: state.customer?.name || "",
      contact: state.customer?.contact || "",
    },
    stats: {
      resolvedCount: state.stats?.resolvedCount || 0,
      needsReviewCount: state.stats?.needsReviewCount || 0,
      printFallbackCount: state.stats?.printFallbackCount || 0,
    },
    pricingItems: Array.isArray(state.pricingItems) ? state.pricingItems : [],
    pricing: state.pricing && Array.isArray(state.pricing.rows) ? {
      pricingSource: state.pricing.pricingSource || "tcgplayer-listed-median",
      rows: state.pricing.rows,
    } : undefined,
  }))}`;
}

export function decodeFormatterHash(hash: string): SharedFormatterState {
  if (hash.startsWith(FORMATTED_HASH_PREFIX)) {
    try {
      const raw = LZString.decompressFromEncodedURIComponent(hash.slice(FORMATTED_HASH_PREFIX.length));
      const parsed = raw ? JSON.parse(raw) : {};
      return {
        input: parsed.input || "",
        output: parsed.output || "",
        processedAt: parsed.processedAt || "",
        reliabilityNote: parsed.reliabilityNote || "",
        customer: {
          name: parsed.customer?.name || "",
          contact: parsed.customer?.contact || "",
        },
        stats: {
          resolvedCount: parsed.stats?.resolvedCount || 0,
          needsReviewCount: parsed.stats?.needsReviewCount || 0,
          printFallbackCount: parsed.stats?.printFallbackCount || 0,
        },
        pricingItems: Array.isArray(parsed.pricingItems) ? parsed.pricingItems : [],
        pricing: parsed.version >= 2 && Array.isArray(parsed.pricing?.rows) ? {
          pricingSource: typeof parsed.pricing.pricingSource === "string"
            ? parsed.pricing.pricingSource
            : "tcgplayer-listed-median",
          rows: parsed.pricing.rows.map((row: Record<string, unknown>) => normalizePricingAssistantRow(row)),
        } : undefined,
      };
    } catch {
      return {};
    }
  }

  return {
    input: decodeInputHash(hash),
  };
}

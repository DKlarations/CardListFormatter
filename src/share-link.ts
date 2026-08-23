import LZString from "lz-string";
import { normalizeCustomer, type Customer } from "./customer";

const INPUT_HASH_PREFIX = "#input=";
const FORMATTED_HASH_PREFIX = "#formatted=";

export type SharedFormatterState = {
  input?: string;
  output?: string;
  processedAt?: string;
  reliabilityNote?: string;
  customer?: Partial<Customer> & { contact?: string };
  stats?: {
    resolvedCount?: number;
    needsReviewCount?: number;
    printFallbackCount?: number;
  };
  /** Compact formatter-resolution items used to start a fresh Pricing Assistant session. */
  formatterItems?: Array<Record<string, unknown>>;
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
    version: 5,
    input: state.input || "",
    output: state.output || "",
    processedAt: state.processedAt || "",
    reliabilityNote: state.reliabilityNote || "",
    customer: normalizeCustomer(state.customer),
    stats: {
      resolvedCount: state.stats?.resolvedCount || 0,
      needsReviewCount: state.stats?.needsReviewCount || 0,
      printFallbackCount: state.stats?.printFallbackCount || 0,
    },
    formatterItems: Array.isArray(state.formatterItems) ? state.formatterItems : [],
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
        customer: normalizeCustomer(parsed.customer),
        stats: {
          resolvedCount: parsed.stats?.resolvedCount || 0,
          needsReviewCount: parsed.stats?.needsReviewCount || 0,
          printFallbackCount: parsed.stats?.printFallbackCount || 0,
        },
        // v2-v4 called these pricingItems, but they are formatter resolution data.
        // Deliberately ignore legacy `pricing`: every shared list starts fresh pricing work.
        formatterItems: Array.isArray(parsed.formatterItems)
          ? parsed.formatterItems
          : Array.isArray(parsed.pricingItems)
            ? parsed.pricingItems
            : [],
      };
    } catch {
      return {};
    }
  }

  return {
    input: decodeInputHash(hash),
  };
}

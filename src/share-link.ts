import LZString from "lz-string";

const INPUT_HASH_PREFIX = "#input=";
const FORMATTED_HASH_PREFIX = "#formatted=";

type SharedFormattedState = {
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
};

export function encodeInputHash(text: string) {
  return `${INPUT_HASH_PREFIX}${LZString.compressToEncodedURIComponent(text)}`;
}

export function decodeInputHash(hash: string) {
  if (!hash.startsWith(INPUT_HASH_PREFIX)) return "";
  return LZString.decompressFromEncodedURIComponent(hash.slice(INPUT_HASH_PREFIX.length)) || "";
}

export function encodeFormattedHash(state: SharedFormattedState) {
  return `${FORMATTED_HASH_PREFIX}${LZString.compressToEncodedURIComponent(JSON.stringify({
    version: 1,
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
  }))}`;
}

export function decodeFormatterHash(hash: string): SharedFormattedState {
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
      };
    } catch {
      return {};
    }
  }

  return {
    input: decodeInputHash(hash),
  };
}

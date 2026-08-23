import LZString from "lz-string";

export function formatterLinkForInput(baseUrl, text) {
  const url = new URL(baseUrl);
  url.hash = `input=${LZString.compressToEncodedURIComponent(text)}`;
  return url.toString();
}

export function formatterLinkForSavedList(baseUrl, id, fallbackInput) {
  const url = new URL(baseUrl);
  url.searchParams.set("list", id);
  url.hash = `input=${LZString.compressToEncodedURIComponent(fallbackInput)}`;
  return url.toString();
}

export function formatterLinkForFormattedOutput(baseUrl, state) {
  const url = new URL(baseUrl);
  url.hash = `formatted=${LZString.compressToEncodedURIComponent(JSON.stringify({
    version: 1,
    input: state.input || "",
    output: state.output || "",
    processedAt: state.processedAt || "",
    reliabilityNote: state.reliabilityNote || "",
    customer: {
      name: state.customer?.name || "",
      phone: state.customer?.phone || "",
      email: state.customer?.email || "",
      contact: state.customer?.contact || "",
    },
    stats: {
      resolvedCount: state.stats?.resolvedCount || 0,
      needsReviewCount: state.stats?.needsReviewCount || 0,
      printFallbackCount: state.stats?.printFallbackCount || 0,
    },
  }))}`;
  return url.toString();
}

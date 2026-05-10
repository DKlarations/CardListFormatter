import LZString from "lz-string";

export function formatterLinkForInput(baseUrl, text) {
  const url = new URL(baseUrl);
  url.hash = `input=${LZString.compressToEncodedURIComponent(text)}`;
  return url.toString();
}

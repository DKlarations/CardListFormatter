import LZString from "lz-string";

const INPUT_HASH_PREFIX = "#input=";

export function encodeInputHash(text: string) {
  return `${INPUT_HASH_PREFIX}${LZString.compressToEncodedURIComponent(text)}`;
}

export function decodeInputHash(hash: string) {
  if (!hash.startsWith(INPUT_HASH_PREFIX)) return "";
  return LZString.decompressFromEncodedURIComponent(hash.slice(INPUT_HASH_PREFIX.length)) || "";
}

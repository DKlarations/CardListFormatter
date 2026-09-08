import { type RequestedPrintingPreference } from "./requested-printing.js";

export type StructuredExportLine = {
  name: string;
  setCode: string;
  collectorNumber: string;
  finish?: RequestedPrintingPreference["finish"];
  foilTreatment?: RequestedPrintingPreference["foilTreatment"];
  sourceFormat: "set-collector-export";
};

// Greedy name captures the final parenthetical candidate, never internal name
// parentheses. A complete set + collector suffix is required; neither alone is metadata.
const EXPORT_LINE = /^(.+)\s+\(([A-Z0-9]{2,8})\)\s+([\p{L}\p{N}★☆*†‡∞][\p{L}\p{N}./★☆*†‡∞+\-]*)(?:\s+(\*F\*))?\s*$/iu;

export function parseStructuredExportLine(value: string, quantityRemoved = false): StructuredExportLine | null {
  const line = quantityRemoved ? value.trim() : value.trim().replace(/^(?:\d+)\s*x?\s+/i, "");
  const match = line.match(EXPORT_LINE);
  if (!match || /^\*F\*$/i.test(match[3])) return null;
  return {
    name: match[1].trim(), setCode: match[2].toUpperCase(), collectorNumber: match[3],
    ...(match[4] ? { finish: "foil" as const, foilTreatment: "standard" as const } : {}),
    sourceFormat: "set-collector-export",
  };
}

/** Broader than parsing: unsupported trailing export markers remain detectable. */
export function detectStructuredExportSuffix(value: string): boolean {
  return /\([A-Z0-9]{2,8}\)\s+[\p{L}\p{N}★☆*†‡∞][\p{L}\p{N}./★☆*†‡∞+\-]*(?:\s+[^\r\n]*)?\s*$/iu.test(value);
}

const CP1252_EXTRA = new Map(Array.from("€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ", (character, index) => [character, 0x80 + index]));
function byteFor(character: string) {
  const point = character.codePointAt(0);
  return point <= 0xff ? point : CP1252_EXTRA.get(character);
}
function mojibakeScore(value: string) {
  const characters = Array.from(value);
  return characters.reduce((count, character, index) => {
    const next = characters[index + 1] && byteFor(characters[index + 1]);
    return count + (/[ÃÂâð]/u.test(character) && next >= 0x80 && next <= 0xbf ? 1 : 0);
  }, 0);
}

/** Decode only recognizable, reversible mojibake byte sequences. Correct Unicode
 * around a damaged segment never gets encoded or rewritten. */
export function repairMojibake(value: string): string {
  let result = value;
  for (let pass = 0; pass < 3 && mojibakeScore(result); pass += 1) {
    const characters = Array.from(result);
    let repaired = "";
    for (let index = 0; index < characters.length; index += 1) {
      const first = characters[index];
      const lead = byteFor(first);
      const length = /[ÃÂâð]/u.test(first) ? lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : 2 : 0;
      const bytes = characters.slice(index, index + length).map(byteFor);
      if (length && bytes.length === length && bytes.every((byte) => byte !== undefined)) {
        try {
          const decoded = new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
          const roundTrip = new TextEncoder().encode(decoded);
          if (!/[\u0000-\u001f\u007f-\u009f\ufffd]/u.test(decoded)
            && roundTrip.length === bytes.length && roundTrip.every((byte, position) => byte === bytes[position])) {
            repaired += decoded;
            index += length - 1;
            continue;
          }
        } catch { /* Not a reversible UTF-8 byte sequence; keep the original text. */ }
      }
      repaired += first;
    }
    if (mojibakeScore(repaired) >= mojibakeScore(result)) break;
    result = repaired;
  }
  return result;
}

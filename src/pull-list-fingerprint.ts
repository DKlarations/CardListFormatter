import { createHash } from "node:crypto";

type FingerprintEntry = {
  card: string;
  quantity: number;
  set: string;
  finish: string;
  foilTreatment: string;
  treatment: string;
  flavor: string;
};

function normalizedIdentity(value: unknown) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function normalizedIntent(value: unknown) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function itemEntry(item: Record<string, any>): FingerprintEntry {
  const canonical = item.card?.name
    || item.mtgjsonCard?.name
    || item.canonicalName
    || item.inputName
    || item.displayName
    || "";
  const requestedPrinting = item.requestedPrinting || {};
  const requestedFlavor = requestedPrinting.flavorName
    || item.requestedFlavorName
    || item.alternateTitle
    || item.requestedDisplayName
    || "";
  const flavor = normalizedIdentity(requestedFlavor) === normalizedIdentity(canonical)
    ? ""
    : normalizedIdentity(requestedFlavor);

  return {
    card: normalizedIdentity(canonical),
    quantity: Math.max(1, Math.floor(Number(item.quantity ?? item.requestedQuantity) || 1)),
    set: String(requestedPrinting.setCode || item.requestedSetCode || "").trim().toUpperCase(),
    finish: normalizedIntent(requestedPrinting.finish || item.requestedFinish),
    foilTreatment: normalizedIntent(requestedPrinting.foilTreatment || item.requestedFoilTreatment),
    treatment: normalizedIntent(requestedPrinting.treatment || item.requestedTreatment),
    flavor,
  };
}

function entryKey(entry: FingerprintEntry) {
  return [
    entry.card,
    entry.set,
    entry.finish,
    entry.foilTreatment,
    entry.treatment,
    entry.flavor,
  ].join("|");
}

export function normalizePullListForFingerprint(items: unknown): FingerprintEntry[] {
  const grouped = new Map<string, FingerprintEntry>();
  (Array.isArray(items) ? items : [])
    .filter((item) => item && typeof item === "object")
    .forEach((rawItem) => {
      const entry = itemEntry(rawItem as Record<string, any>);
      if (!entry.card) return;
      const key = entryKey(entry);
      const existing = grouped.get(key);
      if (existing) existing.quantity += entry.quantity;
      else grouped.set(key, entry);
    });

  return Array.from(grouped.values()).sort((left, right) => (
    entryKey(left).localeCompare(entryKey(right))
      || left.quantity - right.quantity
  ));
}

export function serializePullListFingerprint(items: unknown) {
  return JSON.stringify(normalizePullListForFingerprint(items));
}

/** Deterministic server-side SHA-256 digest; normalized serialization remains separately testable. */
export function pullListFingerprint(items: unknown) {
  const input = `pull-list-v1|${serializePullListFingerprint(items)}`;
  return `plf1-${createHash("sha256").update(input).digest("hex")}`;
}

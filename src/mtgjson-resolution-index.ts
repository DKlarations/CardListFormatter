// v3 adds explicit paper evidence; older indexes remain usable for name hints only.
export const MTGJSON_RESOLUTION_INDEX_VERSION = 3;

export type MtgjsonIndexedCard = {
  name: string;
  asciiName?: string;
  colorIdentity?: string[];
  layout?: string;
  printings?: string[];
  scryfallOracleId?: string;
  subtypes?: string[];
  supertypes?: string[];
  rarities?: string[];
  nonSecretRarities?: string[];
  type?: string;
  types?: string[];
  hasPlayablePaperPrinting?: boolean;
  paperRarities?: string[];
};

export type MtgjsonCardIndex = {
  version?: number;
  generatedAt?: string;
  rarityHistoryComplete?: boolean;
  cards: Record<string, MtgjsonIndexedCard>;
  aliases?: Record<string, string>;
  ambiguousAliases?: Record<string, string[]>;
};

const RARITIES = new Set(["common", "uncommon", "rare", "mythic"]);
const STRING_FIELDS = ["asciiName", "layout", "scryfallOracleId", "type"];
const ARRAY_FIELDS = ["colorIdentity", "printings", "subtypes", "supertypes", "rarities", "nonSecretRarities", "types"];

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function validateMtgjsonCardIndex(value: unknown): value is MtgjsonCardIndex {
  if (!isRecord(value) || !isRecord(value.cards)) return false;
  if (value.version !== undefined && ![1, 2, MTGJSON_RESOLUTION_INDEX_VERSION].includes(value.version)) return false;
  if (value.generatedAt !== undefined && typeof value.generatedAt !== "string") return false;
  const currentSchema = value.version === MTGJSON_RESOLUTION_INDEX_VERSION;
  if (currentSchema && typeof value.rarityHistoryComplete !== "boolean") return false;

  for (const [key, card] of Object.entries(value.cards)) {
    if (!key || !isRecord(card) || typeof card.name !== "string" || !card.name.trim()) return false;
    if (STRING_FIELDS.some((field) => card[field] !== undefined && typeof card[field] !== "string")) return false;
    if (ARRAY_FIELDS.some((field) => card[field] !== undefined && !stringArray(card[field]))) return false;
    if (currentSchema) {
      if (typeof card.hasPlayablePaperPrinting !== "boolean" || !stringArray(card.paperRarities)) return false;
      if (card.paperRarities.some((rarity) => !RARITIES.has(rarity))) return false;
      if (!card.hasPlayablePaperPrinting && card.paperRarities.length) return false;
    }
  }

  if (value.aliases !== undefined) {
    if (!isRecord(value.aliases)) return false;
    for (const target of Object.values(value.aliases)) {
      if (typeof target !== "string" || !Object.hasOwn(value.cards, target)) return false;
    }
  }
  if (value.ambiguousAliases !== undefined) {
    if (!isRecord(value.ambiguousAliases)) return false;
    for (const [alias, targets] of Object.entries(value.ambiguousAliases)) {
      if (!stringArray(targets) || new Set(targets).size < 2 || targets.some((key) => !Object.hasOwn(value.cards, key))) return false;
      if (value.aliases && Object.hasOwn(value.aliases, alias)) return false;
    }
  }
  return true;
}

export function hasSufficientLocalPaperEvidence(card: MtgjsonIndexedCard, index: MtgjsonCardIndex): boolean {
  return index.version === MTGJSON_RESOLUTION_INDEX_VERSION
    && index.rarityHistoryComplete === true
    && card.hasPlayablePaperPrinting === true
    && Array.isArray(card.paperRarities)
    && card.paperRarities.length > 0
    && card.paperRarities.every((rarity) => RARITIES.has(rarity));
}

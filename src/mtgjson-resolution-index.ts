// v3 adds explicit paper evidence; older indexes support bounded compatibility verification.
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
  failedSetCount?: number;
  source?: { mtgjsonMeta?: { failedSetCount?: number } };
  requiresCompatibilityVerification?: boolean;
  manifestSchemaVersion?: number;
  manifestSchemaMismatch?: boolean;
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
  if (value.version !== undefined && (!Number.isInteger(value.version) || value.version < 1)) return false;
  if (value.generatedAt !== undefined && typeof value.generatedAt !== "string") return false;
  const currentSchema = value.version === MTGJSON_RESOLUTION_INDEX_VERSION;
  if (currentSchema && value.rarityHistoryComplete !== undefined && typeof value.rarityHistoryComplete !== "boolean") return false;

  for (const [key, card] of Object.entries(value.cards)) {
    if (!key || !isRecord(card) || typeof card.name !== "string" || !card.name.trim()) return false;
    if (STRING_FIELDS.some((field) => card[field] !== undefined && typeof card[field] !== "string")) return false;
    if (ARRAY_FIELDS.some((field) => card[field] !== undefined && !stringArray(card[field]))) return false;
    if (Number(value.version) >= MTGJSON_RESOLUTION_INDEX_VERSION) {
      if (card.hasPlayablePaperPrinting !== undefined && typeof card.hasPlayablePaperPrinting !== "boolean") return false;
      if (card.paperRarities !== undefined && (!stringArray(card.paperRarities) || card.paperRarities.some((rarity) => !RARITIES.has(rarity)))) return false;
      if (card.hasPlayablePaperPrinting === false && card.paperRarities?.length) return false;
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
    && index.requiresCompatibilityVerification !== true
    && !(index.failedSetCount > 0 || index.source?.mtgjsonMeta?.failedSetCount > 0)
    && index.rarityHistoryComplete === true
    && card.hasPlayablePaperPrinting === true
    && Array.isArray(card.paperRarities)
    && card.paperRarities.length > 0
    && card.paperRarities.every((rarity) => RARITIES.has(rarity));
}

export type ResolutionIndexReadiness = {
  schemaVersion: number | null;
  expectedSchemaVersion: number;
  rarityHistoryComplete: boolean | null;
  generatedAt: string | null;
  failedSetCount: number | null;
  compatibilityMode: boolean;
  manifestSchemaVersion: number | null;
  schemaMismatch: boolean;
};

/** Only release metadata is returned; source URLs and provider payloads never leave this helper. */
export function resolutionIndexReadiness(value: unknown): ResolutionIndexReadiness {
  const data = isRecord(value) ? value : {};
  const schemaVersion = Number.isInteger(data.version) && data.version > 0 ? data.version : null;
  const rarityHistoryComplete = typeof data.rarityHistoryComplete === "boolean" ? data.rarityHistoryComplete : null;
  const rawFailedSets = data.failedSetCount ?? data.source?.mtgjsonMeta?.failedSetCount;
  const failedSetCount = Number.isInteger(rawFailedSets) && rawFailedSets >= 0 ? rawFailedSets : null;
  const timestamp = typeof data.generatedAt === "string" && /^\d{4}-\d{2}-\d{2}T/.test(data.generatedAt) ? Date.parse(data.generatedAt) : NaN;
  const generatedAt = Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  const manifestSchemaVersion = Number.isInteger(data.manifestSchemaVersion) && data.manifestSchemaVersion > 0 ? data.manifestSchemaVersion : null;
  const schemaMismatch = data.manifestSchemaMismatch === true;
  return {
    schemaVersion, expectedSchemaVersion: MTGJSON_RESOLUTION_INDEX_VERSION,
    rarityHistoryComplete, generatedAt, failedSetCount, manifestSchemaVersion, schemaMismatch,
    compatibilityMode: data.requiresCompatibilityVerification === true || schemaMismatch || schemaVersion !== MTGJSON_RESOLUTION_INDEX_VERSION || rarityHistoryComplete !== true || (failedSetCount !== null && failedSetCount > 0),
  };
}

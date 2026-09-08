import { put } from "@vercel/blob";
import { strFromU8, unzipSync } from "fflate";
import { MTGJSON_RESOLUTION_INDEX_VERSION } from "../src/mtgjson-resolution-index.js";

const DEFAULT_SET_LIST_URL = "https://mtgjson.com/api/v5/SetList.json.zip";
const DEFAULT_SET_FILE_BASE_URL = "https://mtgjson.com/api/v5";
const INDEX_PATHNAME = "mtgjson/card-index-latest.json";
const MANIFEST_PATHNAME = "mtgjson/card-index-manifest.json";
const INDEX_VERSION = MTGJSON_RESOLUTION_INDEX_VERSION;
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,OPTIONS",
  "access-control-allow-headers": "authorization,content-type",
};

type MtgjsonRecord = Record<string, any>;

type MtgjsonPayload = {
  meta?: Record<string, any>;
  data?: any;
};

type IndexedCard = {
  name: string;
  asciiName: string;
  colorIdentity: string[];
  layout: string;
  printings: string[];
  scryfallOracleId: string;
  subtypes: string[];
  supertypes: string[];
  rarities: string[];
  nonSecretRarities: string[];
  hasPlayablePaperPrinting: boolean;
  paperRarities: string[];
  // Construction-only pools must stay separate until every set has been merged.
  _eligiblePaperRarities?: string[];
  _fallbackPaperRarities?: string[];
  _hasEligiblePaperPrinting?: boolean;
  _hasUnknownEligibleRarity?: boolean;
  type: string;
  types: string[];
};

type CardIndex = {
  version: number;
  generatedAt: string;
  rarityHistoryComplete: boolean;
  source: {
    name: string;
    url: string;
    downloadedAt: string;
    mtgjsonMeta: Record<string, any>;
  };
  counts: {
    cards: number;
    aliases: number;
    ambiguousAliases: number;
  };
  cards: Record<string, IndexedCard>;
  aliases: Record<string, string>;
  ambiguousAliases: Record<string, string[]>;
};

function env(name: string, fallback = "") {
  return process.env[name] || fallback;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      ...CORS_HEADERS,
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
}

function normalizeName(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w/ ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactName(value: string) {
  return normalizeName(value).replace(/\s+/g, "");
}

function uniqueStrings(values: unknown[]) {
  return Array.from(new Set(
    values
      .flat()
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .map((value) => value.trim()),
  )).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() || "";
}

function firstIdentifier(records: MtgjsonRecord[], key: string) {
  return firstString(...records.map((record) => record?.identifiers?.[key]));
}

function normalizeMtgjsonRarity(value: unknown) {
  const rarity = String(value || "").trim().toLowerCase();
  if (rarity === "mythic rare") return "mythic";
  return ["common", "uncommon", "rare", "mythic"].includes(rarity) ? rarity : "";
}

function isPlayablePaperPrinting(record: MtgjsonRecord) {
  const availability = Array.isArray(record.availability) ? record.availability.map((value) => String(value).toLowerCase()) : [];
  const setType = String(record.setType || "").toLowerCase();
  const type = firstString(record.type, Array.isArray(record.types) ? record.types.join(" ") : "");
  return availability.includes("paper")
    && !record.isOnlineOnly
    && !record.setIsOnlineOnly
    && !record.isRebalanced
    && Boolean(setType && type)
    && setType !== "memorabilia"
    && setType !== "token"
    && !/\b(Card|Emblem|Token)\b/i.test(type)
    && !/^(token|double_faced_token|emblem|art_series)$/i.test(String(record.layout || ""));
}

function isExcludedRarityPrinting(record: MtgjsonRecord) {
  const setCode = String(record.setCode || "").toUpperCase();
  const setName = String(record.setName || "");
  const promoTypes = Array.isArray(record.promoTypes) ? record.promoTypes.map((value) => String(value).toLowerCase()) : [];
  return /^SL[DUPC]?$/.test(setCode)
    || setCode === "MPR"
    || /\b(secret\s+lair|player\s+rewards?)\b/i.test(setName)
    || promoTypes.some((value) => /secret\s*lair|player\s*rewards/.test(value));
}

function isRegularRarityPrint(record: MtgjsonRecord) {
  return isPlayablePaperPrinting(record)
    && !isExcludedRarityPrinting(record)
    && (String(record.setType || "").toLowerCase() === "commander"
      || (Array.isArray(record.boosterTypes) && record.boosterTypes.length > 0));
}

function isFallbackRarityPrint(record: MtgjsonRecord) {
  return isPlayablePaperPrinting(record)
    && !isExcludedRarityPrinting(record)
    && String(record.setType || "").toLowerCase() !== "promo";
}

function rarityValues(records: MtgjsonRecord[]) {
  return uniqueStrings(records.map((record) => normalizeMtgjsonRarity(record.rarity)).filter(Boolean));
}

function supportsBoosterEvidence(meta: Record<string, any> = {}) {
  const version = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(meta.version || ""));
  return Boolean(version && (Number(version[1]) > 5
    || (Number(version[1]) === 5 && (Number(version[2]) > 2
      || (Number(version[2]) === 2 && Number(version[3]) >= 1)))));
}

function cardFromMtgjsonRecords(dataName: string, records: MtgjsonRecord[]): IndexedCard {
  const usableRecords = records.filter(Boolean);
  const primary = usableRecords.find((record) => normalizeName(record.name || "") === normalizeName(dataName))
    || usableRecords[0]
    || {};
  const rarities = rarityValues(usableRecords);
  const eligiblePaperPrints = usableRecords.filter(isRegularRarityPrint);
  const regularRarities = rarityValues(eligiblePaperPrints);
  const fallbackRarities = rarityValues(usableRecords.filter(isFallbackRarityPrint));
  const paperRarities = regularRarities.length ? regularRarities : fallbackRarities;

  return {
    name: firstString(primary.name, dataName),
    asciiName: firstString(primary.asciiName),
    colorIdentity: uniqueStrings(usableRecords.map((record) => record.colorIdentity || [])),
    layout: firstString(primary.layout),
    printings: uniqueStrings(usableRecords.map((record) => record.printings || [])),
    scryfallOracleId: firstIdentifier(usableRecords, "scryfallOracleId"),
    subtypes: uniqueStrings(usableRecords.map((record) => record.subtypes || [])),
    supertypes: uniqueStrings(usableRecords.map((record) => record.supertypes || [])),
    rarities,
    nonSecretRarities: paperRarities,
    hasPlayablePaperPrinting: usableRecords.some(isPlayablePaperPrinting),
    paperRarities,
    _eligiblePaperRarities: regularRarities,
    _fallbackPaperRarities: fallbackRarities,
    _hasEligiblePaperPrinting: eligiblePaperPrints.length > 0,
    _hasUnknownEligibleRarity: eligiblePaperPrints.some((record) => !normalizeMtgjsonRarity(record.rarity)),
    type: firstString(primary.type),
    types: uniqueStrings(usableRecords.map((record) => record.types || [])),
  };
}

function addAlias(
  aliases: Record<string, string>,
  ambiguousAliases: Record<string, string[]>,
  alias: string,
  cardKey: string,
) {
  const normalizedAlias = normalizeName(alias);
  const compactAlias = compactName(alias);

  [normalizedAlias, compactAlias].forEach((key) => {
    if (!key) return;

    if (ambiguousAliases[key]) {
      delete aliases[key];
      ambiguousAliases[key] = uniqueStrings([...ambiguousAliases[key], cardKey]);
      return;
    }
    const existing = aliases[key];
    if (!existing) {
      if (!ambiguousAliases[key]?.includes(cardKey)) {
        aliases[key] = cardKey;
      }
      return;
    }

    if (existing === cardKey) return;

    delete aliases[key];
    ambiguousAliases[key] = Array.from(new Set([...(ambiguousAliases[key] || []), existing, cardKey]))
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  });
}

function sourceName(sourceUrl: string) {
  if (/setlist/i.test(sourceUrl)) return "MTGJSON Set Files";
  if (/allprintings/i.test(sourceUrl)) return "MTGJSON AllPrintings";
  if (/atomiccards/i.test(sourceUrl)) return "MTGJSON AtomicCards";
  return "MTGJSON";
}

function groupedRecordsFromPayload(payload: MtgjsonPayload) {
  const grouped = new Map<string, { dataName: string; records: MtgjsonRecord[] }>();
  const data = payload.data || {};

  function addSetCards(set: Record<string, any>, fallbackCode: string) {
    const setCode = firstString(set.code, fallbackCode);
    const setType = firstString(set.type);
    const cards = Array.isArray(set.cards) ? set.cards : [];

    cards.forEach((record) => {
      const recordName = firstString(record?.name, record?.faceName);
      const cardKey = normalizeName(recordName);
      if (!cardKey) return;

      const existing = grouped.get(cardKey) || { dataName: recordName, records: [] };
      existing.records.push({
        ...record,
        setCode: firstString(record.setCode, setCode),
        setType: firstString(record.setType, setType),
        setName: firstString(set.name, record.setName),
        setIsOnlineOnly: Boolean(set.isOnlineOnly || record.setIsOnlineOnly),
      });
      grouped.set(cardKey, existing);
    });
  }

  if (!Array.isArray(data) && Array.isArray(data.cards)) {
    addSetCards(data, firstString(data.code));
    return grouped;
  }

  Object.entries(data).forEach(([dataName, value]) => {
    if (Array.isArray(value)) {
      if (!value.length) return;
      const cardKey = normalizeName(dataName);
      if (!cardKey) return;
      grouped.set(cardKey, { dataName, records: value });
      return;
    }

    const set = (value || {}) as Record<string, any>;
    addSetCards(set, dataName);
  });

  return grouped;
}

export function buildCardIndexFromMtgjsonPayload(payload: MtgjsonPayload, sourceUrl = DEFAULT_SET_LIST_URL, deferFinalization = false): CardIndex {
  const generatedAt = new Date().toISOString();
  const cards: Record<string, IndexedCard> = {};
  const aliases: Record<string, string> = {};
  const ambiguousAliases: Record<string, string[]> = {};
  const grouped = groupedRecordsFromPayload(payload);

  grouped.forEach(({ dataName, records }) => {
    const card = cardFromMtgjsonRecords(dataName, records);
    const cardKey = normalizeName(card.name || dataName);
    if (!cardKey) return;

    cards[cardKey] = card;

    [
      dataName,
      card.name,
      card.asciiName,
      ...records.map((record) => record.name),
      ...records.map((record) => record.asciiName),
      ...records.map((record) => record.faceName),
    ].forEach((alias) => {
      if (typeof alias === "string") addAlias(aliases, ambiguousAliases, alias, cardKey);
    });
  });

  const index: CardIndex = {
    version: INDEX_VERSION,
    generatedAt,
    // A lone set and AtomicCards cannot establish a complete rarity history.
    rarityHistoryComplete: /allprintings/i.test(sourceUrl) && supportsBoosterEvidence(payload.meta),
    source: {
      name: sourceName(sourceUrl),
      url: sourceUrl,
      downloadedAt: generatedAt,
      mtgjsonMeta: payload.meta || {},
    },
    counts: {
      cards: Object.keys(cards).length,
      aliases: Object.keys(aliases).length,
      ambiguousAliases: Object.keys(ambiguousAliases).length,
    },
    cards,
    aliases,
    ambiguousAliases,
  };
  return deferFinalization ? index : finalizeCardIndex(index);
}

function emptyCardIndex(sourceUrl: string, meta: Record<string, any> = {}): CardIndex {
  const generatedAt = new Date().toISOString();
  return {
    version: INDEX_VERSION,
    generatedAt,
    rarityHistoryComplete: false,
    source: {
      name: sourceName(sourceUrl),
      url: sourceUrl,
      downloadedAt: generatedAt,
      mtgjsonMeta: meta,
    },
    counts: {
      cards: 0,
      aliases: 0,
      ambiguousAliases: 0,
    },
    cards: {},
    aliases: {},
    ambiguousAliases: {},
  };
}

function mergeIndexedCard(existing: IndexedCard, incoming: IndexedCard): IndexedCard {
  return {
    name: firstString(existing.name, incoming.name),
    asciiName: firstString(existing.asciiName, incoming.asciiName),
    colorIdentity: uniqueStrings([existing.colorIdentity, incoming.colorIdentity]),
    layout: firstString(existing.layout, incoming.layout),
    printings: uniqueStrings([existing.printings, incoming.printings]),
    scryfallOracleId: firstString(existing.scryfallOracleId, incoming.scryfallOracleId),
    subtypes: uniqueStrings([existing.subtypes, incoming.subtypes]),
    supertypes: uniqueStrings([existing.supertypes, incoming.supertypes]),
    rarities: uniqueStrings([existing.rarities, incoming.rarities]),
    nonSecretRarities: uniqueStrings([existing.nonSecretRarities, incoming.nonSecretRarities]),
    hasPlayablePaperPrinting: existing.hasPlayablePaperPrinting || incoming.hasPlayablePaperPrinting,
    paperRarities: uniqueStrings([existing.paperRarities, incoming.paperRarities]),
    _eligiblePaperRarities: uniqueStrings([existing._eligiblePaperRarities || [], incoming._eligiblePaperRarities || []]),
    _fallbackPaperRarities: uniqueStrings([existing._fallbackPaperRarities || [], incoming._fallbackPaperRarities || []]),
    _hasEligiblePaperPrinting: Boolean(existing._hasEligiblePaperPrinting || incoming._hasEligiblePaperPrinting),
    _hasUnknownEligibleRarity: Boolean(existing._hasUnknownEligibleRarity || incoming._hasUnknownEligibleRarity),
    type: firstString(existing.type, incoming.type),
    types: uniqueStrings([existing.types, incoming.types]),
  };
}

function mergeAmbiguousAlias(target: CardIndex, alias: string, cardKeys: string[]) {
  const normalizedAlias = normalizeName(alias);
  if (!normalizedAlias) return;

  const existing = target.aliases[normalizedAlias];
  const merged = Array.from(new Set([
    ...(target.ambiguousAliases[normalizedAlias] || []),
    ...(existing ? [existing] : []),
    ...cardKeys,
  ])).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  delete target.aliases[normalizedAlias];
  target.ambiguousAliases[normalizedAlias] = merged;
}

function mergeCardIndex(target: CardIndex, incoming: CardIndex) {
  Object.entries(incoming.cards).forEach(([cardKey, card]) => {
    target.cards[cardKey] = target.cards[cardKey]
      ? mergeIndexedCard(target.cards[cardKey], card)
      : card;
  });

  Object.entries(incoming.aliases).forEach(([alias, cardKey]) => {
    addAlias(target.aliases, target.ambiguousAliases, alias, cardKey);
  });

  Object.entries(incoming.ambiguousAliases).forEach(([alias, cardKeys]) => {
    mergeAmbiguousAlias(target, alias, cardKeys);
  });
}

function finalizeCardIndex(index: CardIndex) {
  Object.values(index.cards).forEach((card) => {
    card.paperRarities = card._hasUnknownEligibleRarity ? []
      : card._hasEligiblePaperPrinting ? card._eligiblePaperRarities || []
        : card._fallbackPaperRarities || [];
    card.nonSecretRarities = card.paperRarities;
    delete card._eligiblePaperRarities;
    delete card._fallbackPaperRarities;
    delete card._hasEligiblePaperPrinting;
    delete card._hasUnknownEligibleRarity;
  });

  index.counts = {
    cards: Object.keys(index.cards).length,
    aliases: Object.keys(index.aliases).length,
    ambiguousAliases: Object.keys(index.ambiguousAliases).length,
  };

  return index;
}

function authorizeRefresh(request: Request) {
  const secret = env("MTGJSON_REFRESH_SECRET", env("CRON_SECRET"));
  if (!secret) {
    return {
      ok: false,
      status: 500,
      error: "MTGJSON_REFRESH_SECRET or CRON_SECRET is not configured.",
    };
  }

  const requestUrl = new URL(request.url);
  const authHeader = request.headers.get("authorization") || "";
  const querySecret = requestUrl.searchParams.get("secret") || "";
  const authorized = authHeader === `Bearer ${secret}` || querySecret === secret;

  return authorized
    ? { ok: true, status: 200, error: "" }
    : { ok: false, status: 401, error: "Unauthorized." };
}

async function fetchMtgjsonPayload(sourceUrl: string): Promise<MtgjsonPayload> {
  const response = await fetch(sourceUrl, {
    headers: {
      accept: "application/zip,application/json;q=0.8,*/*;q=0.5",
      "user-agent": "rrg-pull-list-formatter/mtgjson-index-refresh",
    },
  });

  if (!response.ok) {
    throw new Error(`MTGJSON download failed (${response.status}).`);
  }

  const zipBytes = new Uint8Array(await response.arrayBuffer());
  const entries = unzipSync(zipBytes);
  const jsonEntryName = Object.keys(entries).find((name) => /(?:^|\/)[^/]+\.json$/i.test(name));
  if (!jsonEntryName) {
    throw new Error("No JSON file was found in the MTGJSON archive.");
  }

  return JSON.parse(strFromU8(entries[jsonEntryName]));
}

function setListEntries(payload: MtgjsonPayload) {
  const data = payload.data;
  const rawSets = Array.isArray(data) ? data : Object.values(data || {});
  return rawSets
    .filter((set): set is Record<string, any> => Boolean(set && typeof set === "object"))
    .map((set) => ({
      code: firstString(set.code, set.key).toUpperCase(),
      isOnlineOnly: Boolean(set.isOnlineOnly),
    }))
    .filter((set) => set.code && !set.isOnlineOnly);
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

export async function buildCardIndexFromSetFiles(setListUrl: string, setFileBaseUrl: string, setLimit = 0) {
  const setListPayload = await fetchMtgjsonPayload(setListUrl);
  const sets = setListEntries(setListPayload);
  const selectedSets = setLimit > 0 ? sets.slice(0, setLimit) : sets;
  const fetchConcurrency = Math.max(1, Number(env("MTGJSON_SET_FETCH_CONCURRENCY", "8")) || 8);
  const setBatches = chunk(selectedSets, fetchConcurrency);
  const failures: { code: string; error: string }[] = [];
  let completeSourceEvidence = supportsBoosterEvidence(setListPayload.meta);
  const index = emptyCardIndex(setListUrl, {
    ...(setListPayload.meta || {}),
    setFileBaseUrl,
    selectedSetCount: selectedSets.length,
    totalSetCount: sets.length,
  });

  for (const batch of setBatches) {
    const payloads = await Promise.all(batch.map(async (set) => {
      const sourceUrl = `${setFileBaseUrl.replace(/\/$/, "")}/${encodeURIComponent(set.code)}.json.zip`;
      try {
        return {
          payload: await fetchMtgjsonPayload(sourceUrl),
          sourceUrl,
        };
      } catch (error) {
        failures.push({
          code: set.code,
          error: error instanceof Error ? error.message : "Unexpected error.",
        });
        return null;
      }
    }));

    payloads.filter(Boolean).forEach((entry) => {
      completeSourceEvidence &&= supportsBoosterEvidence(entry!.payload.meta);
      const setIndex = buildCardIndexFromMtgjsonPayload(entry!.payload, entry!.sourceUrl, true);
      mergeCardIndex(index, setIndex);
    });
  }

  index.source.mtgjsonMeta = {
    ...index.source.mtgjsonMeta,
    failedSetCount: failures.length,
    failedSets: failures.slice(0, 25),
  };
  index.rarityHistoryComplete = completeSourceEvidence
    && failures.length === 0
    && selectedSets.length > 0
    && selectedSets.length === sets.length;

  return finalizeCardIndex(index);
}

async function uploadJson(pathname: string, body: string, cacheControlMaxAge: number) {
  return put(pathname, body, {
    access: "public",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge,
    contentType: "application/json; charset=utf-8",
    multipart: body.length > 5 * 1024 * 1024,
    token: env("BLOB_READ_WRITE_TOKEN") || undefined,
  });
}

export async function GET(request: Request) {
  const auth = authorizeRefresh(request);
  if (!auth.ok) return jsonResponse({ error: auth.error }, auth.status);

  const requestUrl = new URL(request.url);
  const dryRun = requestUrl.searchParams.get("dryRun") === "1";
  const setListUrl = env("MTGJSON_SET_LIST_URL", DEFAULT_SET_LIST_URL);
  const setFileBaseUrl = env("MTGJSON_SET_FILE_BASE_URL", DEFAULT_SET_FILE_BASE_URL);
  const setLimit = Number(requestUrl.searchParams.get("limit") || "0") || 0;

  try {
    const index = await buildCardIndexFromSetFiles(setListUrl, setFileBaseUrl, setLimit);
    const indexJson = JSON.stringify(index);
    const builtDate = index.generatedAt.slice(0, 10);
    const versionedPathname = `mtgjson/card-index-${builtDate}.json`;

    if (dryRun) {
      return jsonResponse({
        ok: true,
        dryRun: true,
        bytes: Buffer.byteLength(indexJson, "utf8"),
        counts: index.counts,
        generatedAt: index.generatedAt,
        sourceMeta: index.source.mtgjsonMeta,
      });
    }

    const [latestBlob, versionedBlob] = await Promise.all([
      uploadJson(INDEX_PATHNAME, indexJson, 60),
      uploadJson(versionedPathname, indexJson, 24 * 60 * 60),
    ]);

    const manifest = {
      version: INDEX_VERSION,
      rarityHistoryComplete: index.rarityHistoryComplete,
      generatedAt: index.generatedAt,
      failedSetCount: Number(index.source.mtgjsonMeta?.failedSetCount || 0),
      indexPathname: INDEX_PATHNAME,
      indexUrl: latestBlob.url,
      versionedPathname,
      versionedUrl: versionedBlob.url,
      bytes: Buffer.byteLength(indexJson, "utf8"),
      counts: index.counts,
      source: index.source,
    };

    const manifestBlob = await uploadJson(MANIFEST_PATHNAME, JSON.stringify(manifest, null, 2), 60);

    return jsonResponse({
      ok: true,
      manifestUrl: manifestBlob.url,
      ...manifest,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return jsonResponse({ error: message }, 500);
  }
}

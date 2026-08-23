import { put } from "@vercel/blob";
import { strFromU8, unzipSync } from "fflate";
import { foilTreatmentForRawPrinting, treatmentsForRawPrinting } from "../src/printing-normalization.js";

const DEFAULT_SET_LIST_URL = "https://mtgjson.com/api/v5/SetList.json.zip";
const DEFAULT_SET_FILE_BASE_URL = "https://mtgjson.com/api/v5";
const DEFAULT_PRICES_URL = "https://mtgjson.com/api/v5/AllPricesToday.json.zip";
const MANIFEST_PATHNAME = "mtgjson/pricing-index-manifest.json";
// v6 corrects provider-treatment semantics: frame era alone is not Retro.
const INDEX_VERSION = 6;
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,OPTIONS",
  "access-control-allow-headers": "authorization,content-type",
};

type MtgjsonRecord = Record<string, any>;
type MtgjsonPayload = { meta?: Record<string, any>; data?: any };
type PriceFinish = "normal" | "foil" | "etched";
type IndexedPrice = { value: number; source: string; currency?: string };
type IndexedPriceSource = { key: string; provider: string; listType: "retail" | "buylist"; currency: string };
type IndexedPrinting = {
  uuid: string;
  tcgplayerProductId?: string;
  tcgplayerEtchedProductId?: string;
  setCode: string;
  setName: string;
  keyruneCode: string;
  releaseDate: string;
  number: string;
  rarity: string;
  flavorName?: string;
  artist?: string;
  treatments: string[];
  foilTreatment: "standard" | "surge";
  finishes: PriceFinish[];
  prices: Partial<Record<PriceFinish, IndexedPrice>>;
  priceListings: Partial<Record<PriceFinish, Record<string, IndexedPrice>>>;
};
type PricingShard = {
  version: number;
  generatedAt: string;
  cards: Record<string, { name: string; printings: IndexedPrinting[] }>;
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
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export function normalizePricingName(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w/ ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function pricingShardKey(value: unknown) {
  const first = normalizePricingName(value).charAt(0);
  return /^[a-z0-9]$/.test(first) ? first : "_";
}

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() || "";
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean)
    : [];
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function authorizeRefresh(request: Request) {
  const secret = env("MTGJSON_REFRESH_SECRET", env("CRON_SECRET"));
  if (!secret) return { ok: false, status: 500, error: "MTGJSON_REFRESH_SECRET or CRON_SECRET is not configured." };

  const requestUrl = new URL(request.url);
  const authorized = request.headers.get("authorization") === `Bearer ${secret}`
    || requestUrl.searchParams.get("secret") === secret;
  return authorized
    ? { ok: true, status: 200, error: "" }
    : { ok: false, status: 401, error: "Unauthorized." };
}

async function fetchMtgjsonPayload(sourceUrl: string): Promise<MtgjsonPayload> {
  const response = await fetch(sourceUrl, {
    headers: {
      accept: "application/zip,application/json;q=0.8,*/*;q=0.5",
      "user-agent": "rrg-pull-list-formatter/mtgjson-pricing-refresh",
    },
  });
  if (!response.ok) throw new Error(`MTGJSON download failed (${response.status}) for ${sourceUrl}.`);

  const bytes = new Uint8Array(await response.arrayBuffer());
  const entries = unzipSync(bytes);
  const jsonEntryName = Object.keys(entries).find((name) => /(?:^|\/)[^/]+\.json$/i.test(name));
  if (!jsonEntryName) throw new Error("No JSON file was found in the MTGJSON archive.");
  return JSON.parse(strFromU8(entries[jsonEntryName]));
}

function setListEntries(payload: MtgjsonPayload) {
  const rawSets = Array.isArray(payload.data) ? payload.data : Object.values(payload.data || {});
  return rawSets
    .filter((set): set is MtgjsonRecord => Boolean(set && typeof set === "object"))
    .map((set) => ({
      code: firstString(set.code, set.key).toUpperCase(),
      name: firstString(set.name),
      keyruneCode: firstString(set.keyruneCode, set.code).toLowerCase(),
      releaseDate: firstString(set.releaseDate),
      isOnlineOnly: Boolean(set.isOnlineOnly),
      isForeignOnly: Boolean(set.isForeignOnly),
    }))
    .filter((set) => set.code && !set.isOnlineOnly && !set.isForeignOnly);
}

function latestHistoryValue(history: unknown) {
  if (!history || typeof history !== "object") return null;
  const entries = Object.entries(history as Record<string, unknown>)
    .filter(([, value]) => typeof value === "number" && Number.isFinite(value))
    .sort(([dateA], [dateB]) => dateB.localeCompare(dateA));
  return entries.length ? Number(entries[0][1]) : null;
}

export function pricesForUuid(priceRecord: MtgjsonRecord | undefined, finish: PriceFinish) {
  const listings: Record<string, IndexedPrice> = {};
  Object.entries(priceRecord?.paper || {}).forEach(([provider, rawPriceList]) => {
    const priceList = rawPriceList as MtgjsonRecord;
    const currency = firstString(priceList?.currency, "USD").toUpperCase();
    (["retail", "buylist"] as const).forEach((listType) => {
      const value = latestHistoryValue(priceList?.[listType]?.[finish]);
      if (value === null) return;
      const source = `${provider}:${listType}`;
      listings[source] = { value, source, currency };
    });
  });
  return listings;
}

export function priceForUuid(priceRecord: MtgjsonRecord | undefined, finish: PriceFinish): IndexedPrice | null {
  const listings = pricesForUuid(priceRecord, finish);
  return listings["tcgplayer:retail"] || listings["cardkingdom:retail"] || Object.values(listings)[0] || null;
}

function normalizeFinish(value: string): PriceFinish | "" {
  const normalized = value.toLowerCase().replace(/[^a-z]/g, "");
  if (normalized === "normal" || normalized === "nonfoil") return "normal";
  if (normalized === "foil") return "foil";
  if (normalized === "etched" || normalized === "etchedfoil") return "etched";
  return "";
}

export function treatmentsForCard(card: MtgjsonRecord) {
  return treatmentsForRawPrinting(card);
}

function finishesForCard(card: MtgjsonRecord, priceRecord: MtgjsonRecord | undefined) {
  const finishes = stringArray(card.finishes).map(normalizeFinish).filter((value): value is PriceFinish => Boolean(value));
  (["normal", "foil", "etched"] as PriceFinish[]).forEach((finish) => {
    const hasPrice = Object.values(priceRecord?.paper || {}).some((rawPriceList) => {
      const priceList = rawPriceList as MtgjsonRecord;
      return Boolean(priceList?.retail?.[finish] || priceList?.buylist?.[finish]);
    });
    if (hasPrice) finishes.push(finish);
  });
  return uniqueStrings(finishes) as PriceFinish[];
}

function isEnglishPaperCard(card: MtgjsonRecord) {
  const availability = stringArray(card.availability).map((value) => value.toLowerCase());
  const language = firstString(card.language).toLowerCase();
  return !card.isOnlineOnly
    && (!availability.length || availability.includes("paper"))
    && (!language || language === "english" || language === "en");
}

function addCardToShards(
  shards: Record<string, PricingShard>,
  card: MtgjsonRecord,
  set: { code: string; name: string; keyruneCode: string; releaseDate: string },
  pricesByUuid: Record<string, MtgjsonRecord>,
  generatedAt: string,
  priceSources: Map<string, IndexedPriceSource>,
) {
  if (!isEnglishPaperCard(card)) return false;
  const name = firstString(card.name, card.faceName);
  const cardKey = normalizePricingName(name);
  const uuid = firstString(card.uuid);
  if (!cardKey || !uuid) return false;

  const priceRecord = pricesByUuid[uuid];
  const finishes = finishesForCard(card, priceRecord);
  if (!finishes.length) finishes.push("normal");
  const prices: Partial<Record<PriceFinish, IndexedPrice>> = {};
  const priceListings: Partial<Record<PriceFinish, Record<string, IndexedPrice>>> = {};
  finishes.forEach((finish) => {
    const listings = pricesForUuid(priceRecord, finish);
    if (Object.keys(listings).length) priceListings[finish] = listings;
    Object.values(listings).forEach((listing) => {
      const [provider, rawListType] = listing.source.split(":");
      const listType = rawListType === "buylist" ? "buylist" : "retail";
      priceSources.set(listing.source, {
        key: listing.source,
        provider,
        listType,
        currency: listing.currency || "USD",
      });
    });
    const price = listings["tcgplayer:retail"] || listings["cardkingdom:retail"] || Object.values(listings)[0] || null;
    if (price) prices[finish] = price;
  });

  const shardName = pricingShardKey(name);
  const shard = shards[shardName] || { version: INDEX_VERSION, generatedAt, cards: {} };
  const indexedCard = shard.cards[cardKey] || { name, printings: [] };
  if (!indexedCard.printings.some((printing) => printing.uuid === uuid)) {
    indexedCard.printings.push({
      uuid,
      tcgplayerProductId: firstString(card.identifiers?.tcgplayerProductId),
      tcgplayerEtchedProductId: firstString(card.identifiers?.tcgplayerEtchedProductId),
      setCode: firstString(card.setCode, set.code).toUpperCase(),
      setName: set.name,
      keyruneCode: set.keyruneCode,
      releaseDate: firstString(card.originalReleaseDate, set.releaseDate),
      number: firstString(card.number),
      rarity: firstString(card.rarity),
      flavorName: firstString(card.flavorName),
      artist: firstString(card.artist),
      treatments: treatmentsForCard(card),
      foilTreatment: foilTreatmentForRawPrinting(card),
      finishes,
      prices,
      priceListings,
    });
  }
  shard.cards[cardKey] = indexedCard;
  shards[shardName] = shard;
  return true;
}

function chunk<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
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
  const limit = Math.max(0, Number(requestUrl.searchParams.get("limit") || "0") || 0);
  const setListUrl = env("MTGJSON_SET_LIST_URL", DEFAULT_SET_LIST_URL);
  const setFileBaseUrl = env("MTGJSON_SET_FILE_BASE_URL", DEFAULT_SET_FILE_BASE_URL);
  const pricesUrl = env("MTGJSON_PRICES_URL", DEFAULT_PRICES_URL);
  const generatedAt = new Date().toISOString();

  try {
    const [setListPayload, pricePayload] = await Promise.all([
      fetchMtgjsonPayload(setListUrl),
      fetchMtgjsonPayload(pricesUrl),
    ]);
    const allSets = setListEntries(setListPayload);
    const sets = limit ? allSets.slice(0, limit) : allSets;
    const pricesByUuid = pricePayload.data || {};
    const shards: Record<string, PricingShard> = {};
    const priceSources = new Map<string, IndexedPriceSource>();
    const failures: { code: string; error: string }[] = [];
    const concurrency = Math.max(1, Number(env("MTGJSON_PRICING_SET_FETCH_CONCURRENCY", "8")) || 8);
    let printingCount = 0;

    for (const batch of chunk(sets, concurrency)) {
      const payloads = await Promise.all(batch.map(async (set) => {
        const sourceUrl = `${setFileBaseUrl.replace(/\/$/, "")}/${encodeURIComponent(set.code)}.json.zip`;
        try {
          return { set, payload: await fetchMtgjsonPayload(sourceUrl) };
        } catch (error) {
          failures.push({ code: set.code, error: error instanceof Error ? error.message : "Unexpected error." });
          return null;
        }
      }));

      payloads.filter(Boolean).forEach((entry) => {
        const setData = entry!.payload.data || {};
        const set = {
          ...entry!.set,
          code: firstString(setData.code, entry!.set.code).toUpperCase(),
          name: firstString(setData.name, entry!.set.name),
          keyruneCode: firstString(setData.keyruneCode, entry!.set.keyruneCode).toLowerCase(),
          releaseDate: firstString(setData.releaseDate, entry!.set.releaseDate),
        };
        [...(Array.isArray(setData.cards) ? setData.cards : []), ...(Array.isArray(setData.tokens) ? setData.tokens : [])]
          .forEach((card) => {
            if (addCardToShards(shards, card, set, pricesByUuid, generatedAt, priceSources)) printingCount += 1;
          });
      });
    }

    Object.values(shards).forEach((shard) => {
      Object.values(shard.cards).forEach((card) => card.printings.sort((a, b) => (
        b.releaseDate.localeCompare(a.releaseDate)
          || a.setCode.localeCompare(b.setCode)
          || a.number.localeCompare(b.number, undefined, { numeric: true })
      )));
    });

    const shardJson = Object.fromEntries(Object.entries(shards).map(([key, shard]) => [key, JSON.stringify(shard)]));
    const bytes = Object.values(shardJson).reduce((sum, body) => sum + Buffer.byteLength(body, "utf8"), 0);
    const counts = {
      cards: Object.values(shards).reduce((sum, shard) => sum + Object.keys(shard.cards).length, 0),
      printings: printingCount,
      shards: Object.keys(shards).length,
      failedSets: failures.length,
    };

    if (dryRun) {
      return jsonResponse({
        ok: true,
        dryRun: true,
        generatedAt,
        bytes,
        counts,
        priceSources: Array.from(priceSources.values()),
        failedSets: failures.slice(0, 25),
      });
    }

    const uploaded = await Promise.all(Object.entries(shardJson).map(async ([key, body]) => {
      const pathname = `mtgjson/pricing-index-${key}.json`;
      const blob = await uploadJson(pathname, body, 60);
      return [key, { pathname, url: blob.url, bytes: Buffer.byteLength(body, "utf8") }] as const;
    }));

    const manifest = {
      version: INDEX_VERSION,
      generatedAt,
      counts,
      bytes,
      priceSources: Array.from(priceSources.values()).sort((a, b) => (
        ((a.provider === "tcgplayer" ? 0 : 1) - (b.provider === "tcgplayer" ? 0 : 1)
          || a.provider.localeCompare(b.provider))
          || (a.listType === "retail" ? -1 : 1)
      )),
      source: {
        setListUrl,
        setFileBaseUrl,
        pricesUrl,
        mtgjsonMeta: pricePayload.meta || {},
        failedSets: failures.slice(0, 25),
      },
      shards: Object.fromEntries(uploaded),
    };
    const manifestBlob = await uploadJson(MANIFEST_PATHNAME, JSON.stringify(manifest, null, 2), 60);
    return jsonResponse({ ok: true, manifestUrl: manifestBlob.url, ...manifest });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return jsonResponse({ error: message }, 500);
  }
}

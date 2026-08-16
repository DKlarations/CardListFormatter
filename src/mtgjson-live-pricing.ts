import { strFromU8, unzipSync } from "fflate";
import { pricingNameKey, type PricingFinish, type PricingPrinting, type PricingValue } from "./pricing";

const MTGJSON_API = "https://mtgjson.com/api/v5";
const PRICES_URL = `${MTGJSON_API}/AllPricesToday.json.zip`;

type MtgjsonRecord = Record<string, any>;
type MtgjsonPayload = { data?: any };

let pricesPromise: Promise<Record<string, MtgjsonRecord>> | null = null;
const setPromises = new Map<string, Promise<MtgjsonPayload>>();

function firstString(...values: unknown[]) {
  return values.find((value): value is string => typeof value === "string" && value.trim().length > 0)?.trim() || "";
}

function stringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean)
    : [];
}

function unzipJson(bytes: Uint8Array): MtgjsonPayload {
  const entries = unzipSync(bytes);
  const jsonEntryName = Object.keys(entries).find((name) => /(?:^|\/)[^/]+\.json$/i.test(name));
  if (!jsonEntryName) throw new Error("No JSON file was found in the MTGJSON archive.");
  return JSON.parse(strFromU8(entries[jsonEntryName]));
}

async function fetchMtgjsonZip(url: string) {
  const response = await fetch(url, { headers: { Accept: "application/zip,application/json;q=0.8" } });
  if (!response.ok) throw new Error(`MTGJSON download failed (${response.status}).`);
  return unzipJson(new Uint8Array(await response.arrayBuffer()));
}

function loadPrices() {
  if (!pricesPromise) {
    pricesPromise = fetchMtgjsonZip(PRICES_URL)
      .then((payload) => payload.data || {})
      .catch((error) => {
        pricesPromise = null;
        throw error;
      });
  }
  return pricesPromise;
}

function loadSet(setCode: string) {
  const normalizedCode = setCode.trim().toUpperCase();
  let promise = setPromises.get(normalizedCode);
  if (!promise) {
    promise = fetchMtgjsonZip(`${MTGJSON_API}/${encodeURIComponent(normalizedCode)}.json.zip`)
      .catch((error) => {
        setPromises.delete(normalizedCode);
        throw error;
      });
    setPromises.set(normalizedCode, promise);
  }
  return promise;
}

function latestHistoryValue(history: unknown) {
  if (!history || typeof history !== "object") return null;
  const entries = Object.entries(history as Record<string, unknown>)
    .filter(([, value]) => typeof value === "number" && Number.isFinite(value))
    .sort(([dateA], [dateB]) => dateB.localeCompare(dateA));
  return entries.length ? Number(entries[0][1]) : null;
}

function pricesForUuid(priceRecord: MtgjsonRecord | undefined, finish: PricingFinish) {
  const listings: Record<string, PricingValue> = {};
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

function normalizeFinish(value: string): PricingFinish | "" {
  const normalized = value.toLowerCase().replace(/[^a-z]/g, "");
  if (normalized === "normal" || normalized === "nonfoil") return "normal";
  if (normalized === "foil") return "foil";
  if (normalized === "etched" || normalized === "etchedfoil") return "etched";
  return "";
}

function treatmentsForCard(card: MtgjsonRecord) {
  const treatments: string[] = [];
  const effects = new Set([
    ...stringArray(card.frameEffects),
    ...stringArray(card.promoTypes),
  ].map((value) => value.toLowerCase().replace(/[^a-z]/g, "")));

  if (card.isFullArt || effects.has("fullart")) treatments.push("full-art");
  if (effects.has("showcase")) treatments.push("showcase");
  if (String(card.borderColor || "").toLowerCase() === "borderless" || effects.has("borderless")) treatments.push("borderless");
  if (effects.has("extendedart")) treatments.push("extended-art");
  if (effects.has("retroframe") || effects.has("oldframe")) treatments.push("retro");
  return treatments.length ? Array.from(new Set(treatments)) : ["standard"];
}

function isEnglishPaperCard(card: MtgjsonRecord) {
  const availability = stringArray(card.availability).map((value) => value.toLowerCase());
  const language = firstString(card.language).toLowerCase();
  return !card.isOnlineOnly
    && (!availability.length || availability.includes("paper"))
    && (!language || language === "english" || language === "en");
}

function printingsForCard(
  cardName: string,
  setPayload: MtgjsonPayload,
  pricesByUuid: Record<string, MtgjsonRecord>,
) {
  const setData = setPayload.data || {};
  const expectedName = pricingNameKey(cardName);
  const cards = [
    ...(Array.isArray(setData.cards) ? setData.cards : []),
    ...(Array.isArray(setData.tokens) ? setData.tokens : []),
  ] as MtgjsonRecord[];

  return cards
    .filter(isEnglishPaperCard)
    .filter((card) => pricingNameKey(firstString(card.name, card.faceName)) === expectedName)
    .map((card): PricingPrinting | null => {
      const uuid = firstString(card.uuid);
      if (!uuid) return null;
      const priceRecord = pricesByUuid[uuid];
      const finishes = Array.from(new Set([
        ...stringArray(card.finishes).map(normalizeFinish).filter((finish): finish is PricingFinish => Boolean(finish)),
        ...(["normal", "foil", "etched"] as PricingFinish[]).filter((finish) => (
          Object.values(priceRecord?.paper || {}).some((rawPriceList) => {
            const priceList = rawPriceList as MtgjsonRecord;
            return Boolean(priceList?.retail?.[finish] || priceList?.buylist?.[finish]);
          })
        )),
      ]));
      if (!finishes.length) finishes.push("normal");
      const prices: Partial<Record<PricingFinish, PricingValue>> = {};
      const priceListings: PricingPrinting["priceListings"] = {};
      finishes.forEach((finish) => {
        const listings = pricesForUuid(priceRecord, finish);
        if (Object.keys(listings).length) priceListings[finish] = listings;
        const price = listings["tcgplayer:retail"] || listings["cardkingdom:retail"] || Object.values(listings)[0] || null;
        if (price) prices[finish] = price;
      });

      return {
        uuid,
        tcgplayerProductId: firstString(card.identifiers?.tcgplayerProductId),
        tcgplayerEtchedProductId: firstString(card.identifiers?.tcgplayerEtchedProductId),
        setCode: firstString(card.setCode, setData.code).toUpperCase(),
        setName: firstString(setData.name, card.setCode),
        keyruneCode: firstString(setData.keyruneCode, setData.code).toLowerCase(),
        releaseDate: firstString(card.originalReleaseDate, setData.releaseDate),
        number: firstString(card.number),
        rarity: firstString(card.rarity),
        treatments: treatmentsForCard(card),
        finishes,
        prices,
        priceListings,
      };
    })
    .filter((printing): printing is PricingPrinting => Boolean(printing));
}

export async function loadLiveMtgjsonPrintings(cardName: string, setCode: string) {
  const [setPayload, pricesByUuid] = await Promise.all([loadSet(setCode), loadPrices()]);
  return printingsForCard(cardName, setPayload, pricesByUuid);
}

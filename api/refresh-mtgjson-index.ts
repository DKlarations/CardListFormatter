import { put } from "@vercel/blob";
import { strFromU8, unzipSync } from "fflate";

const DEFAULT_ATOMIC_CARDS_URL = "https://mtgjson.com/api/v5/AtomicCards.json.zip";
const INDEX_PATHNAME = "mtgjson/card-index-latest.json";
const MANIFEST_PATHNAME = "mtgjson/card-index-manifest.json";
const INDEX_VERSION = 1;

type AtomicRecord = Record<string, any>;

type AtomicPayload = {
  meta?: Record<string, any>;
  data?: Record<string, AtomicRecord[]>;
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
  type: string;
  types: string[];
};

type CardIndex = {
  version: number;
  generatedAt: string;
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
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
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

function firstIdentifier(records: AtomicRecord[], key: string) {
  return firstString(...records.map((record) => record?.identifiers?.[key]));
}

function cardFromAtomicRecords(dataName: string, records: AtomicRecord[]): IndexedCard {
  const usableRecords = records.filter(Boolean);
  const primary = usableRecords.find((record) => normalizeName(record.name || "") === normalizeName(dataName))
    || usableRecords[0]
    || {};

  return {
    name: firstString(primary.name, dataName),
    asciiName: firstString(primary.asciiName),
    colorIdentity: uniqueStrings(usableRecords.map((record) => record.colorIdentity || [])),
    layout: firstString(primary.layout),
    printings: uniqueStrings(usableRecords.map((record) => record.printings || [])),
    scryfallOracleId: firstIdentifier(usableRecords, "scryfallOracleId"),
    subtypes: uniqueStrings(usableRecords.map((record) => record.subtypes || [])),
    supertypes: uniqueStrings(usableRecords.map((record) => record.supertypes || [])),
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

export function buildCardIndexFromAtomicPayload(payload: AtomicPayload, sourceUrl = DEFAULT_ATOMIC_CARDS_URL): CardIndex {
  const generatedAt = new Date().toISOString();
  const cards: Record<string, IndexedCard> = {};
  const aliases: Record<string, string> = {};
  const ambiguousAliases: Record<string, string[]> = {};
  const data = payload.data || {};

  Object.entries(data).forEach(([dataName, records]) => {
    if (!Array.isArray(records) || !records.length) return;

    const card = cardFromAtomicRecords(dataName, records);
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

  return {
    version: INDEX_VERSION,
    generatedAt,
    source: {
      name: "MTGJSON AtomicCards",
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

async function fetchAtomicPayload(sourceUrl: string): Promise<AtomicPayload> {
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
  const atomicEntryName = Object.keys(entries).find((name) => /(?:^|\/)AtomicCards\.json$/i.test(name));
  if (!atomicEntryName) {
    throw new Error("AtomicCards.json was not found in the MTGJSON archive.");
  }

  return JSON.parse(strFromU8(entries[atomicEntryName]));
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
  const sourceUrl = env("MTGJSON_ATOMIC_CARDS_URL", DEFAULT_ATOMIC_CARDS_URL);

  try {
    const payload = await fetchAtomicPayload(sourceUrl);
    const index = buildCardIndexFromAtomicPayload(payload, sourceUrl);
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
      generatedAt: index.generatedAt,
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

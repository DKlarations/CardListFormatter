import { Redis } from "@upstash/redis";

const LIST_TTL_SECONDS = 30 * 24 * 60 * 60;
const KEY_PREFIX = "formatted-list:";

type SavedFormattedList = {
  input?: string;
  output?: string;
  processedAt?: string;
  reliabilityNote?: string;
  customer?: {
    name?: string;
    contact?: string;
  };
  stats?: {
    resolvedCount?: number;
    needsReviewCount?: number;
    printFallbackCount?: number;
  };
  formatterItems?: Array<Record<string, unknown>>;
};

let redis: Redis | null = null;

function env(name: string, fallback = "") {
  return process.env[name] || fallback;
}

function getRedis() {
  if (!redis) {
    const url = restUrlFromEnv(env("UPSTASH_REDIS_REST_URL", env("lists_REDIS_URL")));
    const token = env("UPSTASH_REDIS_REST_TOKEN", env("lists_KV_REST_API_TOKEN"));

    if (!url || !token) {
      throw new Error("Redis environment variables are not configured.");
    }

    redis = new Redis({ url, token });
  }
  return redis;
}

function restUrlFromEnv(value: string) {
  if (!value.startsWith("rediss://")) return value;

  try {
    const parsed = new URL(value);
    return `https://${parsed.hostname}`;
  } catch {
    return value;
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function sanitizeId(value: string) {
  return value
    .replace(/[^A-Za-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function cleanText(value: unknown) {
  return typeof value === "string" ? value : "";
}

function cleanNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0;
}

export function normalizePayload(payload: any): SavedFormattedList {
  return {
    input: cleanText(payload?.input),
    output: cleanText(payload?.output),
    processedAt: cleanText(payload?.processedAt),
    reliabilityNote: cleanText(payload?.reliabilityNote),
    customer: {
      name: cleanText(payload?.customer?.name),
      contact: cleanText(payload?.customer?.contact),
    },
    stats: {
      resolvedCount: cleanNumber(payload?.stats?.resolvedCount),
      needsReviewCount: cleanNumber(payload?.stats?.needsReviewCount),
      printFallbackCount: cleanNumber(payload?.stats?.printFallbackCount),
    },
    formatterItems: Array.isArray(payload?.formatterItems)
      ? payload.formatterItems.filter((item: unknown) => Boolean(item) && typeof item === "object")
      : [],
  };
}

async function reserveId(baseId: string) {
  const safeBaseId = sanitizeId(baseId);
  if (!safeBaseId) throw new Error("A valid baseId is required.");

  const store = getRedis();
  for (let attempt = 1; attempt <= 50; attempt += 1) {
    const id = attempt === 1 ? safeBaseId : `${safeBaseId}-${attempt}`;
    const key = `${KEY_PREFIX}${id}`;
    const reserved = await store.set(key, {
      reservedAt: new Date().toISOString(),
    }, {
      ex: LIST_TTL_SECONDS,
      nx: true,
    });

    if (reserved) return { id, key };
  }

  throw new Error("Could not reserve a unique list ID.");
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const id = sanitizeId(requestUrl.searchParams.get("id") || "");

  if (!id) {
    return jsonResponse({ error: "Missing list ID." }, 400);
  }

  try {
    const saved = await getRedis().get<SavedFormattedList>(`${KEY_PREFIX}${id}`);
    if (!saved?.output) {
      return jsonResponse({ error: "Formatted list not found." }, 404);
    }

    return jsonResponse({ id, ...saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return jsonResponse({ error: message }, 500);
  }
}

export async function POST(request: Request) {
  const configuredSecret = env("FORMATTED_LIST_WRITE_SECRET");
  const providedSecret = request.headers.get("x-formatted-list-secret") || "";

  if (!configuredSecret || providedSecret !== configuredSecret) {
    return jsonResponse({ error: "Not found." }, 404);
  }

  try {
    const body = await request.json();
    const data = normalizePayload(body?.data);
    if (!data.input || !data.output) {
      return jsonResponse({ error: "Both input and output are required." }, 400);
    }

    const { id, key } = await reserveId(body?.baseId || "");
    const saved = {
      ...data,
      savedAt: new Date().toISOString(),
      expiresInSeconds: LIST_TTL_SECONDS,
    };

    await getRedis().set(key, saved, { ex: LIST_TTL_SECONDS });

    return jsonResponse({ id, expiresInSeconds: LIST_TTL_SECONDS }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return jsonResponse({ error: message }, 500);
  }
}

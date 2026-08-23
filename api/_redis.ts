import { Redis } from "@upstash/redis";
import { SAVED_PULL_LIST_TTL_SECONDS } from "../src/pull-list-job.js";

export { SAVED_PULL_LIST_TTL_SECONDS };

let redis: Redis | null = null;

type RedisEnvironment = Record<string, string | undefined>;

export type RedisConfig = {
  url: string;
  token: string;
};

export function restUrlFromEnv(value: string) {
  if (!value.startsWith("rediss://")) return value;
  try {
    const parsed = new URL(value);
    return `https://${parsed.hostname}`;
  } catch {
    return value;
  }
}

/**
 * Select a complete REST credential pair so an incomplete newer integration
 * cannot accidentally combine its URL or token with a legacy database.
 */
export function redisConfigFromEnv(envSource: RedisEnvironment = process.env): RedisConfig {
  const candidates = [
    {
      url: envSource.PULLSMITH_KV_REST_API_URL,
      token: envSource.PULLSMITH_KV_REST_API_TOKEN,
    },
    {
      url: envSource.UPSTASH_REDIS_REST_URL,
      token: envSource.UPSTASH_REDIS_REST_TOKEN,
    },
    {
      url: envSource.lists_REDIS_URL,
      token: envSource.lists_KV_REST_API_TOKEN,
    },
  ];

  for (const candidate of candidates) {
    if (candidate.url && candidate.token) {
      return { url: restUrlFromEnv(candidate.url), token: candidate.token };
    }
  }

  throw new Error(
    "Redis environment variables are not configured. Expected PULLSMITH_KV_REST_API_URL and PULLSMITH_KV_REST_API_TOKEN.",
  );
}

export function getRedis() {
  if (!redis) {
    redis = new Redis(redisConfigFromEnv());
  }
  return redis;
}

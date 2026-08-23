import { Redis } from "@upstash/redis";
import { SAVED_PULL_LIST_TTL_SECONDS } from "../src/pull-list-job";

export { SAVED_PULL_LIST_TTL_SECONDS };

let redis: Redis | null = null;

function env(name: string, fallback = "") {
  return process.env[name] || fallback;
}

export function restUrlFromEnv(value: string) {
  if (!value.startsWith("rediss://")) return value;
  try {
    const parsed = new URL(value);
    return `https://${parsed.hostname}`;
  } catch {
    return value;
  }
}

export function getRedis() {
  if (!redis) {
    const url = restUrlFromEnv(env("UPSTASH_REDIS_REST_URL", env("lists_REDIS_URL")));
    const token = env("UPSTASH_REDIS_REST_TOKEN", env("lists_KV_REST_API_TOKEN"));
    if (!url || !token) throw new Error("Redis environment variables are not configured.");
    redis = new Redis({ url, token });
  }
  return redis;
}

import assert from "node:assert/strict";
import test from "node:test";
import { importBundledModule } from "./test-module-bundle.mjs";

const redisModule = await importBundledModule("api/_redis.ts", "pullsmith-redis-config");

test("Pullsmith Redis REST credentials take precedence over compatibility pairs", () => {
  const config = redisModule.redisConfigFromEnv({
    PULLSMITH_KV_REST_API_URL: "https://pullsmith.example.upstash.io",
    PULLSMITH_KV_REST_API_TOKEN: "pullsmith-write-token",
    UPSTASH_REDIS_REST_URL: "https://older.example.upstash.io",
    UPSTASH_REDIS_REST_TOKEN: "older-token",
    lists_REDIS_URL: "rediss://legacy.example:6379",
    lists_KV_REST_API_TOKEN: "legacy-token",
  });

  assert.deepEqual(config, {
    url: "https://pullsmith.example.upstash.io",
    token: "pullsmith-write-token",
  });
});

test("standard Upstash and legacy lists credential pairs remain ordered fallbacks", () => {
  assert.deepEqual(redisModule.redisConfigFromEnv({
    UPSTASH_REDIS_REST_URL: "https://upstash.example",
    UPSTASH_REDIS_REST_TOKEN: "upstash-token",
    lists_REDIS_URL: "rediss://legacy.example:6379",
    lists_KV_REST_API_TOKEN: "legacy-token",
  }), {
    url: "https://upstash.example",
    token: "upstash-token",
  });

  assert.deepEqual(redisModule.redisConfigFromEnv({
    lists_REDIS_URL: "rediss://legacy.example:6379",
    lists_KV_REST_API_TOKEN: "legacy-token",
  }), {
    url: "https://legacy.example",
    token: "legacy-token",
  });
});

test("the Pullsmith read-only token is never used as a persistence credential", () => {
  assert.throws(
    () => redisModule.redisConfigFromEnv({
      PULLSMITH_KV_REST_API_URL: "https://pullsmith.example.upstash.io",
      PULLSMITH_KV_REST_API_READ_ONLY_TOKEN: "read-only-token",
    }),
    /Expected PULLSMITH_KV_REST_API_URL and PULLSMITH_KV_REST_API_TOKEN/,
  );
});

test("missing Redis configuration provides safe setup guidance", () => {
  assert.throws(
    () => redisModule.redisConfigFromEnv({}),
    /Redis environment variables are not configured\. Expected PULLSMITH_KV_REST_API_URL and PULLSMITH_KV_REST_API_TOKEN\./,
  );
});

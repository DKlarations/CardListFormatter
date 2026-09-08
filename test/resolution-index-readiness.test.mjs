import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { checkResolutionIndexManifest, expectedResolutionIndexVersion, fetchResolutionIndexReadiness, formatResolutionIndexReadiness } from "../tools/check-resolution-index-readiness.mjs";

const manifest = { version: 3, rarityHistoryComplete: true, generatedAt: "2026-09-08T00:00:00Z", failedSetCount: 0 };

test("release readiness requires exact current schema and every completeness field", async () => {
  assert.equal(await expectedResolutionIndexVersion(), 3);
  assert.equal(checkResolutionIndexManifest(manifest, 3).ready, true);
  for (const incomplete of [null, { ...manifest, version: 2 }, { ...manifest, version: 4 }, { ...manifest, rarityHistoryComplete: false }, { ...manifest, generatedAt: undefined }, { ...manifest, failedSetCount: undefined }, { ...manifest, failedSetCount: 1 }]) {
    const result = checkResolutionIndexManifest(incomplete, 3);
    assert.equal(result.ready, false);
    assert.match(formatResolutionIndexReadiness(result), /FAILED/);
    assert.match(formatResolutionIndexReadiness(result), /authorized full refresh/);
  }
});

test("readiness check makes one GET to the existing manifest route and never follows redirects", async () => {
  const calls = [];
  const result = await fetchResolutionIndexReadiness({ baseUrl: "https://formatter.test/base/", expectedVersion: 3, bypassSecret: "private-bypass", fetcher: async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify(manifest));
  } });
  assert.equal(result.ready, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://formatter.test/api/mtgjson-index");
  assert.equal(calls[0].options.method, "GET");
  assert.equal(calls[0].options.redirect, "error");
  assert.equal(calls[0].options.headers["x-vercel-protection-bypass"], "private-bypass");
  assert.doesNotMatch(formatResolutionIndexReadiness(result), /formatter\.test|private-bypass|https?:/);
});

test("readiness transport and malformed-body errors are sanitized and never retried", async () => {
  for (const provider of [() => new Response("blocked", { status: 403 }), () => new Response("bad JSON"), () => { throw new Error("Resolution-index readiness private https://signed.test/?token=secret"); }]) {
    let calls = 0;
    await assert.rejects(() => fetchResolutionIndexReadiness({ baseUrl: "https://formatter.test", expectedVersion: 3, fetcher: async () => { calls += 1; return provider(); } }), (error) => {
      assert.doesNotMatch(error.message, /private|signed|token|secret/);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("readiness refuses credential-bearing or unsafe targets before any request", async () => {
  for (const baseUrl of [undefined, "http://formatter.test", "https://user:secret@formatter.test", "https://formatter.test/?token=secret", "https://formatter.test/#private"]) {
    await assert.rejects(() => fetchResolutionIndexReadiness({ baseUrl, expectedVersion: 3, fetcher: async () => { assert.fail("No request expected"); } }), /FORMATTER_BASE_URL/);
  }
});

test("checked-in release check uses read-only permissions and existing refresh manifest exposes readiness", () => {
  const workflow = readFileSync(new URL("../.github/workflows/resolution-index-readiness.yml", import.meta.url), "utf8");
  assert.match(workflow, /deployment_status:/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /git merge-base --is-ancestor/);
  assert.doesNotMatch(workflow, /npm run once|refresh-mtgjson-index|CRON_SECRET|MTGJSON_REFRESH_SECRET|BLOB_READ_WRITE_TOKEN/);
  const builder = readFileSync(new URL("../api/refresh-mtgjson-index.ts", import.meta.url), "utf8");
  const publishedManifest = builder.slice(builder.indexOf("    const manifest = {"), builder.indexOf("    const manifestBlob ="));
  assert.match(publishedManifest, /rarityHistoryComplete: index\.rarityHistoryComplete/);
  assert.match(publishedManifest, /generatedAt: index\.generatedAt/);
  assert.match(publishedManifest, /failedSetCount:/);
});

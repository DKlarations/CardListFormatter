import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

class ReadinessError extends Error {}

export async function expectedResolutionIndexVersion() {
  const source = await readFile(new URL("../src/mtgjson-resolution-index.ts", import.meta.url), "utf8");
  const match = source.match(/export const MTGJSON_RESOLUTION_INDEX_VERSION = (\d+);/);
  if (!match) throw new Error("Cannot determine expected resolution-index schema from source.");
  return Number(match[1]);
}

export function checkResolutionIndexManifest(manifest, expectedVersion) {
  const data = manifest && typeof manifest === "object" && !Array.isArray(manifest) ? manifest : {};
  const version = Number.isInteger(data.version) && data.version > 0 ? data.version : null;
  const complete = data.rarityHistoryComplete === true;
  const timestamp = typeof data.generatedAt === "string" && /^\d{4}-\d{2}-\d{2}T/.test(data.generatedAt) ? Date.parse(data.generatedAt) : NaN;
  const generatedAt = Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
  const failedSetCount = Number.isInteger(data.failedSetCount) && data.failedSetCount >= 0 ? data.failedSetCount : null;
  const ready = version === expectedVersion && complete && generatedAt !== null && failedSetCount === 0;
  return { ready, expectedVersion, version, rarityHistoryComplete: complete, generatedAt, failedSetCount };
}

export function formatResolutionIndexReadiness(result) {
  return [
    `Resolution index readiness: ${result.ready ? "ready" : "FAILED"}`,
    `Schema: ${result.version ?? "unknown"}; expected: ${result.expectedVersion}`,
    `rarityHistoryComplete: ${result.rarityHistoryComplete}`,
    `generatedAt: ${result.generatedAt || "unknown"}`,
    `failedSetCount: ${result.failedSetCount ?? "unknown"}`,
    ...(!result.ready ? ["The deployed index is behind or incomplete. Clients remain in bounded compatibility mode. An authorized full refresh and verification are required."] : []),
  ].join("\n");
}

/** A single read-only manifest GET; never follows redirects or invokes a refresh route. */
export async function fetchResolutionIndexReadiness({ baseUrl, expectedVersion, bypassSecret, fetcher = fetch, timeoutMs = 10_000 }) {
  let base;
  try { base = new URL(baseUrl); } catch { throw new Error("FORMATTER_BASE_URL must be an absolute HTTPS application URL."); }
  if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) {
    throw new Error("FORMATTER_BASE_URL must be an HTTPS application URL without credentials, query, or fragment.");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(10_000, timeoutMs)));
  try {
    const headers = { Accept: "application/json" };
    if (bypassSecret) headers["x-vercel-protection-bypass"] = bypassSecret;
    const response = await fetcher(new URL("/api/mtgjson-index", base), { method: "GET", headers, redirect: "error", cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new ReadinessError(`Resolution-index readiness request failed with HTTP ${response.status}.`);
    let manifest;
    try { manifest = await response.json(); } catch { throw new ReadinessError("Resolution-index readiness returned malformed JSON."); }
    return checkResolutionIndexManifest(manifest, expectedVersion);
  } catch (error) {
    if (error instanceof ReadinessError) throw error;
    throw new Error(controller.signal.aborted ? "Resolution-index readiness request timed out." : "Resolution-index readiness request failed.");
  } finally {
    clearTimeout(timer);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await fetchResolutionIndexReadiness({
      baseUrl: process.env.FORMATTER_BASE_URL,
      bypassSecret: process.env.RESOLUTION_INDEX_READINESS_BYPASS_SECRET,
      expectedVersion: await expectedResolutionIndexVersion(),
    });
    console.log(formatResolutionIndexReadiness(result));
    if (!result.ready) process.exitCode = 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

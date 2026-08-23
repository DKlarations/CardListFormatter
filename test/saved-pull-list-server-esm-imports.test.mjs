import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const vercelServerGraph = [
  "api/refresh-mtgjson-pricing-index.ts",
  "api/pull-list-jobs.ts",
  "api/_redis.ts",
  "api/_pull-list-job-repository.ts",
  "api/formatted-lists.ts",
  "src/printing-normalization.ts",
  "src/pull-list-job.ts",
  "src/pricing-session.ts",
  "src/pricing.ts",
  "src/customer.ts",
  "src/generated-sample.ts",
  "src/pull-list-fingerprint.ts",
];

test("Vercel server graphs use explicit .js relative ESM specifiers", async () => {
  for (const file of vercelServerGraph) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), "utf8");
    const specifiers = Array.from(source.matchAll(/\bfrom\s+["']([^"']+)["']/g), ([, specifier]) => specifier);
    for (const specifier of specifiers.filter((value) => value.startsWith("."))) {
      assert.match(specifier, /\.js$/, `${file} must use an explicit .js relative import for ${specifier}`);
    }
  }
});

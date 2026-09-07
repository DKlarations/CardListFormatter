import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("generated server libraries and declarations stay outside the API route directory", () => {
  for (const name of ["server-formatter.mjs", "server-formatter.d.ts", "server-pricing.mjs"]) {
    assert.equal(existsSync(new URL(`api/${name}`, root)), false, `${name} must not consume an API Function slot`);
    assert.equal(existsSync(new URL(`server/generated/${name}`, root)), true, `${name} must exist after the build`);
  }
});

test("server generation scripts retain ESM library settings and output outside api", async () => {
  const { scripts } = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
  for (const name of ["formatter", "pricing"]) {
    const command = scripts[`build:server-${name}`];
    assert.ok(command.includes(`esbuild src/${name}.ts `));
    for (const flag of ["--bundle", "--platform=node", "--format=esm", `--outfile=server/generated/server-${name}.mjs`]) {
      assert.ok(command.split(/\s+/).includes(flag), `${name} generation must retain ${flag}`);
    }
  }
});

test("generated libraries retain formatter and pricing exports without HTTP handlers", async () => {
  const formatter = await import("../server/generated/server-formatter.mjs");
  const pricing = await import("../server/generated/server-pricing.mjs");
  for (const name of ["parsePullList", "processPullListText", "compactFormatterItems"]) {
    assert.equal(typeof formatter[name], "function");
  }
  for (const name of ["initializeFoundPricingSelection", "normalizePricingAssistantRow", "priceForSelection"]) {
    assert.equal(typeof pricing[name], "function");
  }
  for (const library of [formatter, pricing]) {
    for (const verb of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]) {
      assert.equal(verb in library, false, `Generated library must not export an HTTP ${verb} handler`);
    }
  }
});

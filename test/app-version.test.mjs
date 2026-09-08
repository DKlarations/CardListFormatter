import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { resolveConfig } from "vite";

const root = new URL("../", import.meta.url);
const rootPath = fileURLToPath(root);
const packageJson = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const main = await readFile(new URL("src/main.tsx", root), "utf8");

test("Vite exposes the package version as the browser application version", async () => {
  const config = await resolveConfig({ root: rootPath }, "build");
  assert.equal(config.define?.__APP_VERSION__, JSON.stringify(packageJson.version));
});

test("both application headers use the shared build-time version label", () => {
  assert.equal(main.match(/<AppVersionLabel \/>/g)?.length, 2);
  assert.match(main, /function AppVersionLabel\(\) \{\s*return <span>v\{__APP_VERSION__\}<\/span>;\s*\}/);
  assert.doesNotMatch(main, /v\d+\.\d+\.\d+/);
});

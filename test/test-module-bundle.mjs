import { buildSync } from "esbuild";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export async function importBundledModule(entryPoint, name) {
  const directory = mkdtempSync(join(tmpdir(), "rrg-pull-list-"));
  const output = join(directory, `${name}.mjs`);
  buildSync({
    entryPoints: [fileURLToPath(new URL(`../${entryPoint}`, import.meta.url))],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: output,
  });
  return import(pathToFileURL(output).href);
}

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";
import { transformSync } from "esbuild";

const root = fileURLToPath(new URL("../", import.meta.url));
const entries = ["api/teams-actions.ts", "api/pull-list-jobs.ts"];

function moduleSpecifiers(source, filename) {
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const values = [];
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      values.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) {
      values.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(tree);
  return values;
}

async function compiledGraph() {
  const modules = new Map();
  const queue = entries.map((entry) => resolve(root, entry));
  while (queue.length) {
    const filename = queue.shift();
    if (modules.has(filename)) continue;
    assert.ok(filename.startsWith(resolve(root) + sep), "Server imports must stay within the repository.");
    const source = await readFile(filename, "utf8");
    for (const specifier of moduleSpecifiers(source, filename).filter((value) => value.startsWith("."))) {
      assert.match(specifier, /\.(?:m?js)$/, `${relative(root, filename)} must use a runtime .js/.mjs import: ${specifier}`);
    }
    let { code } = transformSync(source, { loader: filename.endsWith(".ts") ? "ts" : "js", format: "esm", target: "es2022" });
    for (const specifier of moduleSpecifiers(code, filename)) {
      if (specifier.startsWith(".")) {
        const imported = resolve(dirname(filename), specifier);
        const sourceFile = existsSync(imported) ? imported : imported.replace(/\.js$/, ".ts");
        assert.ok(existsSync(sourceFile), `Missing runtime dependency: ${relative(root, filename)} -> ${specifier}`);
        queue.push(sourceFile);
      } else if (!specifier.startsWith("node:")) {
        // Keep application modules separate; resolve only installed external packages for the temporary tree.
        const installedUrl = import.meta.resolve(specifier);
        code = code.split(JSON.stringify(specifier)).join(JSON.stringify(installedUrl));
      }
    }
    modules.set(filename, code);
  }
  return modules;
}

test("Teams and saved-job server graphs use explicit resolvable ESM runtime imports", async () => {
  const modules = await compiledGraph();
  assert.ok(modules.has(resolve(root, "api/_email-ingest.ts")));
  assert.ok(modules.has(resolve(root, "api/_teams-sync.ts")));
  assert.ok(modules.has(resolve(root, "shared/pull-list-teams-card.mjs")));
  assert.ok(modules.has(resolve(root, "src/pull-list-job.ts")));
});

test("Teams and saved-job handlers import and execute validation under native unbundled Node ESM", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "pullsmith-teams-esm-"));
  t.after(async () => {
    assert.equal(resolve(dirname(directory)), resolve(tmpdir()));
    assert.ok(basename(directory).startsWith("pullsmith-teams-esm-"));
    await rm(directory, { recursive: true, force: true });
  });
  await writeFile(join(directory, "package.json"), JSON.stringify({ type: "module" }));
  const modules = await compiledGraph();
  for (const [filename, code] of modules) {
    const output = join(directory, relative(root, filename).replace(/\.ts$/, ".js"));
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, code);
  }
  const script = `
    import assert from "node:assert/strict";
    globalThis.fetch = async () => { throw new Error("External requests are forbidden in ESM smoke tests."); };
    const teams = await import(${JSON.stringify(pathToFileURL(join(directory, "api/teams-actions.js")).href)});
    const jobs = await import(${JSON.stringify(pathToFileURL(join(directory, "api/pull-list-jobs.js")).href)});
    for (const name of ["GET", "POST"]) assert.equal(typeof teams[name], "function");
    for (const name of ["GET", "POST", "PUT", "DELETE"]) assert.equal(typeof jobs[name], "function");
    const noStore = () => { throw new Error("Validation must not access Redis."); };
    const teamsHandler = teams.createTeamsActionHandlers({ env: {}, getStore: noStore });
    assert.equal((await teamsHandler.GET(new Request("https://pullsmith.example/api/teams-actions"))).status, 404);
    const jobsHandler = jobs.createPullListJobHandlers(noStore);
    assert.equal((await jobsHandler.POST(new Request("https://pullsmith.example/api/pull-list-jobs?action=print-status", {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}"
    }))).status, 400);
    console.log("Native unbundled ESM validation passed.");
  `;
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", timeout: 10000 });
  assert.match(output, /Native unbundled ESM validation passed/);
  t.diagnostic(`Loaded ${modules.size} separate application modules without bundling or network access.`);
});

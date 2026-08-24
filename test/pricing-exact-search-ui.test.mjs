import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync(new URL("../src/PricingPanel.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
const helper = readFileSync(new URL("../src/exact-printing-search.ts", import.meta.url), "utf8");

test("keeps the requested Pricing Assistant column order and existing minimum width", () => {
  const header = panel.match(/<div className="pricing-grid-columns">([\s\S]*?)<\/div>/)?.[1] || "";
  for (const label of ["Found", "Qty", "Card", "Exact Printing Search", "Printing", "Finish", "Treatment", "Cond.", "Price", "Actions"]) {
    assert.ok(header.indexOf(label) >= 0, label);
  }
  const positions = ["Found", "Qty", "Card", "Exact Printing Search", "Printing", "Finish", "Treatment", "Cond.", "Price", "Actions"]
    .map((label) => header.indexOf(label));
  assert.deepEqual(positions, [...positions].sort((a, b) => a - b));
  assert.match(styles, /--pricing-grid-columns:\s*48px 60px minmax\(190px, 1\.5fr\) 30px minmax\(145px, 0\.9fr\) 100px 134px 46px 142px 72px;/);
  assert.match(styles, /\.pricing-grid-columns,[\s\S]*?min-width:\s*1050px;/);
});

test("puts a compact exact-printing trigger immediately before the existing Printing control", () => {
  const searchCell = panel.indexOf('className="pricing-exact-printing-search-cell"');
  const printingControl = panel.indexOf('className={`pricing-set-control pricing-printing-picker');
  assert.ok(searchCell >= 0 && printingControl > searchCell);
  assert.match(panel.slice(searchCell, printingControl), /Find exact printing for \$\{row\.displayName\}/);
  assert.match(styles, /\.pricing-exact-printing-search-button \{[\s\S]*?width:\s*28px;[\s\S]*?height:\s*28px;/);
});

test("renders NM as a noninteractive read-only value and does not add condition pricing", () => {
  assert.match(panel, /className="pricing-condition-value"[\s\S]*?>NM<\/span>/);
  assert.match(panel, /Near Mint condition; condition pricing is not currently active/);
  assert.doesNotMatch(panel, /lightly-played|moderately-played|heavily-played/);
  assert.doesNotMatch(helper, /priceOverride|Listed Median|fetch\(/);
});

test("uses a body portal and leaves Listed Median fetching to existing row effects", () => {
  const selectionHandler = panel.match(/function chooseExactPrinting[\s\S]*?\n  \}/)?.[0] || "";
  assert.match(panel, /pricing-exact-printing-menu[\s\S]*?document\.body/);
  assert.match(selectionHandler, /selectExactPrintingOption/);
  assert.doesNotMatch(selectionHandler, /fetchStorefrontMedianPoints|tcgplayer-listed-median|fetch\(/);
});

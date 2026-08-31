import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const panel = readFileSync(new URL("../src/PricingPanel.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");

test("normal Printing opens an accessible searchable dialog with an inner set listbox", () => {
  const menu = panel.slice(panel.indexOf('className="pricing-printing-menu"'));
  assert.match(menu, /role="dialog"/);
  assert.match(menu, /Choose Printing for \$\{row\.displayName\}/);
  assert.match(menu, /autoFocus/);
  assert.match(menu, /placeholder="Set code or set name/);
  assert.match(menu, /className="pricing-printing-results"[\s\S]*?role="listbox"/);
  assert.match(menu, /role="option"/);
  assert.match(menu, /No sets match/);
  assert.match(styles, /\.pricing-printing-menu \{[\s\S]*?flex-direction:\s*column;[\s\S]*?overflow:\s*hidden;/);
  assert.match(styles, /\.pricing-printing-results \{[\s\S]*?overflow-y:\s*auto;/);
});

test("normal Printing keyboard selection uses the existing set helper and clears transient search state", () => {
  assert.match(panel, /const \[printingSearchQuery, setPrintingSearchQuery\] = useState\(""\)/);
  assert.match(panel, /const \[highlightedPrintingIndex, setHighlightedPrintingIndex\] = useState\(0\)/);
  assert.match(panel, /event\.key === "ArrowDown"/);
  assert.match(panel, /event\.key === "ArrowUp"/);
  assert.match(panel, /event\.key === "Enter"/);
  assert.match(panel, /event\.key === "Escape"/);

  const choose = panel.match(/function choosePrintingSet[\s\S]*?\n  \}/)?.[0] || "";
  const close = panel.match(/function closePrintingMenu[\s\S]*?\n  \}/)?.[0] || "";
  assert.match(choose, /selectPrintingSet\(row, setCode\)/);
  assert.match(choose, /closePrintingMenu\(\)/);
  assert.match(close, /setPrintingSearchQuery\(""\)/);
  assert.match(close, /setHighlightedPrintingIndex\(0\)/);
  assert.match(panel, /onClick=\{\(\) => choosePrintingSet\(row, edition\.setCode\)\}/);
});

test("normal and Exact Printing searches close each other without sharing queries", () => {
  const openExact = panel.match(/function openExactPrintingSearch[\s\S]*?\n  \}/)?.[0] || "";
  assert.match(openExact, /closePrintingMenu\(\)/);

  const normalTrigger = panel.slice(
    panel.indexOf('className={`pricing-set-control pricing-printing-picker'),
    panel.indexOf('className="pricing-printing-menu"'),
  );
  assert.match(normalTrigger, /setOpenExactPrintingRowId\(null\)/);
  assert.match(normalTrigger, /setExactPrintingQuery\(""\)/);
  assert.match(panel, /setPrintingSearchQuery\(""\)[\s\S]*?setExactPrintingQuery\(""\)/);
  assert.doesNotMatch(panel, /value=\{exactPrintingQuery\}[\s\S]{0,250}setPrintingSearchQuery/);
});


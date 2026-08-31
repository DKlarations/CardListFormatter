import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const main = readFileSync(new URL("../src/main.tsx", import.meta.url), "utf8");
const pricingPanel = readFileSync(new URL("../src/PricingPanel.tsx", import.meta.url), "utf8");

test("Pull List print status is recorded only after a window and document exist", () => {
  const printOutput = main.match(/function printOutput\(\)[\s\S]*?\n  \}/)?.[0] || "";
  const blocked = printOutput.indexOf('if (!printWindow)');
  const documentClose = printOutput.indexOf("printWindow.document.close()");
  const record = printOutput.indexOf('recordPrintStatus("pull-list", new Date().toISOString())');
  const print = printOutput.indexOf("printWindow.print()");
  assert.ok(blocked >= 0 && documentClose > blocked && record > documentClose && print > record);
  assert.match(printOutput.slice(blocked, documentClose), /setMessage\("Print window was blocked\."\)[\s\S]*?return;/);
});

test("Pricing print status is recorded only after receipt validation and document creation", () => {
  const printPricing = pricingPanel.match(/async function printPricingReceipt\(\)[\s\S]*?\n  \}/)?.[0] || "";
  const validation = printPricing.indexOf("if (!canPrintReceipt)");
  const blocked = printPricing.indexOf("if (!printWindow)");
  const documentClose = printPricing.indexOf("printWindow.document.close()");
  const record = printPricing.indexOf("onPricingPrinted(new Date().toISOString())");
  const print = printPricing.indexOf("printWindow.print()");
  assert.ok(validation >= 0 && blocked > validation && documentClose > blocked && record > documentClose && print > record);
  assert.match(printPricing.slice(blocked, documentClose), /onMessage\("Print window was blocked\."\)[\s\S]*?return;/);
});

test("print status participates in the normal job draft and reset lifecycle", () => {
  assert.match(main, /const jobDraft = useMemo[\s\S]*?pricingState,[\s\S]*?printStatus,/);
  assert.match(main, /const nextPrintStatus = emptyPullListJobPrintStatus\(\);[\s\S]*?printStatus: nextPrintStatus/);
  const inputChange = main.match(/function handleInputChange[\s\S]*?\n  \}/)?.[0] || "";
  const newList = main.match(/function startNewList[\s\S]*?\n  \}/)?.[0] || "";
  assert.match(inputChange, /setPrintStatus\(emptyPullListJobPrintStatus\(\)\)/);
  assert.match(newList, /setPrintStatus\(emptyPullListJobPrintStatus\(\)\)/);
  assert.match(main, /setPrintStatus\(job\.printStatus\)/);
  assert.match(main, /onPricingPrinted=\{recordPricingPrinted\}/);
});


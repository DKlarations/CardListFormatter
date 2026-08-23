import assert from "node:assert/strict";
import test from "node:test";
import { importBundledModule } from "./test-module-bundle.mjs";

const {
  formatterPrimaryAction,
  FORMATTER_REPROCESS_ACTION,
  formatterStatusMetrics,
  shouldShowFormatterReprocess,
} = await importBundledModule("src/workspace-ui.ts", "workspace-ui");

test("uses Process List as the idle formatter action", () => {
  assert.deepEqual(formatterPrimaryAction(false), {
    action: "process-list",
    label: "Process List",
    title: "Process list",
    variant: "primary",
  });
});

test("uses Cancel as the active formatter action", () => {
  assert.deepEqual(formatterPrimaryAction(true), {
    action: "cancel-processing",
    label: "Cancel",
    title: "Cancel processing",
    variant: "danger",
  });
});

test("keeps Formatter Status Bar metrics informational and Reprocess actionable only when useful", () => {
  const metrics = formatterStatusMetrics({ totalParsed: 14, resolvedCount: 13, printFallbacks: 3 });
  assert.deepEqual(metrics.map((metric) => metric.label), ["14 parsed", "13 resolved", "3 fallback"]);
  assert.ok(metrics.every((metric) => metric.interactive === false));
  assert.equal(shouldShowFormatterReprocess(0, false), false);
  assert.equal(shouldShowFormatterReprocess(1, false), true);
  assert.equal(shouldShowFormatterReprocess(1, true), false);
  assert.deepEqual(FORMATTER_REPROCESS_ACTION, {
    ariaLabel: "Reprocess Needs Review",
    iconOnly: true,
    title: "Reprocess Needs Review",
  });
});

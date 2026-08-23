import assert from "node:assert/strict";
import test from "node:test";
import { importBundledModule } from "./test-module-bundle.mjs";

const {
  EMPTY_PRICING_MESSAGE,
  pricingAssistantViewState,
  shouldShowPricingAssistant,
} = await importBundledModule("src/pricing-ui-state.ts", "pricing-ui-state");

test("uses a concise empty Pricing Assistant state while keeping Add Card available", () => {
  const state = pricingAssistantViewState(0);
  assert.equal(EMPTY_PRICING_MESSAGE, "Process a customer list or add a card manually.");
  assert.equal(state.isEmpty, true);
  assert.doesNotMatch(state.emptyMessage, /No cards yet/i);
  assert.equal(state.emptyTextAlignment, "center");
  assert.equal(state.showAddCard, true);
  assert.equal(state.showTotals, false);
});

test("returns populated Pricing Assistant behavior once rows exist", () => {
  const state = pricingAssistantViewState(1);
  assert.equal(state.isEmpty, false);
  assert.equal(state.showAddCard, true);
  assert.equal(state.showTotals, true);
});

test("keeps Pricing Assistant available without formatter output or a processed timestamp", () => {
  assert.equal(shouldShowPricingAssistant({ processedAt: null, output: "" }), true);
});

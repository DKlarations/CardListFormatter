import assert from "node:assert/strict";
import test from "node:test";
import { importBundledModule } from "./test-module-bundle.mjs";

const catalogState = await importBundledModule("src/pricing-catalog-state.ts", "pricing-catalog-state");

function printing(overrides = {}) {
  return {
    uuid: "printing-1",
    setCode: "TST",
    setName: "Test Set",
    keyruneCode: "tst",
    releaseDate: "2026-01-01",
    number: "1",
    rarity: "rare",
    treatments: ["standard"],
    foilTreatment: "standard",
    finishes: ["normal"],
    prices: {},
    ...overrides,
  };
}

function row(overrides = {}) {
  return {
    id: "row-1",
    groupId: "group-1",
    sourceIndex: 0,
    requestedQuantity: 1,
    isBasicLand: false,
    quantity: 0,
    found: false,
    resolved: true,
    displayName: "Test Card",
    canonicalName: "Test Card",
    setSelectionSource: "default",
    setCode: "",
    selectedPrintingUuid: "",
    finish: "normal",
    treatment: "standard",
    foilTreatment: "standard",
    priceOverride: null,
    ...overrides,
  };
}

test("resolved rows display Loading rather than Unavailable while catalog coverage is pending", () => {
  const coverage = { "test card": { status: "pending" } };
  const state = catalogState.pricingCatalogRowState(row(), coverage, {});
  assert.equal(state, "loading");
  assert.equal(catalogState.pricingCatalogRowPresentation(state).label, "Loading…");
  assert.equal(catalogState.pricingCatalogControlsAvailable(state), false);
});

test("an inconsistent ready marker cannot flash Unavailable before its catalog state commits", () => {
  const coverage = { "test card": { status: "ready" } };
  const state = catalogState.pricingCatalogRowState(row(), coverage, {});
  assert.equal(state, "loading");
});

test("resolved rows display Load failed rather than Unavailable after a relevant source failure", () => {
  const coverage = { "test card": { status: "error", message: "Shard failed." } };
  const state = catalogState.pricingCatalogRowState(row(), coverage, {});
  assert.equal(state, "load-error");
  assert.equal(catalogState.pricingCatalogRowPresentation(state).label, "Load failed");
  assert.equal(catalogState.pricingCatalogControlsAvailable(state), false);
});

test("Unavailable requires a completed lookup with no supported physical editions", () => {
  const coverage = catalogState.completedPricingCatalogCoverage(
    ["Test Card"],
    {},
    { completedShardKeys: ["t"] },
  );
  const state = catalogState.pricingCatalogRowState(row(), coverage, {});
  assert.equal(coverage["test card"].status, "missing");
  assert.equal(state, "unavailable");
  assert.equal(catalogState.pricingCatalogRowPresentation(state).label, "Unavailable");
});

test("partial fallback enables recovered cards and leaves unrecovered cards retryable", () => {
  const catalog = {
    "card a": { name: "Card A", printings: [printing({ uuid: "a" })] },
    "card b": { name: "Card B", printings: [printing({ uuid: "b" })] },
  };
  const coverage = catalogState.completedPricingCatalogCoverage(
    ["Card A", "Card B", "Card C"],
    catalog,
    { recoveryAttempted: true, errorMessage: "Pricing shard recovery failed." },
  );
  assert.deepEqual(Object.fromEntries(Object.entries(coverage).map(([key, value]) => [key, value.status])), {
    "card a": "ready",
    "card b": "ready",
    "card c": "error",
  });
  assert.equal(catalogState.pricingCatalogLoadStateForCoverage(coverage), "error");
  assert.equal(catalogState.pricingCatalogControlsAvailable(catalogState.pricingCatalogRowState(row({ canonicalName: "Card A" }), coverage, catalog)), true);
  assert.equal(catalogState.pricingCatalogRowState(row({ canonicalName: "Card C" }), coverage, catalog), "load-error");
});

test("successful retry restores controls and preserves valid staff selections and overrides", () => {
  const manualPrinting = printing({
    uuid: "manual-uuid",
    setCode: "MAN",
    setName: "Manual Set",
    treatments: ["borderless"],
    finishes: ["foil"],
  });
  const catalog = { "test card": { name: "Test Card", printings: [manualPrinting] } };
  const before = row({
    found: true,
    quantity: 1,
    setSelectionSource: "manual",
    setCode: "MAN",
    selectedPrintingUuid: "manual-uuid",
    finish: "foil",
    treatment: "borderless",
    priceOverride: "12.34",
  });
  const failedCoverage = { "test card": { status: "error" } };
  assert.equal(catalogState.pricingCatalogRowState(before, failedCoverage, {}), "load-error");
  const [after] = catalogState.applyPricingCatalogToRows([before], catalog);
  const coverage = catalogState.completedPricingCatalogCoverage(["Test Card"], catalog, { completedShardKeys: ["t"] });
  const state = catalogState.pricingCatalogRowState(after, coverage, catalog);
  assert.equal(state, "ready");
  assert.equal(catalogState.pricingCatalogLoadStateForCoverage(coverage), "ready");
  assert.equal(catalogState.pricingCatalogControlsAvailable(state), true);
  assert.deepEqual({
    found: after.found,
    quantity: after.quantity,
    setCode: after.setCode,
    selectedPrintingUuid: after.selectedPrintingUuid,
    finish: after.finish,
    treatment: after.treatment,
    priceOverride: after.priceOverride,
  }, {
    found: true,
    quantity: 1,
    setCode: "MAN",
    selectedPrintingUuid: "manual-uuid",
    finish: "foil",
    treatment: "borderless",
    priceOverride: "12.34",
  });
});

test("generation guards reject stale loads and accept the current successful load", () => {
  assert.equal(catalogState.isCurrentPricingLoad(3, 4), false);
  assert.equal(catalogState.isCurrentPricingLoad(4, 4), true);
});

test("TCGplayer price failure does not change ready printing coverage or disable controls", () => {
  const catalog = { "test card": { name: "Test Card", printings: [printing()] } };
  const coverage = catalogState.completedPricingCatalogCoverage(["Test Card"], catalog, { completedShardKeys: ["t"] });
  const state = catalogState.pricingCatalogRowState(row(), coverage, catalog);
  assert.equal(state, "ready");
  assert.equal(catalogState.pricingCatalogControlsAvailable(state), true);
});

test("basic lands retain their manual-pricing exception after conclusive catalog absence", () => {
  const coverage = { "basic land": { status: "missing" } };
  const state = catalogState.pricingCatalogRowState(row({ canonicalName: "Basic Land", isBasicLand: true }), coverage, {});
  assert.equal(state, "unavailable");
  assert.equal(catalogState.pricingCatalogControlsAvailable(state, true), true);
});

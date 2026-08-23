import assert from "node:assert/strict";
import test from "node:test";
import { importBundledModule } from "./test-module-bundle.mjs";

const recovery = await importBundledModule("src/pricing-catalog-recovery.ts", "pricing-catalog-recovery");
const catalogState = await importBundledModule("src/pricing-catalog-state.ts", "pricing-catalog-state-recovery");

function printing(overrides = {}) {
  return {
    uuid: "printing-1",
    tcgplayerProductId: "12345",
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

function card(name, printings = [printing()]) {
  return { name, printings };
}

function row(overrides = {}) {
  return {
    id: "row-1",
    groupId: "group-1",
    sourceIndex: 0,
    requestedQuantity: 1,
    isBasicLand: false,
    quantity: 1,
    found: false,
    resolved: true,
    displayName: "Card A",
    canonicalName: "Card A",
    requestedFlavorName: "",
    requestedSetCode: "",
    requestedTreatment: "",
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

test("ordinary automatic recovery keeps a would-be missing card pending until recovered and ready", () => {
  const primaryCoverage = { "card a": { status: "missing" } };
  const attempted = new Set();
  const claimed = recovery.claimPricingCatalogRecoveryCards(
    ["Card A"],
    primaryCoverage,
    {},
    attempted,
  );
  assert.deepEqual(claimed, ["Card A"]);

  const pending = recovery.pendingPricingCatalogRecoveryCoverage(primaryCoverage, claimed);
  assert.equal(pending["card a"].status, "pending");
  assert.equal(catalogState.pricingCatalogRowPresentation(
    catalogState.pricingCatalogRowState(row(), pending, {}),
  ).label, "Loading…");

  const recoveredCatalog = { "card a": card("Card A") };
  const completed = recovery.completedPricingCatalogRecoveryCoverage(
    primaryCoverage,
    claimed,
    recoveredCatalog,
  );
  assert.equal(completed["card a"].status, "ready");
  assert.equal(catalogState.pricingCatalogControlsAvailable(
    catalogState.pricingCatalogRowState(row(), completed, recoveredCatalog),
  ), true);
});

test("one recovery batch deduplicates split rows and excludes already-ready cards", () => {
  const coverage = {
    "card a": { status: "missing" },
    "card b": { status: "missing" },
    "card c": { status: "ready" },
    "card d": { status: "missing" },
  };
  const catalog = { "card c": card("Card C") };
  const claimed = recovery.claimPricingCatalogRecoveryCards(
    ["Card A", "Card B", "Card C", "Card D", "Card A"],
    coverage,
    catalog,
    new Set(),
  );
  assert.deepEqual(claimed, ["Card A", "Card B", "Card D"]);
});

test("the automatic attempt guard permits only one claim per canonical card", () => {
  const coverage = { "card a": { status: "missing" } };
  const attempted = new Set();
  assert.deepEqual(recovery.claimPricingCatalogRecoveryCards(["Card A"], coverage, {}, attempted), ["Card A"]);
  assert.deepEqual(recovery.claimPricingCatalogRecoveryCards(["CARD A"], coverage, {}, attempted), []);
  assert.equal(attempted.size, 1);
});

test("a rerender preserves a consumed technical failure instead of converting it to Unavailable", () => {
  const preserved = recovery.preserveConsumedPricingCatalogRecoveryCoverage(
    { "card a": { status: "missing" } },
    { "card a": { status: "error", message: "Provider failed." } },
    new Set(["card a"]),
  );
  assert.deepEqual(preserved["card a"], { status: "error", message: "Provider failed." });

  const interrupted = recovery.preserveConsumedPricingCatalogRecoveryCoverage(
    { "card a": { status: "missing" } },
    { "card a": { status: "pending" } },
    new Set(["card a"]),
  );
  assert.equal(interrupted["card a"].status, "error");
});

test("manual Retry bypasses the consumed automatic guard and can restore ready coverage", () => {
  const primaryCoverage = { "card a": { status: "missing" } };
  const attempted = new Set();
  recovery.claimPricingCatalogRecoveryCards(["Card A"], primaryCoverage, {}, attempted);
  const failed = recovery.completedPricingCatalogRecoveryCoverage(
    primaryCoverage,
    ["Card A"],
    {},
    ["card a"],
    "Network failed.",
  );
  assert.equal(failed["card a"].status, "error");
  assert.equal(catalogState.pendingPricingCatalogCoverage(
    ["Card A"],
    {},
    failed,
  )["card a"].status, "error");
  assert.equal(catalogState.pendingPricingCatalogCoverage(
    ["Card A"],
    {},
    failed,
    true,
  )["card a"].status, "pending");

  const manualClaim = recovery.claimPricingCatalogRecoveryCards(
    ["Card A"],
    primaryCoverage,
    {},
    attempted,
    { force: true },
  );
  assert.deepEqual(manualClaim, ["Card A"]);
  const catalog = { "card a": card("Card A") };
  const ready = recovery.completedPricingCatalogRecoveryCoverage(primaryCoverage, manualClaim, catalog);
  assert.equal(ready["card a"].status, "ready");
});

test("a successful recovery with genuinely zero physical printings becomes Unavailable", () => {
  const coverage = recovery.completedPricingCatalogRecoveryCoverage(
    { "card a": { status: "missing" } },
    ["Card A"],
    {},
  );
  assert.equal(coverage["card a"].status, "missing");
  assert.equal(catalogState.pricingCatalogRowPresentation(
    catalogState.pricingCatalogRowState(row(), coverage, {}),
  ).label, "Unavailable");
});

test("a technical automatic-recovery failure becomes Load failed and produces one failed batch diagnostic", () => {
  const coverage = recovery.completedPricingCatalogRecoveryCoverage(
    { "card a": { status: "missing" } },
    ["Card A"],
    {},
    ["card a"],
    "Provider failed.",
  );
  assert.equal(coverage["card a"].status, "error");
  assert.equal(catalogState.pricingCatalogRowPresentation(
    catalogState.pricingCatalogRowState(row(), coverage, {}),
  ).label, "Load failed");

  const summary = recovery.summarizePricingCatalogRecoveryBatch(
    ["Card A"],
    {},
    ["card a"],
    "Provider failed.",
  );
  assert.deepEqual(
    { outcome: summary.outcome, requested: summary.requested, cataloged: summary.cataloged, missing: summary.missing },
    { outcome: "failed", requested: 1, cataloged: 0, missing: 1 },
  );
  assert.match(summary.message, /^Automatic printing-history recovery failed\./);
});

test("recovery merges only targeted catalog data and preserves valid staff selections across split rows", () => {
  const goodPrinting = printing({ uuid: "good-uuid", setCode: "GOOD", setName: "Good Set" });
  const currentCatalog = { "card c": card("Card C", [goodPrinting]) };
  const recoveredPrinting = printing({
    uuid: "manual-uuid",
    setCode: "MAN",
    setName: "Manual Set",
    treatments: ["borderless"],
    finishes: ["foil"],
    foilTreatment: "surge",
  });
  const merged = recovery.mergeRecoveredPricingCatalog(
    currentCatalog,
    { "card a": card("Card A", [recoveredPrinting]) },
  );
  assert.deepEqual(merged["card c"], currentCatalog["card c"]);

  const staffRows = [
    row({
      id: "row-a-1",
      requestedQuantity: 2,
      quantity: 1,
      found: true,
      setSelectionSource: "manual",
      setCode: "MAN",
      selectedPrintingUuid: "manual-uuid",
      finish: "foil",
      foilTreatment: "surge",
      treatment: "borderless",
      priceOverride: "12.34",
    }),
    row({
      id: "row-a-2",
      requestedQuantity: 2,
      quantity: 1,
      found: true,
      setSelectionSource: "manual",
      setCode: "MAN",
      selectedPrintingUuid: "manual-uuid",
      finish: "foil",
      foilTreatment: "surge",
      treatment: "borderless",
      priceOverride: "10.00",
    }),
  ];
  const after = catalogState.applyPricingCatalogToRows(staffRows, merged);
  assert.deepEqual(after.map((candidate) => ({
    id: candidate.id,
    found: candidate.found,
    quantity: candidate.quantity,
    setSelectionSource: candidate.setSelectionSource,
    setCode: candidate.setCode,
    finish: candidate.finish,
    foilTreatment: candidate.foilTreatment,
    treatment: candidate.treatment,
    selectedPrintingUuid: candidate.selectedPrintingUuid,
    priceOverride: candidate.priceOverride,
  })), staffRows.map((candidate) => ({
    id: candidate.id,
    found: candidate.found,
    quantity: candidate.quantity,
    setSelectionSource: candidate.setSelectionSource,
    setCode: candidate.setCode,
    finish: candidate.finish,
    foilTreatment: candidate.foilTreatment,
    treatment: candidate.treatment,
    selectedPrintingUuid: candidate.selectedPrintingUuid,
    priceOverride: candidate.priceOverride,
  })));
});

test("session reset clears the attempt guard so the same canonical card gets one new attempt", () => {
  const coverage = { "card a": { status: "missing" } };
  const attempted = new Set();
  recovery.claimPricingCatalogRecoveryCards(["Card A"], coverage, {}, attempted);
  assert.deepEqual(recovery.claimPricingCatalogRecoveryCards(["Card A"], coverage, {}, attempted), []);
  recovery.resetPricingCatalogRecoveryAttempts(attempted);
  assert.deepEqual(recovery.claimPricingCatalogRecoveryCards(["Card A"], coverage, {}, attempted), ["Card A"]);
});

test("printing recovery does not make a not-Found row eligible for Listed Median", () => {
  const recoveredCatalog = { "card a": card("Card A") };
  const [recoveredRow] = catalogState.applyPricingCatalogToRows([row({ found: false })], recoveredCatalog);
  assert.equal(recoveredRow.setCode, "TST");
  assert.deepEqual(recovery.foundPricingRowsForListedMedian([recoveredRow]), []);
  assert.equal(recovery.foundPricingRowsForListedMedian([{ ...recoveredRow, found: true }]).length, 1);
});

test("automatic recovery diagnostics summarize one partial batch without listing card names", () => {
  const summary = recovery.summarizePricingCatalogRecoveryBatch(
    ["Card A", "Card B", "Card D"],
    { "card a": card("Card A"), "card b": card("Card B") },
  );
  assert.deepEqual(
    { outcome: summary.outcome, requested: summary.requested, cataloged: summary.cataloged, missing: summary.missing },
    { outcome: "partial", requested: 3, cataloged: 2, missing: 1 },
  );
  assert.equal(summary.message, "Automatic recovery: 2/3 cards cataloged. 1 card still missing.");
  assert.equal(summary.message.includes("Card A"), false);
});

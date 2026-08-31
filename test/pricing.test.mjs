import assert from "node:assert/strict";
import test from "node:test";
import { importBundledModule } from "./test-module-bundle.mjs";

import {
  applyMinimumPrice,
  canPrintPricingReceipt,
  compatibleTreatmentOptions,
  convertCurrencyPrice,
  createFreshPricingAssistantSession,
  createManualPricingRow,
  createPricingRowsFromFormatterItems,
  editionOptions,
  exactPrintingUuidForSelection,
  finishChoices,
  initializeFoundPricingSelection,
  initializePricingRowSelection,
  listedMedianPriceForFinish,
  minimumPriceForSelection,
  matchingPrintings,
  normalizePricingPhysicalSelection,
  preferredDefaultEdition,
  preferredDefaultTreatment,
  preferredPrintingSelection,
  priceCurrencySymbol,
  priceVarianceRatio,
  priceWithListedMedianFallback,
  priceForSelection,
  pricingDisplayName,
  pricingIndexSupportsPhysicalDimensions,
  pricingPhysicalSelectionIsValid,
  pricingReceiptCardSummary,
  pricingRowWarningState,
  reconcilePricingRowsWithFormatterItems,
  removePricingAssistantRow,
  pricingVariantOptions,
  pricingSelectionForPrintingUuid,
  printingMatchesFinishChoice,
  parsePrice,
  pricingNameKey,
  pricingQuantityMaximum,
  pricingShardKey,
  remainingRequestedQuantity,
  receiptTreatment,
  requiresPriceVarianceReview,
  searchEditionOptions,
  selectableMtgjsonPriceSources,
  setSearchTerm,
  tcgplayerCardSearchUrl,
  tcgplayerProductIdForSelection,
  tcgplayerProductIdsForSelection,
  treatmentOptions,
  treatmentForFinishChoice,
  shouldShowPricingVariant,
  selectManualPricingSet,
  normalizePricingAssistantRow,
} from "../api/server-pricing.mjs";

const { foilTreatmentForRawPrinting, treatmentsForRawPrinting } = await importBundledModule(
  "src/printing-normalization.ts",
  "pricing-printing-normalization",
);

const basePrinting = {
  uuid: "rav-dark-confidant",
  tcgplayerProductId: "12345",
  setCode: "RAV",
  setName: "Ravnica: City of Guilds",
  keyruneCode: "rav",
  releaseDate: "2005-10-07",
  number: "81",
  rarity: "rare",
  treatments: ["standard"],
  finishes: ["normal", "foil"],
  prices: {
    normal: { value: 4.65, source: "tcgplayer" },
    foil: { value: 32, source: "cardkingdom" },
  },
  priceListings: {
    normal: {
      "tcgplayer:retail": { value: 4.65, source: "tcgplayer:retail", currency: "USD" },
      "cardkingdom:retail": { value: 5, source: "cardkingdom:retail", currency: "USD" },
      "cardmarket:retail": { value: 4.25, source: "cardmarket:retail", currency: "EUR" },
    },
    foil: {
      "cardkingdom:retail": { value: 32, source: "cardkingdom:retail", currency: "USD" },
    },
  },
};

const surgeArtFixture = {
  name: "Example Card",
  printings: [
    { ...basePrinting, uuid: "UUID-A", setCode: "FIN", number: "317", treatments: ["borderless"], finishes: ["foil"], foilTreatment: "standard", tcgplayerProductId: "317f" },
    { ...basePrinting, uuid: "UUID-B", setCode: "FIN", number: "317", treatments: ["borderless"], finishes: ["foil"], foilTreatment: "surge", tcgplayerProductId: "317s" },
    { ...basePrinting, uuid: "UUID-C", setCode: "FIN", number: "382", treatments: ["borderless"], finishes: ["foil"], foilTreatment: "standard", tcgplayerProductId: "382f" },
    { ...basePrinting, uuid: "UUID-D", setCode: "FIN", number: "382", treatments: ["borderless"], finishes: ["foil"], foilTreatment: "surge", tcgplayerProductId: "382s" },
  ],
};

const treatmentAvailabilityFixture = {
  name: "Treatment Test",
  printings: [
    { ...basePrinting, uuid: "UUID-1", setCode: "TST", number: "100", treatments: ["standard"], finishes: ["normal"] },
    { ...basePrinting, uuid: "UUID-2", setCode: "TST", number: "200", treatments: ["borderless"], finishes: ["normal"] },
    { ...basePrinting, uuid: "UUID-3", setCode: "TST", number: "101", treatments: ["standard"], finishes: ["foil"], foilTreatment: "standard" },
    { ...basePrinting, uuid: "UUID-4", setCode: "TST", number: "300", treatments: ["extended-art"], finishes: ["foil"], foilTreatment: "standard" },
    { ...basePrinting, uuid: "UUID-5", setCode: "TST", number: "400", treatments: ["borderless"], finishes: ["foil"], foilTreatment: "surge" },
  ],
};

function exactFixturePrinting({
  uuid,
  setCode,
  setName = `${setCode} Test Set`,
  releaseDate = "2025-01-01",
  number = "1",
  treatments = ["standard"],
  finishes = ["normal"],
  foilTreatment = "standard",
  tcgplayerProductId = `${setCode.toLowerCase()}-${number}`,
  price = 1.25,
}) {
  const pricedFinish = finishes.includes("normal") ? "normal" : finishes[0];
  return {
    ...basePrinting,
    uuid,
    tcgplayerProductId,
    setCode,
    setName,
    keyruneCode: setCode.toLowerCase(),
    releaseDate,
    number,
    treatments,
    finishes,
    foilTreatment,
    prices: {
      [pricedFinish]: { value: price, source: "tcgplayer" },
    },
    priceListings: {
      [pricedFinish]: {
        "tcgplayer:retail": { value: price, source: "tcgplayer:retail", currency: "USD" },
      },
    },
  };
}

function freshFormatterPricingRow(cardName, requestedPrinting) {
  return createPricingRowsFromFormatterItems([{
    index: 0,
    inputName: cardName,
    quantity: 1,
    status: "found",
    card: { name: cardName },
    ...(requestedPrinting ? { requestedPrinting } : {}),
  }])[0];
}

function readyWarningState(row) {
  return pricingRowWarningState({
    resolved: row.resolved,
    found: row.found,
    catalogState: "ready",
    hydrating: false,
    automaticStatus: "ready",
    priceValid: true,
  });
}

test("initializes Found through a complete single-printing pricing pipeline", () => {
  const card = {
    name: "Single Standard",
    printings: [exactFixturePrinting({
      uuid: "single-standard-uuid",
      setCode: "ONE",
      tcgplayerProductId: "100001",
      price: 2.75,
    })],
  };
  const initial = freshFormatterPricingRow(card.name);
  assert.equal(initial.found, false);
  assert.equal(initial.setCode, "");

  const found = initializeFoundPricingSelection(initial, card, "2026-08-21");
  assert.deepEqual({
    found: found.found,
    setCode: found.setCode,
    finish: found.finish,
    foilTreatment: found.foilTreatment,
    treatment: found.treatment,
    selectedPrintingUuid: found.selectedPrintingUuid,
  }, {
    found: true,
    setCode: "ONE",
    finish: "normal",
    foilTreatment: "standard",
    treatment: "standard",
    selectedPrintingUuid: "single-standard-uuid",
  });
  assert.equal(pricingPhysicalSelectionIsValid(found, card), true);
  assert.equal(tcgplayerProductIdForSelection(card, found.setCode, found.treatment, found.finish, found.selectedPrintingUuid, found.foilTreatment), "100001");
  assert.equal(priceForSelection(card, found.setCode, found.treatment, found.finish, "tcgplayer:retail", found.selectedPrintingUuid, found.foilTreatment).price, 2.75);
  assert.equal(shouldShowPricingVariant(found.found, pricingVariantOptions(card, found.setCode, found.treatment, found.finish, found.foilTreatment)), false);
  assert.equal(readyWarningState(found), "none");
});

test("reconciles retried formatter resolution without erasing pricing work", () => {
  const unresolved = createPricingRowsFromFormatterItems([{
    index: 7,
    inputName: "Typod Card",
    quantity: 2,
    status: "review",
  }])[0];
  const inProgress = { ...unresolved, found: true, priceOverride: "1.25" };
  const manual = createManualPricingRow("manual-keep", "manual-keep", "Manual Card", "Manual Card");
  const reconciled = reconcilePricingRowsWithFormatterItems([inProgress, manual], [{
    index: 7,
    inputName: "Typod Card",
    quantity: 2,
    status: "found",
    card: { name: "Typed Card" },
  }]);
  assert.equal(reconciled.length, 2);
  assert.equal(reconciled[0].resolved, true);
  assert.equal(reconciled[0].canonicalName, "Typed Card");
  assert.equal(reconciled[0].found, true);
  assert.equal(reconciled[0].priceOverride, "1.25");
  assert.equal(reconciled[1].manuallyCreated, true);
});

test("creates a normal manual pricing row before any formatter session exists", () => {
  const freshRows = reconcilePricingRowsWithFormatterItems([], []);
  const manual = createManualPricingRow(
    "manual-quick-original",
    "manual-quick",
    "Quick Price Card",
    "Quick Price Card",
  );
  const card = {
    name: "Quick Price Card",
    printings: [exactFixturePrinting({
      uuid: "quick-price-uuid",
      setCode: "QCK",
      tcgplayerProductId: "100020",
    })],
  };
  const found = initializeFoundPricingSelection(manual, card, "2026-08-22");

  assert.equal(freshRows.length, 0);
  assert.equal(found.manuallyCreated, true);
  assert.equal(found.found, true);
  assert.equal(found.setCode, "QCK");
  assert.equal(found.selectedPrintingUuid, "quick-price-uuid");
  assert.equal(pricingPhysicalSelectionIsValid(found, card), true);
});

test("processing a formatter list preserves manual quick-pricing rows", () => {
  const manual = createManualPricingRow(
    "manual-session-original",
    "manual-session",
    "Manual Session Card",
    "Manual Session Card",
  );
  const reconciled = reconcilePricingRowsWithFormatterItems([manual], [{
    index: 0,
    inputName: "Processed Card",
    quantity: 2,
    status: "found",
    card: { name: "Processed Card" },
  }]);

  assert.equal(reconciled.length, 2);
  assert.equal(reconciled[0].manuallyCreated, false);
  assert.equal(reconciled[0].canonicalName, "Processed Card");
  assert.equal(reconciled[0].requestedQuantity, 2);
  assert.equal(reconciled[1].id, manual.id);
  assert.equal(reconciled[1].manuallyCreated, true);
});

test("normal processed formatter items still initialize pricing rows", () => {
  const rows = createPricingRowsFromFormatterItems([{
    index: 4,
    inputName: "Normal Workflow Card",
    quantity: 3,
    status: "found",
    card: { name: "Normal Workflow Card" },
  }]);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].resolved, true);
  assert.equal(rows[0].found, false);
  assert.equal(rows[0].requestedQuantity, 3);
});

test("empty pricing state has safe zero-card calculations", () => {
  assert.deepEqual(reconcilePricingRowsWithFormatterItems([], []), []);
  assert.equal(remainingRequestedQuantity(0, []), 0);
  assert.equal(canPrintPricingReceipt(0, 0), false);
  assert.equal(canPrintPricingReceipt(1, 0), true);
  assert.equal(canPrintPricingReceipt(1, 1), false);
});

test("removing the only formatter row excludes its source and reconciliation does not recreate it", () => {
  const formatterItems = [{
    index: 4,
    inputName: "Lightning Bolt",
    quantity: 1,
    status: "found",
    card: { name: "Lightning Bolt" },
  }];
  const [row] = createPricingRowsFromFormatterItems(formatterItems);
  const removed = removePricingAssistantRow([row], row.id, []);

  assert.equal(removed.removedKind, "formatter-source");
  assert.deepEqual(removed.rows, []);
  assert.deepEqual(removed.excludedSourceIndices, [4]);
  assert.deepEqual(reconcilePricingRowsWithFormatterItems(
    removed.rows,
    formatterItems,
    removed.excludedSourceIndices,
  ), []);
});

test("removing formatter splits preserves the source until its final row is removed", () => {
  const [original] = createPricingRowsFromFormatterItems([{
    index: 4,
    inputName: "Sol Ring",
    quantity: 4,
    status: "found",
    card: { name: "Sol Ring" },
  }]);
  const artA = { ...original, id: `${original.groupId}-art-a`, quantity: 3 };
  const artB = { ...original, id: `${original.groupId}-art-b`, quantity: 1 };

  const splitRemoval = removePricingAssistantRow([artA, artB], artB.id, []);
  assert.equal(splitRemoval.removedKind, "split");
  assert.deepEqual(splitRemoval.rows, [artA]);
  assert.deepEqual(splitRemoval.excludedSourceIndices, []);

  const finalRemoval = removePricingAssistantRow(
    splitRemoval.rows,
    artA.id,
    splitRemoval.excludedSourceIndices,
  );
  assert.equal(finalRemoval.removedKind, "formatter-source");
  assert.deepEqual(finalRemoval.rows, []);
  assert.deepEqual(finalRemoval.excludedSourceIndices, [4]);
});

test("removing a manual pricing row never creates a formatter exclusion", () => {
  const manual = createManualPricingRow(
    "manual-remove-original",
    "manual-remove",
    "Manual Card",
    "Manual Card",
  );
  const removed = removePricingAssistantRow([manual], manual.id, [4]);

  assert.equal(removed.removedKind, "manual");
  assert.deepEqual(removed.rows, []);
  assert.deepEqual(removed.excludedSourceIndices, [4]);
});

test("saved exclusions survive reconciliation while active and manual rows are restored", () => {
  const formatterItems = [
    { index: 1, inputName: "Lightning Bolt", quantity: 1, status: "found", card: { name: "Lightning Bolt" } },
    { index: 2, inputName: "Counterspell", quantity: 1, status: "found", card: { name: "Counterspell" } },
  ];
  const [lightningBolt] = createPricingRowsFromFormatterItems([formatterItems[0]]);
  const manual = createManualPricingRow("manual-restore-original", "manual-restore", "Manual Card", "Manual Card");
  const restored = reconcilePricingRowsWithFormatterItems([lightningBolt, manual], formatterItems, [2]);

  assert.deepEqual(restored.map((row) => row.displayName), ["Lightning Bolt", "Manual Card"]);
  assert.equal(restored.some((row) => row.displayName === "Counterspell"), false);
});

test("a fresh processed-list session clears exclusions and restores every formatter source", () => {
  const formatterItems = [
    { index: 1, inputName: "Lightning Bolt", quantity: 1, status: "found", card: { name: "Lightning Bolt" } },
    { index: 2, inputName: "Counterspell", quantity: 1, status: "found", card: { name: "Counterspell" } },
  ];
  const manual = createManualPricingRow("manual-fresh-original", "manual-fresh", "Manual Card", "Manual Card");
  const fresh = createFreshPricingAssistantSession([manual], formatterItems);

  assert.deepEqual(fresh.excludedSourceIndices, []);
  assert.deepEqual(fresh.rows.map((row) => row.displayName), ["Lightning Bolt", "Counterspell", "Manual Card"]);
});

test("receipt counts and Not Found cards derive only from active Pricing Assistant rows", () => {
  const formatterItems = [
    { index: 1, inputName: "Lightning Bolt", quantity: 1, status: "found", card: { name: "Lightning Bolt" } },
    { index: 2, inputName: "Sol Ring", quantity: 1, status: "found", card: { name: "Sol Ring" } },
    { index: 3, inputName: "Counterspell", quantity: 1, status: "found", card: { name: "Counterspell" } },
  ];
  const rows = createPricingRowsFromFormatterItems(formatterItems)
    .map((row) => row.displayName === "Lightning Bolt" ? { ...row, found: true } : row);
  const counterspell = rows.find((row) => row.displayName === "Counterspell");
  const active = removePricingAssistantRow(rows, counterspell.id, []);
  const summary = pricingReceiptCardSummary(active.rows);

  assert.deepEqual(summary, {
    requestedCount: 2,
    foundCount: 1,
    notFoundCount: 1,
    notFoundCards: [{ cardName: "Sol Ring", quantity: 1 }],
  });
});

test("initializes a lone Borderless Non-Foil printing without inventing Standard", () => {
  const card = {
    name: "Single Borderless",
    printings: [exactFixturePrinting({
      uuid: "single-borderless-uuid",
      setCode: "BOR",
      treatments: ["borderless"],
      tcgplayerProductId: "100002",
    })],
  };
  const found = initializeFoundPricingSelection(freshFormatterPricingRow(card.name), card, "2026-08-21");
  assert.equal(found.finish, "normal");
  assert.equal(found.treatment, "borderless");
  assert.equal(found.selectedPrintingUuid, "single-borderless-uuid");
  assert.equal(pricingPhysicalSelectionIsValid(found, card), true);
  assert.equal(shouldShowPricingVariant(found.found, pricingVariantOptions(card, "BOR", "borderless", "normal")), false);
  assert.equal(readyWarningState(found), "none");
});

test("initializes a lone Extended Art Foil printing and makes it price eligible", () => {
  const card = {
    name: "Single Extended Foil",
    printings: [exactFixturePrinting({
      uuid: "single-extended-foil-uuid",
      setCode: "EXT",
      treatments: ["extended-art"],
      finishes: ["foil"],
      tcgplayerProductId: "100003",
      price: 4.5,
    })],
  };
  const found = initializeFoundPricingSelection(freshFormatterPricingRow(card.name), card, "2026-08-21");
  assert.equal(found.finish, "foil");
  assert.equal(found.foilTreatment, "standard");
  assert.equal(found.treatment, "extended-art");
  assert.equal(found.selectedPrintingUuid, "single-extended-foil-uuid");
  assert.equal(priceForSelection(card, found.setCode, found.treatment, found.finish, "tcgplayer:retail", found.selectedPrintingUuid, found.foilTreatment).status, "ready");
  assert.equal(shouldShowPricingVariant(found.found, pricingVariantOptions(card, "EXT", "extended-art", "foil")), false);
});

test("initializes a Surge-only Borderless printing in the Surge finish bucket", () => {
  const card = {
    name: "Single Borderless Surge",
    printings: [exactFixturePrinting({
      uuid: "single-surge-uuid",
      setCode: "SRG",
      treatments: ["borderless"],
      finishes: ["foil"],
      foilTreatment: "surge",
      tcgplayerProductId: "100004",
    })],
  };
  const found = initializeFoundPricingSelection(freshFormatterPricingRow(card.name), card, "2026-08-21");
  assert.equal(finishChoices(card, "SRG")[0].label, "Surge");
  assert.equal(found.finish, "foil");
  assert.equal(found.foilTreatment, "surge");
  assert.equal(found.treatment, "borderless");
  assert.equal(found.selectedPrintingUuid, "single-surge-uuid");
  assert.equal(matchingPrintings(card, "SRG", "borderless", "foil", "", "standard").length, 0);
  assert.equal(pricingPhysicalSelectionIsValid(found, card), true);
  assert.equal(shouldShowPricingVariant(found.found, pricingVariantOptions(card, "SRG", "borderless", "foil", "surge")), false);
  assert.equal(readyWarningState(found), "none");
});

test("Found initialization preserves a valid requested set over the newest default set", () => {
  const card = {
    name: "Requested Edition",
    printings: [
      exactFixturePrinting({ uuid: "new-edition", setCode: "NEW", releaseDate: "2026-01-01", tcgplayerProductId: "100005" }),
      exactFixturePrinting({ uuid: "requested-edition", setCode: "REQ", releaseDate: "2024-01-01", tcgplayerProductId: "100006" }),
    ],
  };
  const initial = freshFormatterPricingRow(card.name, { setCode: "REQ" });
  const found = initializeFoundPricingSelection(initial, card, "2026-08-21");
  assert.equal(found.setCode, "REQ");
  assert.equal(found.selectedPrintingUuid, "requested-edition");
  assert.equal(tcgplayerProductIdForSelection(card, found.setCode, found.treatment, found.finish, found.selectedPrintingUuid, found.foilTreatment), "100006");
});

test("requested ordinary Foil wins over Non-Foil and remains distinct from Surge", () => {
  const card = {
    name: "Requested Foil",
    printings: [
      exactFixturePrinting({ uuid: "requested-normal", setCode: "RQF", finishes: ["normal"], number: "1" }),
      exactFixturePrinting({ uuid: "requested-foil", setCode: "RQF", finishes: ["foil"], number: "2", tcgplayerProductId: "100007" }),
      exactFixturePrinting({ uuid: "requested-surge", setCode: "RQF", finishes: ["foil"], foilTreatment: "surge", number: "3", tcgplayerProductId: "100008" }),
    ],
  };
  const initial = freshFormatterPricingRow(card.name, { setCode: "RQF", finish: "foil" });
  const found = initializeFoundPricingSelection(initial, card, "2026-08-21");
  assert.equal(found.finish, "foil");
  assert.equal(found.foilTreatment, "standard");
  assert.equal(found.selectedPrintingUuid, "requested-foil");
  assert.deepEqual(matchingPrintings(card, "RQF", "standard", "foil", "", "standard").map((printing) => printing.uuid), ["requested-foil"]);
  assert.deepEqual(matchingPrintings(card, "RQF", "standard", "foil", "", "surge").map((printing) => printing.uuid), ["requested-surge"]);
});

test("requested Treatment moves an incompatible requested Finish to a real combination", () => {
  const card = {
    name: "Requested Treatment Conflict",
    printings: [
      exactFixturePrinting({ uuid: "normal-standard", setCode: "RTC", finishes: ["normal"], treatments: ["standard"] }),
      exactFixturePrinting({ uuid: "foil-retro", setCode: "RTC", finishes: ["foil"], treatments: ["retro"] }),
    ],
  };
  const initial = freshFormatterPricingRow(card.name, {
    setCode: "RTC",
    finish: "normal",
    treatment: "retro",
  });
  const found = initializeFoundPricingSelection(initial, card, "2026-08-21");
  assert.equal(found.finish, "foil");
  assert.equal(found.treatment, "retro");
  assert.equal(found.selectedPrintingUuid, "foil-retro");
  assert.equal(pricingPhysicalSelectionIsValid(found, card), true);
});

test("resolves an MSC-like preselected set with one physical printing", () => {
  const card = {
    name: "MSC-Like Bolt",
    printings: [
      exactFixturePrinting({ uuid: "msc-only-uuid", setCode: "MSC", setName: "Marvel Super Heroes Commander", tcgplayerProductId: "100009", price: 3.25 }),
      exactFixturePrinting({ uuid: "newer-other-uuid", setCode: "OTH", releaseDate: "2026-01-01", tcgplayerProductId: "100010" }),
    ],
  };
  const initial = { ...freshFormatterPricingRow(card.name), setCode: "MSC" };
  const found = initializeFoundPricingSelection(initial, card, "2026-08-21");
  const variants = pricingVariantOptions(card, found.setCode, found.treatment, found.finish, found.foilTreatment);
  assert.equal(found.setCode, "MSC");
  assert.equal(found.selectedPrintingUuid, "msc-only-uuid");
  assert.equal(tcgplayerProductIdForSelection(card, found.setCode, found.treatment, found.finish, found.selectedPrintingUuid, found.foilTreatment), "100009");
  assert.equal(priceForSelection(card, found.setCode, found.treatment, found.finish, "tcgplayer:retail", found.selectedPrintingUuid, found.foilTreatment).status, "ready");
  assert.equal(shouldShowPricingVariant(found.found, variants), false);
  assert.equal(readyWarningState(found), "none");
});

test("reinitializes a stale Scryfall exact ID to the lone MTGJSON UUID", () => {
  const name = "Hydration Identity Swap";
  const scryfallCard = {
    name,
    printings: [exactFixturePrinting({ uuid: "scryfall-id", setCode: "HYD", tcgplayerProductId: "100011" })],
  };
  const beforeHydration = initializeFoundPricingSelection(freshFormatterPricingRow(name), scryfallCard, "2026-08-21");
  assert.equal(beforeHydration.selectedPrintingUuid, "scryfall-id");

  const mtgjsonCard = {
    name,
    printings: [exactFixturePrinting({ uuid: "mtgjson-uuid", setCode: "HYD", tcgplayerProductId: "100011" })],
  };
  assert.equal(pricingPhysicalSelectionIsValid(beforeHydration, mtgjsonCard), false);
  const afterHydration = initializePricingRowSelection(beforeHydration, mtgjsonCard, "2026-08-21");
  assert.equal(afterHydration.selectedPrintingUuid, "mtgjson-uuid");
  assert.equal(pricingPhysicalSelectionIsValid(afterHydration, mtgjsonCard), true);
  assert.equal(readyWarningState(afterHydration), "none");
});

test("keeps loading separate from valid, ambiguous, and unavailable warning states", () => {
  const baseState = {
    resolved: true,
    found: true,
    catalogState: "ready",
    hydrating: false,
    automaticStatus: "ready",
    priceValid: false,
  };
  assert.equal(pricingRowWarningState({ ...baseState, catalogState: "loading" }), "loading");
  assert.equal(pricingRowWarningState({ ...baseState, hydrating: true }), "loading");
  assert.equal(pricingRowWarningState({ ...baseState, automaticStatus: "loading" }), "loading");
  assert.equal(pricingRowWarningState({ ...baseState, priceValid: true }), "none");
  assert.equal(pricingRowWarningState({ ...baseState, automaticStatus: "ambiguous" }), "ambiguous");
  assert.equal(pricingRowWarningState({ ...baseState, automaticStatus: "unavailable" }), "unavailable");
  assert.equal(pricingRowWarningState({ ...baseState, found: false, automaticStatus: "unavailable" }), "none");
  assert.equal(pricingRowWarningState({ ...baseState, resolved: false }), "unavailable");
});

test("manual rows use the same Found initialization pipeline", () => {
  const card = {
    name: "Manual Pipeline Card",
    printings: [exactFixturePrinting({
      uuid: "manual-borderless-uuid",
      setCode: "MAN",
      treatments: ["borderless"],
      tcgplayerProductId: "100012",
    })],
  };
  const initial = createManualPricingRow("manual-pipeline-original", "manual-pipeline", card.name, card.name);
  const found = initializeFoundPricingSelection(initial, card, "2026-08-21");
  assert.equal(found.manuallyCreated, true);
  assert.equal(found.found, true);
  assert.equal(found.setCode, "MAN");
  assert.equal(found.treatment, "borderless");
  assert.equal(found.selectedPrintingUuid, "manual-borderless-uuid");
  assert.equal(pricingPhysicalSelectionIsValid(found, card), true);
});

test("switches from two ordinary Foil arts to one auto-selected Surge art", () => {
  const card = {
    name: "Finish Art Transition",
    printings: [
      exactFixturePrinting({ uuid: "ordinary-art-one", setCode: "FAT", finishes: ["foil"], treatments: ["borderless"], number: "1" }),
      exactFixturePrinting({ uuid: "ordinary-art-two", setCode: "FAT", finishes: ["foil"], treatments: ["borderless"], number: "2" }),
      exactFixturePrinting({ uuid: "surge-art-only", setCode: "FAT", finishes: ["foil"], foilTreatment: "surge", treatments: ["borderless"], number: "3" }),
    ],
  };
  const ordinary = initializeFoundPricingSelection(freshFormatterPricingRow(card.name), card, "2026-08-21");
  const ordinaryVariants = pricingVariantOptions(card, "FAT", "borderless", "foil", "standard");
  assert.equal(ordinary.foilTreatment, "standard");
  assert.equal(ordinary.selectedPrintingUuid, "");
  assert.deepEqual(ordinaryVariants.map((variant) => variant.uuid), ["ordinary-art-one", "ordinary-art-two"]);
  assert.equal(shouldShowPricingVariant(ordinary.found, ordinaryVariants), true);

  const surge = initializePricingRowSelection({
    ...ordinary,
    finish: "foil",
    foilTreatment: "surge",
    treatment: "borderless",
    selectedPrintingUuid: "",
  }, card, "2026-08-21");
  const surgeVariants = pricingVariantOptions(card, "FAT", "borderless", "foil", "surge");
  assert.equal(surge.foilTreatment, "surge");
  assert.equal(surge.selectedPrintingUuid, "surge-art-only");
  assert.deepEqual(surgeVariants.map((variant) => variant.uuid), ["surge-art-only"]);
  assert.equal(shouldShowPricingVariant(surge.found, surgeVariants), false);
});

test("normalizes card names and assigns stable pricing shards", () => {
  assert.equal(pricingNameKey("  Éowyn, Shieldmaiden  "), "eowyn shieldmaiden");
  assert.equal(pricingShardKey("Éowyn, Shieldmaiden"), "e");
  assert.equal(pricingShardKey("'Ach! Hans, Run!"), "a");
});

test("sorts printing choices newest to oldest", () => {
  const card = {
    name: "Dark Confidant",
    printings: [
      basePrinting,
      { ...basePrinting, uuid: "2xm-dark-confidant", setCode: "2XM", setName: "Double Masters", keyruneCode: "2xm", releaseDate: "2020-08-07" },
    ],
  };
  assert.deepEqual(editionOptions(card).map((edition) => edition.setCode), ["2XM", "RAV"]);
});

test("searches normal Printing editions by ranked set code and set name", () => {
  const editions = [
    { setCode: "MKM", setName: "Murders at Karlov Manor", keyruneCode: "mkm", releaseDate: "2024-02-09" },
    { setCode: "RVR", setName: "Ravnica Remastered", keyruneCode: "rvr", releaseDate: "2024-01-12" },
    { setCode: "PLST", setName: "The List", keyruneCode: "plst", releaseDate: "2023-09-08" },
    { setCode: "P10", setName: "Magic Player Rewards 2010", keyruneCode: "p10", releaseDate: "2010-01-01" },
    { setCode: "MPR", setName: "Magic Player Rewards", keyruneCode: "mpr", releaseDate: "2001-01-01" },
  ];

  assert.equal(searchEditionOptions(editions, "  "), editions);
  assert.deepEqual(searchEditionOptions(editions, "p10").map((edition) => edition.setCode), ["P10"]);
  assert.deepEqual(searchEditionOptions(editions, "P1").map((edition) => edition.setCode), ["P10"]);
  assert.deepEqual(searchEditionOptions(editions, "ravnica remastered").map((edition) => edition.setCode), ["RVR"]);
  assert.deepEqual(searchEditionOptions(editions, "karlov").map((edition) => edition.setCode), ["MKM"]);
  assert.deepEqual(searchEditionOptions(editions, "player rewards").map((edition) => edition.setCode), ["P10", "MPR"]);
  assert.deepEqual(searchEditionOptions(editions, "ravnica missing"), []);
  assert.deepEqual(searchEditionOptions(editions, "no such set"), []);
});

test("normal Printing search ranks exact code, code prefix, name prefix, and name contains deterministically", () => {
  const editions = [
    { setCode: "OLD", setName: "P10 Archive", keyruneCode: "old", releaseDate: "2026-01-01" },
    { setCode: "P10X", setName: "Promo Ten Extras", keyruneCode: "p10x", releaseDate: "2025-01-01" },
    { setCode: "P10", setName: "Magic Player Rewards 2010", keyruneCode: "p10", releaseDate: "2010-01-01" },
    { setCode: "TEN", setName: "P10 Remastered", keyruneCode: "ten", releaseDate: "2009-01-01" },
  ];
  assert.deepEqual(searchEditionOptions(editions, "p10").map((edition) => edition.setCode), ["P10", "P10X", "OLD", "TEN"]);

  const tied = [
    { setCode: "NEW", setName: "Magic Newest", keyruneCode: "new", releaseDate: "2026-01-01" },
    { setCode: "OLD", setName: "Magic Oldest", keyruneCode: "old", releaseDate: "2001-01-01" },
  ];
  assert.deepEqual(searchEditionOptions(tied, "magic").map((edition) => edition.setCode), ["NEW", "OLD"]);
});

test("a searched normal Printing result still uses manual set-selection semantics", () => {
  const card = {
    name: "Searchable Set Card",
    printings: [
      exactFixturePrinting({ uuid: "old-surge", setCode: "OLD", finishes: ["foil"], foilTreatment: "surge", treatments: ["borderless"] }),
      { ...exactFixturePrinting({ uuid: "p10-normal", setCode: "P10", finishes: ["normal"], treatments: ["standard"] }), setName: "Magic Player Rewards 2010" },
    ],
  };
  const row = initializeFoundPricingSelection(freshFormatterPricingRow(card.name, {
    setCode: "OLD",
    finish: "foil",
    foilTreatment: "surge",
    treatment: "borderless",
  }), card, "2026-08-30");
  const match = searchEditionOptions(editionOptions(card), "p10")[0];
  const selected = selectManualPricingSet(row, card, match.setCode);
  assert.deepEqual(
    {
      setCode: selected.setCode,
      setSelectionSource: selected.setSelectionSource,
      finish: selected.finish,
      foilTreatment: selected.foilTreatment,
      treatment: selected.treatment,
      selectedPrintingUuid: selected.selectedPrintingUuid,
    },
    {
      setCode: "P10",
      setSelectionSource: "manual",
      finish: "normal",
      foilTreatment: "standard",
      treatment: "standard",
      selectedPrintingUuid: "p10-normal",
    },
  );
});

test("defaults to the newest printing that is not a Secret Lair", () => {
  const card = {
    name: "Dark Confidant",
    printings: [
      basePrinting,
      { ...basePrinting, uuid: "sld-dark-confidant", setCode: "SLD", setName: "Secret Lair Drop", releaseDate: "2026-01-01" },
      { ...basePrinting, uuid: "2xm-dark-confidant", setCode: "2XM", setName: "Double Masters", releaseDate: "2020-08-07" },
    ],
  };
  assert.equal(preferredDefaultEdition(card, "2026-08-16").setCode, "2XM");
});

test("does not default to an announced printing before its release date", () => {
  const card = {
    name: "Godless Shrine",
    printings: [
      { ...basePrinting, uuid: "eoe-godless-shrine", setCode: "EOE", setName: "Edge of Eternities", releaseDate: "2025-08-01" },
      { ...basePrinting, uuid: "trK-godless-shrine", setCode: "TRK", setName: "Star Trek", releaseDate: "2026-11-06" },
    ],
  };
  assert.equal(preferredDefaultEdition(card, "2026-08-16").setCode, "EOE");
  assert.equal(preferredDefaultEdition(card, "2026-11-06").setCode, "TRK");
});

test("leaves the default empty when every known printing is unreleased", () => {
  const card = {
    name: "Future Card",
    printings: [
      { ...basePrinting, uuid: "future-card", setCode: "FTR", setName: "Future Set", releaseDate: "2027-01-01" },
    ],
  };
  assert.equal(preferredDefaultEdition(card, "2026-08-16"), null);
});

test("builds a generic TCGplayer Magic search for manual price lookup", () => {
  assert.equal(
    tcgplayerCardSearchUrl("Crop Rotation"),
    "https://www.tcgplayer.com/search/magic/product?productLineName=magic&q=Crop%20Rotation&view=grid",
  );
  assert.equal(
    tcgplayerCardSearchUrl("Sol Ring", "Marvel Super Heroes Commander"),
    "https://www.tcgplayer.com/search/magic/product?productLineName=magic&q=Sol%20Ring%20Marvel%20Super%20Heroes%20Commander&view=grid",
  );
  assert.equal(
    tcgplayerCardSearchUrl("Putrefy", "RVR"),
    "https://www.tcgplayer.com/search/magic/product?productLineName=magic&q=Putrefy%20RVR&view=grid",
  );
  assert.equal(setSearchTerm("PLST", "The List"), "List");
  assert.equal(
    tcgplayerCardSearchUrl("Goblin Game", "PLST", "The List"),
    "https://www.tcgplayer.com/search/magic/product?productLineName=magic&q=Goblin%20Game%20List&view=grid",
  );
});

test("defaults variant-only printings to a real treatment instead of Standard", () => {
  const card = {
    name: "Umezawa's Jitte",
    printings: [{
      ...basePrinting,
      setCode: "PZA",
      treatments: ["full-art", "borderless"],
      tcgplayerProductId: "679213",
    }],
  };
  assert.deepEqual(treatmentOptions(card, "PZA"), ["borderless", "full-art"]);
  assert.equal(preferredDefaultTreatment(card, "PZA"), "borderless");
  assert.equal(tcgplayerProductIdForSelection(card, "PZA", "borderless", "normal"), "679213");
});

test("prefers valid requested set, treatment, and foil defaults without inventing combinations", () => {
  const card = {
    name: "Putrefy",
    printings: [
      { ...basePrinting, uuid: "rvr-standard", setCode: "RVR", treatments: ["standard"], finishes: ["normal", "foil"] },
      { ...basePrinting, uuid: "rvr-retro", setCode: "RVR", number: "378", treatments: ["retro"], finishes: ["foil"] },
    ],
  };
  assert.deepEqual(
    preferredPrintingSelection(card, { setCode: "RVR", treatment: "retro", finish: "foil" }, "2026-08-21"),
    { setCode: "RVR", treatment: "retro", finish: "foil", foilTreatment: "standard" },
  );
  assert.deepEqual(
    preferredPrintingSelection(card, { setCode: "RVR", treatment: "retro", finish: "normal" }, "2026-08-21"),
    { setCode: "RVR", treatment: "retro", finish: "foil", foilTreatment: "standard" },
  );
});

test("keeps Ravnica Remastered Putrefy regular and retro products separate", () => {
  const card = {
    name: "Putrefy",
    printings: [
      {
        ...basePrinting,
        uuid: "rvr-212",
        setCode: "RVR",
        number: "212",
        tcgplayerProductId: "531100",
        treatments: ["standard"],
      },
      {
        ...basePrinting,
        uuid: "rvr-378",
        setCode: "RVR",
        number: "378",
        tcgplayerProductId: "531255",
        treatments: ["retro"],
      },
    ],
  };
  assert.deepEqual(treatmentOptions(card, "RVR"), ["standard", "retro"]);
  assert.equal(tcgplayerProductIdForSelection(card, "RVR", "standard", "normal"), "531100");
  assert.equal(tcgplayerProductIdForSelection(card, "RVR", "retro", "normal"), "531255");
});

test("requires a printing and returns the indexed retail price", () => {
  const card = { name: "Dark Confidant", printings: [basePrinting] };
  assert.equal(priceForSelection(card, "", "standard", "normal").status, "select-printing");
  assert.deepEqual(priceForSelection(card, "RAV", "standard", "normal"), {
    status: "ready",
    price: 4.65,
    source: "tcgplayer:retail",
    message: "MTGJSON · TCGplayer Retail",
  });
  assert.equal(priceForSelection(card, "RAV", "standard", "foil", "cardkingdom:retail").source, "cardkingdom:retail");
  assert.equal(priceForSelection(card, "RAV", "standard", "normal", "cardkingdom:retail").price, 5);
  assert.equal(priceForSelection(card, "RAV", "standard", "normal", "cardmarket:retail").price, 4.25);
  assert.equal(priceCurrencySymbol("EUR"), "€");
});

test("leaves conflicting collector variants blank for manual pricing", () => {
  const card = {
    name: "Example",
    printings: [
      basePrinting,
      {
        ...basePrinting,
        uuid: "alternate",
        number: "81a",
        prices: { normal: { value: 5.25, source: "tcgplayer" } },
        priceListings: { normal: { "tcgplayer:retail": { value: 5.25, source: "tcgplayer:retail", currency: "USD" } } },
      },
    ],
  };
  const selection = priceForSelection(card, "RAV", "standard", "normal");
  assert.equal(selection.status, "ambiguous");
  assert.equal(selection.price, null);
  const exactSelection = priceForSelection(card, "RAV", "standard", "normal", "tcgplayer:retail", "alternate");
  assert.equal(exactSelection.status, "ready");
  assert.equal(exactSelection.price, 5.25);
});

test("auto-selects a unique exact printing but keeps multiple art variants unselected", () => {
  const card = {
    name: "Sol Ring",
    printings: [
      { ...basePrinting, uuid: "who-123", setCode: "WHO", number: "123", finishes: ["foil"] },
      { ...basePrinting, uuid: "who-124", setCode: "WHO", number: "124", finishes: ["foil"] },
      { ...basePrinting, uuid: "who-125", setCode: "WHO", number: "125", treatments: ["retro"], finishes: ["foil"] },
    ],
  };
  assert.equal(exactPrintingUuidForSelection(card, "WHO", "standard", "foil"), "");
  assert.equal(exactPrintingUuidForSelection(card, "WHO", "retro", "foil", "who-123"), "who-125");
  assert.deepEqual(
    pricingVariantOptions(card, "WHO", "standard", "foil").map((option) => option.label),
    ["#123", "#124"],
  );
  assert.equal(pricingVariantOptions(card, "WHO", "retro", "foil").length, 1);
});

test("flavor-name requests retain a canonical lookup and choose an exact reskin printing", () => {
  const card = {
    name: "Umezawa's Jitte",
    printings: [
      { ...basePrinting, uuid: "bok-jitte", setCode: "BOK", releaseDate: "2005-02-04", tcgplayerProductId: "12222" },
      {
        ...basePrinting,
        uuid: "23019946-c268-5db6-b77b-5edaf3b073d0",
        setCode: "PZA",
        setName: "Teenage Mutant Ninja Turtles Source Material",
        keyruneCode: "pza",
        number: "19",
        releaseDate: "2026-03-06",
        flavorName: "Raph's Jitte",
        treatments: ["borderless"],
        finishes: ["normal", "foil"],
        tcgplayerProductId: "679213",
      },
    ],
  };
  const preference = preferredPrintingSelection(card, { flavorName: "Raph's Jitte" }, "2026-08-21");
  assert.deepEqual(preference, { setCode: "PZA", treatment: "borderless", finish: "normal", foilTreatment: "standard" });
  assert.equal(exactPrintingUuidForSelection(card, "PZA", "borderless", "normal", "", "Raph's Jitte"), "23019946-c268-5db6-b77b-5edaf3b073d0");
  assert.equal(tcgplayerProductIdForSelection(card, "PZA", "borderless", "normal", "23019946-c268-5db6-b77b-5edaf3b073d0"), "679213");
  const row = normalizePricingAssistantRow({ displayName: "Raph's Jitte", canonicalName: "Umezawa's Jitte" });
  assert.equal(row.displayName, "Raph's Jitte");
  assert.equal(row.canonicalName, "Umezawa's Jitte");
});

test("a manual set change releases reskin defaults and reprices the canonical card", () => {
  const card = {
    name: "Umezawa's Jitte",
    printings: [
      {
        ...exactFixturePrinting({
          uuid: "bok-jitte",
          setCode: "BOK",
          number: "163",
          tcgplayerProductId: "12222",
          price: 8.5,
        }),
      },
      {
        ...exactFixturePrinting({
          uuid: "v16-jitte",
          setCode: "V16",
          number: "14",
          tcgplayerProductId: "31234",
          price: 9.25,
        }),
      },
      {
        ...exactFixturePrinting({
          uuid: "pza-raph-jitte",
          setCode: "PZA",
          number: "19",
          treatments: ["borderless"],
          tcgplayerProductId: "679213",
          price: 12.5,
        }),
        flavorName: "Raph's Jitte",
      },
    ],
  };
  const initial = createPricingRowsFromFormatterItems([{
    index: 0,
    quantity: 1,
    inputName: "Raph's Jitte",
    status: "found",
    alternateTitle: "Raph's Jitte",
    card: { name: "Umezawa's Jitte" },
  }])[0];
  const pza = initializeFoundPricingSelection(initial, card, "2026-08-21");
  assert.deepEqual(
    { setCode: pza.setCode, finish: pza.finish, treatment: pza.treatment, selectedPrintingUuid: pza.selectedPrintingUuid },
    { setCode: "PZA", finish: "normal", treatment: "borderless", selectedPrintingUuid: "pza-raph-jitte" },
  );

  const bok = selectManualPricingSet(pza, card, "BOK");
  assert.equal(bok.displayName, "Raph's Jitte");
  assert.equal(bok.canonicalName, "Umezawa's Jitte");
  assert.equal(bok.setSelectionSource, "manual");
  assert.deepEqual(
    { setCode: bok.setCode, finish: bok.finish, foilTreatment: bok.foilTreatment, treatment: bok.treatment, selectedPrintingUuid: bok.selectedPrintingUuid },
    { setCode: "BOK", finish: "normal", foilTreatment: "standard", treatment: "standard", selectedPrintingUuid: "bok-jitte" },
  );
  assert.equal(tcgplayerProductIdForSelection(card, bok.setCode, bok.treatment, bok.finish, bok.selectedPrintingUuid, bok.foilTreatment), "12222");
  assert.equal(priceForSelection(card, bok.setCode, bok.treatment, bok.finish, "tcgplayer:retail", bok.selectedPrintingUuid, bok.foilTreatment).price, 8.5);
  // Live pricing hydration reuses the initializer; it must not snap back to PZA.
  assert.equal(initializePricingRowSelection(bok, card, "2026-08-21").setCode, "BOK");

  const v16 = selectManualPricingSet(bok, card, "V16");
  assert.deepEqual(
    { setCode: v16.setCode, finish: v16.finish, treatment: v16.treatment, selectedPrintingUuid: v16.selectedPrintingUuid },
    { setCode: "V16", finish: "normal", treatment: "standard", selectedPrintingUuid: "v16-jitte" },
  );
});

test("manual set changes reset old Surge and art identity for ordinary cards too", () => {
  const card = {
    name: "Generic Set Switch",
    printings: [
      exactFixturePrinting({ uuid: "surge-art", setCode: "OLD", finishes: ["foil"], foilTreatment: "surge", treatments: ["borderless"], number: "99" }),
      exactFixturePrinting({ uuid: "new-standard", setCode: "NEW", finishes: ["normal", "foil"], treatments: ["standard"], number: "1" }),
    ],
  };
  const old = initializeFoundPricingSelection(freshFormatterPricingRow(card.name, {
    setCode: "OLD",
    finish: "foil",
    foilTreatment: "surge",
    treatment: "borderless",
  }), card, "2026-08-21");
  assert.equal(old.selectedPrintingUuid, "surge-art");
  const changed = selectManualPricingSet(old, card, "NEW");
  assert.deepEqual(
    { setCode: changed.setCode, finish: changed.finish, foilTreatment: changed.foilTreatment, treatment: changed.treatment, selectedPrintingUuid: changed.selectedPrintingUuid },
    { setCode: "NEW", finish: "normal", foilTreatment: "standard", treatment: "standard", selectedPrintingUuid: "new-standard" },
  );
  assert.equal(shouldShowPricingVariant(changed.found, pricingVariantOptions(card, changed.setCode, changed.treatment, changed.finish, changed.foilTreatment)), false);
});

test("models Surge as a foil technology independent of visual treatment", () => {
  const card = {
    name: "Example",
    printings: [
      { ...basePrinting, uuid: "fic-standard", setCode: "FIC", finishes: ["foil"], tcgplayerProductId: "631171" },
      { ...basePrinting, uuid: "fic-surge", setCode: "FIC", treatments: ["standard"], foilTreatment: "surge", finishes: ["foil"], tcgplayerProductId: "631172" },
    ],
  };
  assert.deepEqual(finishChoices(card, "FIC", "standard"), [
    { key: "foil", label: "Foil", finish: "foil", foilTreatment: "standard" },
    { key: "surge", label: "Surge", finish: "foil", foilTreatment: "surge" },
  ]);
  assert.deepEqual(treatmentOptions(card, "FIC"), ["standard"]);
  assert.equal(tcgplayerProductIdForSelection(card, "FIC", "standard", "foil", "", "surge"), "631172");
  assert.equal(finishChoices({ name: "Plain", printings: [{ ...basePrinting, setCode: "PLN" }] }, "PLN", "standard").some((choice) => choice.label === "Surge"), false);
});

test("rejects pricing catalogs older than the current physical-treatment model", () => {
  assert.equal(pricingIndexSupportsPhysicalDimensions(3), false);
  assert.equal(pricingIndexSupportsPhysicalDimensions(undefined), false);
  assert.equal(pricingIndexSupportsPhysicalDimensions(4), false);
  assert.equal(pricingIndexSupportsPhysicalDimensions(5), false);
  assert.equal(pricingIndexSupportsPhysicalDimensions(6), true);
});

test("never places one Surge UUID in another effective Finish bucket", () => {
  const providerOverlap = {
    ...basePrinting,
    uuid: "provider-overlap",
    finishes: ["normal", "foil"],
    foilTreatment: "surge",
  };
  assert.equal(printingMatchesFinishChoice(providerOverlap, "normal"), false);
  assert.equal(printingMatchesFinishChoice(providerOverlap, "foil", "standard"), false);
  assert.equal(printingMatchesFinishChoice(providerOverlap, "foil", "surge"), true);
});

test("groups art choices after foil technology and visual treatment are applied", () => {
  const card = {
    name: "Fixture",
    printings: [
      { ...basePrinting, uuid: "317-foil", setCode: "FIN", number: "317", treatments: ["borderless"], finishes: ["foil"], foilTreatment: "standard", tcgplayerProductId: "317f" },
      { ...basePrinting, uuid: "317-surge", setCode: "FIN", number: "317", treatments: ["borderless"], finishes: ["foil"], foilTreatment: "surge", tcgplayerProductId: "317s" },
      { ...basePrinting, uuid: "382-foil", setCode: "FIN", number: "382", treatments: ["borderless"], finishes: ["foil"], foilTreatment: "standard", tcgplayerProductId: "382f" },
      { ...basePrinting, uuid: "382-surge", setCode: "FIN", number: "382", treatments: ["borderless"], finishes: ["foil"], foilTreatment: "surge", tcgplayerProductId: "382s" },
    ],
  };
  assert.deepEqual(pricingVariantOptions(card, "FIN", "borderless", "foil", "standard").map((option) => option.label), ["#317", "#382"]);
  assert.deepEqual(pricingVariantOptions(card, "FIN", "borderless", "foil", "surge").map((option) => option.label), ["#317", "#382"]);
  assert.equal(exactPrintingUuidForSelection(card, "FIN", "borderless", "foil", "317-surge", "", "surge"), "317-surge");
  assert.equal(exactPrintingUuidForSelection(card, "FIN", "borderless", "foil", "317-surge", "", "standard"), "");
});

test("runs the mandatory FIN Finish -> Treatment -> Art -> UUID pipeline with mutually exclusive foil buckets", () => {
  assert.deepEqual(finishChoices(surgeArtFixture, "FIN").map((choice) => choice.label), ["Foil", "Surge"]);
  assert.deepEqual(
    preferredPrintingSelection(surgeArtFixture, {
      setCode: "FIN",
      finish: "foil",
      foilTreatment: "surge",
      treatment: "borderless",
    }, "2026-08-21"),
    { setCode: "FIN", finish: "foil", foilTreatment: "surge", treatment: "borderless" },
  );

  const ordinaryTreatments = compatibleTreatmentOptions(surgeArtFixture, "FIN", "foil", "standard");
  assert.deepEqual(ordinaryTreatments, ["borderless"]);
  assert.deepEqual(
    matchingPrintings(surgeArtFixture, "FIN", "borderless", "foil", "", "standard").map((printing) => printing.uuid),
    ["UUID-A", "UUID-C"],
  );
  assert.deepEqual(
    pricingVariantOptions(surgeArtFixture, "FIN", "borderless", "foil", "standard").map((option) => option.label),
    ["#317", "#382"],
  );

  const surgeTreatments = compatibleTreatmentOptions(surgeArtFixture, "FIN", "foil", "surge");
  assert.deepEqual(surgeTreatments, ["borderless"]);
  assert.deepEqual(
    matchingPrintings(surgeArtFixture, "FIN", "borderless", "foil", "", "surge").map((printing) => printing.uuid),
    ["UUID-B", "UUID-D"],
  );
  assert.deepEqual(
    pricingVariantOptions(surgeArtFixture, "FIN", "borderless", "foil", "surge").map((option) => option.label),
    ["#317", "#382"],
  );
  assert.equal(tcgplayerProductIdForSelection(surgeArtFixture, "FIN", "borderless", "foil", "UUID-D", "surge"), "382s");
});

test("auto-selects a lone Surge art and keeps Art / Variant hidden", () => {
  const card = { name: "One Surge", printings: surgeArtFixture.printings.slice(0, 2) };
  const selection = normalizePricingPhysicalSelection(card, {
    setCode: "FIN",
    finish: "foil",
    foilTreatment: "surge",
    treatment: "standard",
    selectedPrintingUuid: "",
  });
  assert.deepEqual(selection, {
    setCode: "FIN",
    finish: "foil",
    foilTreatment: "surge",
    treatment: "borderless",
    selectedPrintingUuid: "UUID-B",
  });
  assert.equal(shouldShowPricingVariant(true, pricingVariantOptions(card, "FIN", "borderless", "foil", "surge")), false);
});

test("normalizes Finish switches and a stale Art selection without mutating card identity", () => {
  const switchedToFoil = normalizePricingPhysicalSelection(surgeArtFixture, {
    setCode: "FIN",
    finish: "foil",
    foilTreatment: "standard",
    treatment: "borderless",
    selectedPrintingUuid: "UUID-B",
  });
  assert.equal(switchedToFoil.selectedPrintingUuid, "");
  assert.equal(switchedToFoil.foilTreatment, "standard");

  const switchedToSurge = normalizePricingPhysicalSelection(surgeArtFixture, {
    setCode: "FIN",
    finish: "foil",
    foilTreatment: "surge",
    treatment: "borderless",
    selectedPrintingUuid: "UUID-A",
  });
  assert.equal(switchedToSurge.selectedPrintingUuid, "");
  assert.equal(switchedToSurge.foilTreatment, "surge");

  const loneSurgeCard = { name: "Identity Stays Put", printings: surgeArtFixture.printings.slice(0, 2) };
  const row = {
    displayName: "Raph's Jitte",
    canonicalName: "Umezawa's Jitte",
    setCode: "FIN",
    finish: "foil",
    foilTreatment: "standard",
    treatment: "borderless",
    selectedPrintingUuid: "UUID-A",
  };
  const defensiveSelection = pricingSelectionForPrintingUuid(loneSurgeCard, row, "UUID-B");
  const nextRow = { ...row, ...defensiveSelection };
  assert.equal(nextRow.finish, "foil");
  assert.equal(nextRow.foilTreatment, "surge");
  assert.equal(nextRow.treatment, "borderless");
  assert.equal(nextRow.selectedPrintingUuid, "UUID-B");
  assert.equal(nextRow.displayName, "Raph's Jitte");
  assert.equal(nextRow.canonicalName, "Umezawa's Jitte");
  assert.equal(shouldShowPricingVariant(true, pricingVariantOptions(loneSurgeCard, "FIN", "borderless", "foil", "surge")), false);
});

test("derives Treatment choices only from exact Card + Set + effective Finish candidates", () => {
  assert.deepEqual(compatibleTreatmentOptions(treatmentAvailabilityFixture, "TST", "normal"), ["standard", "borderless"]);
  assert.deepEqual(compatibleTreatmentOptions(treatmentAvailabilityFixture, "TST", "foil", "standard"), ["standard", "extended-art"]);
  assert.deepEqual(compatibleTreatmentOptions(treatmentAvailabilityFixture, "TST", "foil", "surge"), ["borderless"]);

  const cases = [
    { card: { name: "Borderless Only Test", printings: [{ ...basePrinting, uuid: "ABC-1", setCode: "ABC", treatments: ["borderless"], finishes: ["foil"] }] }, setCode: "ABC", expected: ["borderless"] },
    { card: { name: "Extended Only Test", printings: [{ ...basePrinting, uuid: "XYZ-1", setCode: "XYZ", treatments: ["extended-art"], finishes: ["foil"] }] }, setCode: "XYZ", expected: ["extended-art"] },
    { card: { name: "Both Treatments Test", printings: [
      { ...basePrinting, uuid: "BOT-A", setCode: "BOT", treatments: ["borderless"], finishes: ["foil"] },
      { ...basePrinting, uuid: "BOT-B", setCode: "BOT", treatments: ["extended-art"], finishes: ["foil"] },
    ] }, setCode: "BOT", expected: ["borderless", "extended-art"] },
  ];
  cases.forEach(({ card, setCode, expected }) => {
    const options = compatibleTreatmentOptions(card, setCode, "foil", "standard");
    assert.deepEqual(options, expected);
    options.forEach((treatment) => {
      assert.ok(matchingPrintings(card, setCode, treatment, "foil", "", "standard").length > 0);
    });
  });
});

test("changing Treatment recalculates exact UUID and human Art options", () => {
  const standard = normalizePricingPhysicalSelection(treatmentAvailabilityFixture, {
    setCode: "TST",
    finish: "foil",
    foilTreatment: "standard",
    treatment: "standard",
    selectedPrintingUuid: "UUID-3",
  });
  const extended = normalizePricingPhysicalSelection(treatmentAvailabilityFixture, {
    ...standard,
    treatment: "extended-art",
  });
  assert.equal(extended.selectedPrintingUuid, "UUID-4");
  assert.equal(pricingVariantOptions(treatmentAvailabilityFixture, "TST", "extended-art", "foil", "standard").length, 1);
  assert.equal(shouldShowPricingVariant(true, pricingVariantOptions(treatmentAvailabilityFixture, "TST", "extended-art", "foil", "standard")), false);
});

test("normalizes Surge transitions to Non-Foil, Foil, and Etched physical pools", () => {
  const card = {
    name: "Finish Transition Test",
    printings: [
      { ...basePrinting, uuid: "transition-normal", setCode: "TRN", treatments: ["standard"], finishes: ["normal"] },
      { ...basePrinting, uuid: "transition-foil", setCode: "TRN", treatments: ["extended-art"], finishes: ["foil"], foilTreatment: "standard" },
      { ...basePrinting, uuid: "transition-surge", setCode: "TRN", treatments: ["borderless"], finishes: ["foil"], foilTreatment: "surge" },
      { ...basePrinting, uuid: "transition-etched", setCode: "TRN", treatments: ["showcase"], finishes: ["etched"] },
    ],
  };
  const transitions = [
    { finish: "normal", foilTreatment: "standard", treatment: "standard", uuid: "transition-normal" },
    { finish: "foil", foilTreatment: "standard", treatment: "extended-art", uuid: "transition-foil" },
    { finish: "etched", foilTreatment: "standard", treatment: "showcase", uuid: "transition-etched" },
  ];
  transitions.forEach((expected) => {
    const selection = normalizePricingPhysicalSelection(card, {
      setCode: "TRN",
      finish: expected.finish,
      foilTreatment: expected.foilTreatment,
      treatment: "borderless",
      selectedPrintingUuid: "transition-surge",
    });
    assert.equal(selection.treatment, expected.treatment);
    assert.equal(selection.selectedPrintingUuid, expected.uuid);
  });
});

test("traces a real FIN Surge record from raw provider metadata to product, price, and receipt", () => {
  const catalogPrinting = (raw, price) => ({
    uuid: raw.uuid,
    setCode: "FIN",
    setName: "Magic: The Gathering—FINAL FANTASY",
    keyruneCode: "fin",
    releaseDate: "2025-06-13",
    number: raw.number,
    rarity: "mythic",
    treatments: treatmentsForRawPrinting(raw),
    foilTreatment: foilTreatmentForRawPrinting(raw),
    finishes: raw.finishes.map((finish) => finish === "nonfoil" ? "normal" : finish),
    tcgplayerProductId: raw.identifiers.tcgplayerProductId,
    prices: { foil: { value: price, source: "tcgplayer" } },
    priceListings: { foil: { "tcgplayer:retail": { value: price, source: "tcgplayer:retail", currency: "USD" } } },
  });
  const card = {
    name: "Sephiroth, Fabled SOLDIER // Sephiroth, One-Winged Angel",
    printings: [
      catalogPrinting({
        uuid: "3751ebe2-eddc-5f2b-9dfe-11e4925797e7",
        number: "317",
        finishes: ["foil", "nonfoil"],
        promoTypes: ["boosterfun", "ffvii", "universesbeyond"],
        frameEffects: ["inverted", "legendary"],
        borderColor: "borderless",
        identifiers: { tcgplayerProductId: "630959" },
      }, 25),
      catalogPrinting({
        uuid: "aaef9ad6-eb1a-5195-b6af-64de9659f881",
        number: "527",
        finishes: ["foil"],
        promoTypes: ["boosterfun", "ffvii", "surgefoil", "universesbeyond"],
        frameEffects: ["inverted", "legendary"],
        borderColor: "borderless",
        identifiers: { tcgplayerProductId: "630986" },
      }, 80),
    ],
  };

  assert.deepEqual(editionOptions(card).map((edition) => edition.setCode), ["FIN"]);
  assert.deepEqual(finishChoices(card, "FIN").map((choice) => choice.label), ["Non-Foil", "Foil", "Surge"]);
  assert.deepEqual(compatibleTreatmentOptions(card, "FIN", "foil", "surge"), ["borderless"]);
  assert.deepEqual(pricingVariantOptions(card, "FIN", "borderless", "foil", "surge").map((option) => option.label), ["#527"]);
  assert.equal(exactPrintingUuidForSelection(card, "FIN", "borderless", "foil", "", "", "surge"), "aaef9ad6-eb1a-5195-b6af-64de9659f881");
  assert.equal(tcgplayerProductIdForSelection(card, "FIN", "borderless", "foil", "aaef9ad6-eb1a-5195-b6af-64de9659f881", "surge"), "630986");
  assert.equal(priceForSelection(card, "FIN", "borderless", "foil", "tcgplayer:retail", "aaef9ad6-eb1a-5195-b6af-64de9659f881", "surge").price, 80);
  assert.equal(receiptTreatment("borderless", "foil", "surge"), "Borderless Surge Foil");
});

test("selecting Surge chooses a compatible visual treatment without changing card identity", () => {
  const card = {
    name: "Sephiroth, Fabled SOLDIER",
    printings: [
      { ...basePrinting, uuid: "fin-normal", setCode: "FIN", treatments: ["standard"], finishes: ["normal"] },
      { ...basePrinting, uuid: "fin-surge", setCode: "FIN", treatments: ["borderless"], finishes: ["foil"], foilTreatment: "surge" },
    ],
  };
  assert.equal(treatmentForFinishChoice(card, "FIN", "standard", "foil", "surge"), "borderless");
  const row = normalizePricingAssistantRow({ displayName: "Raph's Jitte", canonicalName: "Umezawa's Jitte", finish: "foil", foilTreatment: "surge" });
  assert.equal(row.displayName, "Raph's Jitte");
  assert.equal(row.canonicalName, "Umezawa's Jitte");
  assert.equal(receiptTreatment("borderless", "foil", "surge"), "Borderless Surge Foil");
  assert.equal(receiptTreatment("standard", "foil", "surge"), "Std Surge Foil");
  assert.equal(receiptTreatment("borderless", "foil"), "Borderless Foil");
});

test("shows the Art / Variant control only for found rows with multiple choices", () => {
  const variants = [{ uuid: "one", label: "#1" }, { uuid: "two", label: "#2" }];
  assert.equal(shouldShowPricingVariant(false, variants), false);
  assert.equal(shouldShowPricingVariant(true, variants), true);
  assert.equal(shouldShowPricingVariant(true, [variants[0]]), false);
});

test("formats a reskin display name without changing canonical identity", () => {
  assert.equal(pricingDisplayName("Lightning Bolt", "Lightning Bolt"), "Lightning Bolt");
  assert.equal(pricingDisplayName("Raph's Jitte", "Umezawa's Jitte"), "Raph's Jitte (Umezawa's Jitte)");
});

test("manual rows are isolated groups and do not rely on formatter row IDs", () => {
  const row = createManualPricingRow("manual-1-original", "manual-1", "Raph's Jitte", "Umezawa's Jitte", "Raph's Jitte");
  assert.equal(row.manuallyCreated, true);
  assert.equal(row.quantity, 1);
  assert.equal(row.displayName, "Raph's Jitte");
  assert.equal(row.canonicalName, "Umezawa's Jitte");

  const selected = {
    ...row,
    ...normalizePricingPhysicalSelection(treatmentAvailabilityFixture, {
      setCode: "TST",
      finish: "foil",
      foilTreatment: "surge",
      treatment: "standard",
      selectedPrintingUuid: "",
    }),
  };
  assert.equal(selected.manuallyCreated, true);
  assert.equal(selected.treatment, "borderless");
  assert.equal(selected.selectedPrintingUuid, "UUID-5");
  assert.equal(selected.displayName, "Raph's Jitte");
});

test("links only an exact TCGplayer product selection", () => {
  const exactCard = { name: "Dark Confidant", printings: [basePrinting] };
  assert.equal(tcgplayerProductIdForSelection(exactCard, "RAV", "standard", "normal"), "12345");

  const ambiguousCard = {
    name: "Dark Confidant",
    printings: [basePrinting, { ...basePrinting, uuid: "alternate", tcgplayerProductId: "67890" }],
  };
  assert.equal(tcgplayerProductIdForSelection(ambiguousCard, "RAV", "standard", "normal"), "");
  assert.deepEqual(tcgplayerProductIdsForSelection(ambiguousCard, "RAV", "standard", "normal"), ["12345", "67890"]);
  assert.equal(tcgplayerProductIdForSelection(ambiguousCard, "RAV", "standard", "normal", "alternate"), "67890");
});

test("normalizes sensible manual decimal price entry without accepting malformed text", () => {
  assert.equal(parsePrice(".35"), 0.35);
  assert.equal(parsePrice(".5"), 0.5);
  assert.equal(parsePrice("0.35"), 0.35);
  assert.equal(parsePrice("$0.35"), 0.35);
  assert.equal(parsePrice(".355"), null);
  assert.equal(parsePrice("price .35"), null);
});

test("uses TCGplayer Listed Median instead of the market price field", () => {
  const points = [{
    printingType: "Normal",
    marketPrice: 2.65,
    listedMedianPrice: 2.77,
  }];
  assert.equal(listedMedianPriceForFinish(points, "normal"), 2.77);
});

test("uses and currency-rounds the Listed Median shown by the TCGplayer storefront", () => {
  const storefront = [{ printingType: "Storefront", listedMedianPrice: 4.675 }];
  assert.equal(listedMedianPriceForFinish(storefront, "normal"), 4.68);
  assert.equal(listedMedianPriceForFinish(storefront, "foil"), null);
});

test("uses the foil value from TCGplayer's Near Mint comparison instead of the normal median", () => {
  const points = [
    { printingType: "Storefront", listedMedianPrice: 8.69 },
    { printingType: "Normal", marketPrice: 8.69, listedMedianPrice: 8.67 },
    { printingType: "Foil", marketPrice: 8.82, listedMedianPrice: 8.93 },
  ];
  assert.equal(listedMedianPriceForFinish(points, "normal"), 8.69);
  assert.equal(listedMedianPriceForFinish(points, "foil"), 8.82);
  assert.notEqual(listedMedianPriceForFinish(points, "foil"), listedMedianPriceForFinish(points, "normal"));
});

test("uses MTGJSON only when TCGplayer Listed Median is unavailable", () => {
  const mtgjson = {
    status: "ready",
    price: 2.65,
    source: "tcgplayer",
    message: "TCGplayer retail",
  };
  const median = {
    status: "ready",
    price: 2.77,
    source: "tcgplayer-listed-median",
    message: "TCGplayer Listed Median",
  };
  assert.equal(priceWithListedMedianFallback(median, mtgjson), median);

  const unavailableMedian = {
    status: "unavailable",
    price: null,
    source: "",
    message: "TCGplayer has no Listed Median for this finish.",
  };
  const fallback = priceWithListedMedianFallback(unavailableMedian, mtgjson);
  assert.equal(fallback.price, 2.65);
  assert.equal(fallback.source, "tcgplayer");
  assert.match(fallback.message, /Using MTGJSON fallback/);
});

test("flags Listed Median variance at fifty percent for cards worth at least four dollars", () => {
  assert.equal(requiresPriceVarianceReview(15, 10), true);
  assert.equal(requiresPriceVarianceReview(5, 10), true);
  assert.equal(requiresPriceVarianceReview(14.99, 10), false);
  assert.equal(requiresPriceVarianceReview(3.99, 8), false);
  assert.equal(requiresPriceVarianceReview(4, 8), true);
  assert.equal(priceVarianceRatio(10, 0), null);
});

test("removes Card Kingdom buylist and converts Cardmarket prices to USD", () => {
  assert.deepEqual(
    selectableMtgjsonPriceSources([
      { key: "cardkingdom:retail", provider: "cardkingdom", listType: "retail", currency: "USD" },
      { key: "cardkingdom:buylist", provider: "cardkingdom", listType: "buylist", currency: "USD" },
      { key: "cardmarket:retail", provider: "cardmarket", listType: "retail", currency: "EUR" },
    ]).map((source) => source.key),
    ["cardkingdom:retail", "cardmarket:retail"],
  );
  assert.equal(convertCurrencyPrice(4.25, 1.1556), 4.91);
  assert.equal(convertCurrencyPrice(4.25, null), null);
});

test("applies the store price floor with the standard nonfoil basic-land exception", () => {
  assert.equal(minimumPriceForSelection(false, "standard", "normal"), 0.25);
  assert.equal(minimumPriceForSelection(true, "standard", "normal"), 0.05);
  assert.equal(minimumPriceForSelection(true, "standard", "foil"), 0.25);
  assert.equal(minimumPriceForSelection(true, "full-art", "normal"), 0.25);
  assert.equal(applyMinimumPrice(0.08, false, "standard", "normal"), 0.25);
  assert.equal(applyMinimumPrice(0.01, true, "standard", "normal"), 0.05);
  assert.equal(applyMinimumPrice(1.25, false, "standard", "normal"), 1.25);
  assert.equal(applyMinimumPrice(null, false, "standard", "normal"), null);
});

test("allows every card quantity up to the requested amount", () => {
  assert.equal(pricingQuantityMaximum(40, 0), 40);
  assert.equal(pricingQuantityMaximum(40, 7), 33);
  assert.equal(pricingQuantityMaximum(7, 0), 7);
  assert.equal(pricingQuantityMaximum(3, 1), 2);
});

test("calculates cards not found across split printing rows", () => {
  assert.equal(remainingRequestedQuantity(7, [2, 3]), 2);
  assert.equal(remainingRequestedQuantity(4, [4]), 0);
  assert.equal(remainingRequestedQuantity(3, []), 3);
});

test("formats receipt treatments using common Magic shorthand", () => {
  assert.equal(receiptTreatment("standard", "normal"), "Std");
  assert.equal(receiptTreatment("standard", "foil"), "Std Foil");
  assert.equal(receiptTreatment("showcase", "etched"), "Showcase Etched");
});

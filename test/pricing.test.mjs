import assert from "node:assert/strict";
import test from "node:test";
import { importBundledModule } from "./test-module-bundle.mjs";

import {
  applyMinimumPrice,
  compatibleTreatmentOptions,
  convertCurrencyPrice,
  createManualPricingRow,
  editionOptions,
  exactPrintingUuidForSelection,
  finishChoices,
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
  selectableMtgjsonPriceSources,
  tcgplayerCardSearchUrl,
  tcgplayerProductIdForSelection,
  tcgplayerProductIdsForSelection,
  treatmentOptions,
  treatmentForFinishChoice,
  shouldShowPricingVariant,
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

test("rejects legacy pricing catalogs that discarded the Surge dimension", () => {
  assert.equal(pricingIndexSupportsPhysicalDimensions(3), false);
  assert.equal(pricingIndexSupportsPhysicalDimensions(undefined), false);
  assert.equal(pricingIndexSupportsPhysicalDimensions(4), false);
  assert.equal(pricingIndexSupportsPhysicalDimensions(5), true);
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

import assert from "node:assert/strict";
import test from "node:test";

import {
  applyMinimumPrice,
  convertCurrencyPrice,
  editionOptions,
  listedMedianPriceForFinish,
  minimumPriceForSelection,
  preferredDefaultEdition,
  priceCurrencySymbol,
  priceVarianceRatio,
  priceWithListedMedianFallback,
  priceForSelection,
  pricingNameKey,
  pricingQuantityMaximum,
  pricingShardKey,
  remainingRequestedQuantity,
  receiptTreatment,
  requiresPriceVarianceReview,
  selectableMtgjsonPriceSources,
  tcgplayerCardSearchUrl,
  tcgplayerProductIdForSelection,
} from "../api/server-pricing.mjs";

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
});

test("links only an exact TCGplayer product selection", () => {
  const exactCard = { name: "Dark Confidant", printings: [basePrinting] };
  assert.equal(tcgplayerProductIdForSelection(exactCard, "RAV", "standard", "normal"), "12345");

  const ambiguousCard = {
    name: "Dark Confidant",
    printings: [basePrinting, { ...basePrinting, uuid: "alternate", tcgplayerProductId: "67890" }],
  };
  assert.equal(tcgplayerProductIdForSelection(ambiguousCard, "RAV", "standard", "normal"), "");
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

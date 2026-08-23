import assert from "node:assert/strict";
import test from "node:test";
import LZString from "lz-string";
import { importBundledModule } from "./test-module-bundle.mjs";
import {
  createPricingRowsFromFormatterItems,
  initializeFoundPricingSelection,
  priceForSelection,
  pricingRowWarningState,
} from "../api/server-pricing.mjs";

const { decodeFormatterHash, encodeFormattedHash } = await importBundledModule("src/share-link.ts", "share-link");
const { normalizePayload } = await importBundledModule("api/formatted-lists.ts", "formatted-lists");

test("version five shares formatter state without pricing work", () => {
  const formatterItems = [{
    index: 0,
    quantity: 1,
    inputName: "Raph's Jitte",
    status: "found",
    alternateTitle: "Raph's Jitte",
    requestedPrinting: { setCode: "PZA", finish: "foil", treatment: "borderless" },
    card: { name: "Umezawa's Jitte" },
  }];
  const hash = encodeFormattedHash({
    input: "Jane Doe\n1 Raph's Jitte FOIL",
    output: "formatted",
    processedAt: "2026-08-21T12:00:00.000Z",
    reliabilityNote: "Provider fallback used.",
    customer: { name: "Jane Doe" },
    stats: { resolvedCount: 1, needsReviewCount: 0, printFallbackCount: 1 },
    formatterItems,
    // JavaScript callers can still supply obsolete data; the v5 encoder must discard it.
    pricing: {
      pricingSource: "tcgplayer-listed-median",
      rows: [{
        id: "card-0-original",
        groupId: "card-0",
        sourceIndex: 0,
        requestedQuantity: 1,
        isBasicLand: false,
        quantity: 1,
        found: true,
        resolved: true,
        displayName: "Raph's Jitte",
        canonicalName: "Umezawa's Jitte",
        manuallyCreated: true,
        requestedFlavorName: "Raph's Jitte",
        setCode: "PZA",
        selectedPrintingUuid: "pza-raph-jitte",
        treatment: "full-art",
        finish: "foil",
        foilTreatment: "standard",
        priceOverride: ".35",
      }],
    },
  });
  const decoded = decodeFormatterHash(hash);
  assert.equal(decoded.customer?.name, "Jane Doe");
  assert.equal(decoded.processedAt, "2026-08-21T12:00:00.000Z");
  assert.equal(decoded.reliabilityNote, "Provider fallback used.");
  assert.deepEqual(decoded.formatterItems, formatterItems);
  assert.equal(decoded.pricing, undefined);
  const encoded = JSON.parse(LZString.decompressFromEncodedURIComponent(hash.slice("#formatted=".length)));
  assert.equal(encoded.version, 5);
  assert.deepEqual(encoded.formatterItems, formatterItems);
  assert.equal("pricing" in encoded, false);
  assert.equal("pricingItems" in encoded, false);
  assert.equal("catalog" in encoded, false);
});

test("legacy v2-v4 links keep formatter items and deliberately ignore pricing rows", () => {
  for (const version of [2, 3, 4]) {
    const pricingItems = [{
      index: version,
      quantity: 2,
      inputName: "Putrefy",
      status: "found",
      requestedPrinting: { setCode: "RVR", treatment: "retro" },
      card: { name: "Putrefy" },
    }];
    const hash = `#formatted=${LZString.compressToEncodedURIComponent(JSON.stringify({
      version,
      input: `Putrefy v${version}`,
      output: "saved output",
      processedAt: "2026-08-20T12:00:00.000Z",
      pricingItems,
      pricing: {
        pricingSource: "tcgplayer:retail",
        rows: [{
          cardName: "Manual pricing row",
          manuallyCreated: true,
          found: true,
          selectedPrintingUuid: "legacy-exact-uuid",
          treatment: version === 3 ? "surge" : "retro",
          finish: "foil",
          priceOverride: ".35",
        }],
      },
    }))}`;
    const decoded = decodeFormatterHash(hash);
    assert.equal(decoded.input, `Putrefy v${version}`);
    assert.equal(decoded.output, "saved output");
    assert.deepEqual(decoded.formatterItems, pricingItems);
    assert.equal(decoded.pricing, undefined);
  }
});

test("continues to decode version-one formatted links", () => {
  const v1 = `#formatted=${LZString.compressToEncodedURIComponent(JSON.stringify({
    version: 1,
    input: "Lightning Bolt",
    output: "saved output",
    customer: { name: "Jane Doe", contact: "555-0100" },
    stats: { resolvedCount: 1, needsReviewCount: 0, printFallbackCount: 0 },
  }))}`;
  const decoded = decodeFormatterHash(v1);
  assert.equal(decoded.input, "Lightning Bolt");
  assert.equal(decoded.output, "saved output");
  assert.equal(decoded.customer?.name, "Jane Doe");
  assert.equal(decoded.customer?.legacyContact, "555-0100");
  assert.deepEqual(decoded.formatterItems, []);
  assert.equal(decoded.pricing, undefined);
});

test("a shared processed list starts a fresh, functional Pricing Assistant session", () => {
  const hash = encodeFormattedHash({
    output: "processed output",
    processedAt: "2026-08-21T12:00:00.000Z",
    formatterItems: [{
      index: 0,
      quantity: 1,
      inputName: "Raph's Jitte",
      status: "found",
      alternateTitle: "Raph's Jitte",
      requestedPrinting: { setCode: "PZA", finish: "foil", treatment: "borderless" },
      card: { name: "Umezawa's Jitte" },
    }],
  });
  const decoded = decodeFormatterHash(hash);
  const freshRows = createPricingRowsFromFormatterItems(decoded.formatterItems);
  assert.equal(freshRows.length, 1);
  const [freshRow] = freshRows;
  assert.equal(freshRow.found, false);
  assert.equal(freshRow.priceOverride, null);
  assert.equal(freshRow.selectedPrintingUuid, "");
  assert.equal(freshRow.displayName, "Raph's Jitte");
  assert.equal(freshRow.canonicalName, "Umezawa's Jitte");

  const card = {
    name: "Umezawa's Jitte",
    printings: [{
      uuid: "pza-raph-jitte",
      tcgplayerProductId: "679213",
      setCode: "PZA",
      setName: "Teenage Mutant Ninja Turtles Source Material",
      keyruneCode: "pza",
      releaseDate: "2026-03-06",
      number: "19",
      rarity: "rare",
      flavorName: "Raph's Jitte",
      treatments: ["borderless"],
      finishes: ["normal", "foil"],
      prices: {},
      priceListings: {
        foil: {
          "tcgplayer:retail": { value: 9.5, source: "tcgplayer:retail", currency: "USD" },
        },
      },
    }],
  };
  const found = initializeFoundPricingSelection(freshRow, card, "2026-08-21");
  const automatic = priceForSelection(
    card,
    found.setCode,
    found.treatment,
    found.finish,
    "tcgplayer:retail",
    found.selectedPrintingUuid,
    found.foilTreatment,
  );
  assert.equal(found.found, true);
  assert.equal(found.setCode, "PZA");
  assert.equal(found.finish, "foil");
  assert.equal(found.treatment, "borderless");
  assert.equal(found.selectedPrintingUuid, "pza-raph-jitte");
  assert.equal(automatic.status, "ready");
  assert.equal(automatic.price, 9.5);
  assert.equal(pricingRowWarningState({
    resolved: true,
    found: true,
    catalogState: "ready",
    hydrating: false,
    automaticStatus: automatic.status,
    priceValid: automatic.price !== null,
  }), "none");
});

test("saved processed-list payloads retain formatter rows for a fresh Pricing Assistant", () => {
  const formatterItems = [{
    index: 0,
    quantity: 1,
    inputName: "Lightning Bolt",
    status: "found",
    requestedPrinting: { setCode: "MSC" },
    card: { name: "Lightning Bolt" },
  }];
  const saved = normalizePayload({
    input: "1 Lightning Bolt - MSC",
    output: "processed output",
    formatterItems,
  });
  assert.deepEqual(saved.formatterItems, formatterItems);
  const [freshRow] = createPricingRowsFromFormatterItems(saved.formatterItems);
  assert.equal(freshRow.found, false);
  assert.equal(freshRow.requestedSetCode, "MSC");
});

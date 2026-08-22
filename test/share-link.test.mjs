import assert from "node:assert/strict";
import test from "node:test";
import LZString from "lz-string";
import { importBundledModule } from "./test-module-bundle.mjs";

const { decodeFormatterHash, encodeFormattedHash } = await importBundledModule("src/share-link.ts", "share-link");

test("shares pricing selections without serializing a pricing catalog", () => {
  const hash = encodeFormattedHash({
    input: "Jane Doe\n1 Putrefy FOIL",
    output: "formatted",
    customer: { name: "Jane Doe" },
    pricingItems: [{ index: 0, quantity: 1, inputName: "Putrefy", status: "found", card: { name: "Putrefy" } }],
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
  assert.equal(decoded.pricing?.rows[0].displayName, "Raph's Jitte");
  assert.equal(decoded.pricing?.rows[0].canonicalName, "Umezawa's Jitte");
  assert.equal(decoded.pricing?.rows[0].selectedPrintingUuid, "pza-raph-jitte");
  assert.equal(decoded.pricing?.rows[0].priceOverride, ".35");
  assert.equal(decoded.pricing?.rows[0].manuallyCreated, true);
  const encoded = JSON.parse(LZString.decompressFromEncodedURIComponent(hash.slice("#formatted=".length)));
  assert.equal(encoded.version, 4);
  assert.equal("catalog" in encoded, false);
});

test("continues to decode version-two pricing links with legacy card names", () => {
  const v2 = `#formatted=${LZString.compressToEncodedURIComponent(JSON.stringify({
    version: 2,
    input: "Putrefy",
    pricing: {
      pricingSource: "tcgplayer:retail",
      rows: [{ cardName: "Putrefy", selectedPrintingUuid: "rvr-378", treatment: "retro", finish: "foil" }],
    },
  }))}`;
  const decoded = decodeFormatterHash(v2);
  assert.equal(decoded.pricing?.pricingSource, "tcgplayer:retail");
  assert.equal(decoded.pricing?.rows[0].canonicalName, "Putrefy");
  assert.equal(decoded.pricing?.rows[0].selectedPrintingUuid, "rvr-378");
});

test("migrates v3 surge treatment into the foil-treatment dimension", () => {
  const v3 = `#formatted=${LZString.compressToEncodedURIComponent(JSON.stringify({
    version: 3,
    pricing: { pricingSource: "tcgplayer:retail", rows: [{ cardName: "Fixture", treatment: "surge", finish: "foil" }] },
  }))}`;
  const row = decodeFormatterHash(v3).pricing?.rows[0];
  assert.equal(row?.treatment, "standard");
  assert.equal(row?.finish, "foil");
  assert.equal(row?.foilTreatment, "surge");
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
  assert.equal(decoded.pricing, undefined);
});

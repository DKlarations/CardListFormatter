import assert from "node:assert/strict";
import test from "node:test";
import { importBundledModule } from "./test-module-bundle.mjs";

const { foilTreatmentForRawPrinting, treatmentsForRawPrinting } = await importBundledModule("src/printing-normalization.ts", "printing-normalization");

test("requires explicit or deliberately marketed retro metadata instead of an old frame alone", () => {
  assert.deepEqual(treatmentsForRawPrinting({
    name: "Goblin Game",
    setCode: "PLST",
    number: "PLS-61",
    frameVersion: "1997",
  }), ["standard"]);
  assert.deepEqual(treatmentsForRawPrinting({
    name: "Goblin Game",
    set: "plst",
    collector_number: "PLS-61",
    frame: "1997",
  }), ["standard"]);
  assert.deepEqual(treatmentsForRawPrinting({
    name: "Putrefy",
    setCode: "RVR",
    number: "212",
    frameVersion: "2015",
  }), ["standard"]);
  assert.deepEqual(treatmentsForRawPrinting({
    name: "Putrefy",
    setCode: "RVR",
    number: "378",
    frameVersion: "1997",
    promoTypes: ["boosterfun"],
  }), ["retro"]);
  assert.deepEqual(treatmentsForRawPrinting({ frame: "1997", promo_types: ["boosterfun"] }), ["retro"]);
  assert.deepEqual(treatmentsForRawPrinting({ frame: "2015", promo_types: ["boosterfun"] }), ["standard"]);
  assert.deepEqual(treatmentsForRawPrinting({ frame: "2015", frame_effects: ["oldframe"] }), ["retro"]);
  assert.deepEqual(treatmentsForRawPrinting({ frameVersion: "2015", promoTypes: ["retroframe"] }), ["retro"]);
});

test("identifies Surge Foil separately from other booster-fun printings", () => {
  assert.deepEqual(treatmentsForRawPrinting({ promoTypes: ["surgefoil", "boosterfun"] }), ["standard"]);
  assert.equal(foilTreatmentForRawPrinting({ promoTypes: ["surgefoil", "boosterfun"] }), "surge");
  assert.equal(foilTreatmentForRawPrinting({ promo_types: ["surgefoil"] }), "surge");
  assert.equal(foilTreatmentForRawPrinting({ promoTypes: ["boosterfun"] }), "standard");
  assert.deepEqual(treatmentsForRawPrinting({ promoTypes: ["boosterfun"] }), ["standard"]);
  assert.equal(foilTreatmentForRawPrinting({ finishes: ["surgefoil"] }), "surge");
  assert.equal(foilTreatmentForRawPrinting({ printing: "Surge Foil" }), "surge");
});

test("keeps Borderless and Extended Art provider records mutually distinct", () => {
  assert.deepEqual(treatmentsForRawPrinting({
    borderColor: "borderless",
    frameEffects: ["inverted"],
  }), ["borderless"]);
  assert.deepEqual(treatmentsForRawPrinting({
    border_color: "borderless",
    frame_effects: ["extendedart"],
  }), ["extended-art"]);
  assert.deepEqual(treatmentsForRawPrinting({
    borderColor: "black",
    frameEffects: ["extendedart"],
  }), ["extended-art"]);
  assert.deepEqual(treatmentsForRawPrinting({
    borderColor: "borderless",
    isFullArt: true,
  }), ["borderless"]);
});

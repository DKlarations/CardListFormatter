import assert from "node:assert/strict";
import test from "node:test";
import { importBundledModule } from "./test-module-bundle.mjs";

const {
  collapsedPrintingLabel,
  exactPrintingSearchOptions,
  normalizeCollectorNumber,
  searchExactPrintingOptions,
  selectExactPrintingOption,
} = await importBundledModule("src/exact-printing-search.ts", "exact-printing-search");

function printing(overrides = {}) {
  return {
    uuid: "printing-uuid",
    setCode: "TST",
    setName: "Test Set",
    keyruneCode: "tst",
    releaseDate: "2020-01-01",
    number: "1",
    rarity: "rare",
    artist: "Test Artist",
    treatments: ["standard"],
    finishes: ["normal"],
    prices: {},
    ...overrides,
  };
}

const lightningBolt = {
  name: "Lightning Bolt",
  printings: [
    printing({
      uuid: "p10-bolt-1",
      setCode: "P10",
      setName: "Magic Player Rewards 2010",
      keyruneCode: "p10",
      releaseDate: "2010-01-01",
      number: "1",
      artist: "Christopher Rush",
      treatments: ["full-art"],
      finishes: ["foil"],
    }),
    printing({
      uuid: "new-bolt-001",
      setCode: "NEW",
      setName: "A Newer Lightning Bolt Set",
      keyruneCode: "new",
      releaseDate: "2025-08-01",
      number: "001",
      artist: "Mária Example",
      treatments: ["retro"],
      finishes: ["normal", "foil"],
    }),
    printing({
      uuid: "alpha-bolt-s1",
      setCode: "ALP",
      setName: "Alphanumeric Promos",
      keyruneCode: "alp",
      releaseDate: "2024-01-01",
      number: "S1",
      artist: "Another Artist",
      treatments: ["borderless"],
      finishes: ["foil"],
    }),
    printing({
      uuid: "promo-bolt-ifiyw-2",
      setCode: "SLD",
      setName: "Secret Lair Drop",
      keyruneCode: "sld",
      releaseDate: "2026-01-01",
      number: "IFIYW-2",
      treatments: ["standard"],
      finishes: ["foil"],
    }),
  ],
};

function labelsFor(query) {
  const result = searchExactPrintingOptions(exactPrintingSearchOptions(lightningBolt), query);
  return result.options.map((option) => option.key);
}

test("finds a Lightning Bolt exact printing by staff-visible physical details", () => {
  for (const query of [
    "P10",
    "player rewards",
    "#1",
    "collector 1",
    "1 full art foil",
    "2010 foil",
    "2010-01-01 foil",
    "Rush",
    "mAgIc PlAyEr ReWaRdS 2010",
    "magic---player    rewards",
  ]) {
    assert.ok(labelsFor(query).includes("p10-bolt-1|foil|standard|full-art"), query);
  }
});

test("normalizes numeric collector numbers while preserving alphanumeric values", () => {
  assert.equal(normalizeCollectorNumber("001"), "1");
  assert.equal(normalizeCollectorNumber("1a"), "1a");
  assert.equal(normalizeCollectorNumber("S1"), "s1");
  assert.ok(labelsFor("collector 1").includes("new-bolt-001|normal|standard|retro"));
  assert.equal(labelsFor("collector 1").some((key) => key.startsWith("alpha-bolt-s1|")), false);
  assert.ok(labelsFor("maria").includes("new-bolt-001|normal|standard|retro"));
  assert.ok(labelsFor("retro foil").includes("new-bolt-001|foil|standard|retro"));
  assert.equal(labelsFor("retro foil").includes("new-bolt-001|normal|standard|retro"), false);
  assert.ok(labelsFor("retro non-foil").includes("new-bolt-001|normal|standard|retro"));
  assert.equal(labelsFor("retro non-foil").includes("new-bolt-001|foil|standard|retro"), false);
  assert.ok(labelsFor("S1 borderless").includes("alpha-bolt-s1|foil|standard|borderless"));
  assert.ok(labelsFor("IFIYW-2 foil").includes("promo-bolt-ifiyw-2|foil|standard|standard"));
  assert.equal(labelsFor("collector 2").some((key) => key.startsWith("promo-bolt-ifiyw-2|")), false);
});

test("uses AND matching and returns an empty result when any concept is absent", () => {
  assert.equal(labelsFor("1 full art foil").length, 1);
  assert.equal(labelsFor("1 full art etched").length, 0);
  assert.equal(labelsFor("nonexistent").length, 0);
});

test("ranks deterministically by exact set code, exact collector, date, set, and collector", () => {
  const options = exactPrintingSearchOptions({
    name: "Rank Test",
    printings: [
      printing({ uuid: "old-exact-code", setCode: "ABC", setName: "Old Set", releaseDate: "2010-01-01", number: "20" }),
      printing({ uuid: "new-name-match", setCode: "NEW", setName: "ABC Adventures", releaseDate: "2026-01-01", number: "1" }),
      printing({ uuid: "newer-collector", setCode: "COL", setName: "Collector Set", releaseDate: "2025-01-01", number: "7" }),
      printing({ uuid: "older-collector", setCode: "OLD", setName: "Old Collector Set", releaseDate: "2020-01-01", number: "007" }),
    ],
  });
  assert.equal(searchExactPrintingOptions(options, "ABC").options[0].uuid, "old-exact-code");
  assert.deepEqual(
    searchExactPrintingOptions(options, "collector 7").options.map((option) => option.uuid),
    ["newer-collector", "older-collector"],
  );
  assert.deepEqual(
    searchExactPrintingOptions(options, "collector 7").options.map((option) => option.uuid),
    searchExactPrintingOptions(options, "collector 7").options.map((option) => option.uuid),
  );
});

test("caps blank and queried results and reports truncation", () => {
  const options = Array.from({ length: 25 }, (_, index) => ({
    ...exactPrintingSearchOptions({
      name: "Cap Test",
      printings: [printing({ uuid: `cap-${index}`, setCode: `C${index}`, releaseDate: `2025-01-${String((index % 9) + 1).padStart(2, "0")}` })],
    })[0],
    artist: "Shared Artist",
  }));
  const blank = searchExactPrintingOptions(options, "", 100, 20);
  assert.equal(blank.options.length, 20);
  assert.equal(blank.total, 25);
  assert.equal(blank.truncated, true);
  const queried = searchExactPrintingOptions(options, "shared artist", 10, 20);
  assert.equal(queried.options.length, 10);
  assert.equal(queried.total, 25);
  assert.equal(queried.truncated, true);
});

test("generates separate finishes, models Surge as foil technology, and deduplicates", () => {
  const shared = printing({
    uuid: "both-finishes",
    finishes: ["normal", "foil"],
  });
  const surge = printing({
    uuid: "surge-printing",
    treatments: ["borderless"],
    finishes: ["foil"],
    foilTreatment: "surge",
  });
  const options = exactPrintingSearchOptions({ name: "Finish Test", printings: [shared, shared, surge] });
  assert.deepEqual(
    options.filter((option) => option.uuid === "both-finishes").map((option) => option.finishLabel),
    ["Non-Foil", "Foil"],
  );
  const surgeOption = options.find((option) => option.uuid === "surge-printing");
  assert.equal(surgeOption.finish, "foil");
  assert.equal(surgeOption.foilTreatment, "surge");
  assert.equal(surgeOption.finishLabel, "Surge");
  assert.equal(searchExactPrintingOptions(options, "surge").options[0].uuid, "surge-printing");
  assert.equal(options.filter((option) => option.key === "both-finishes|normal|standard|standard").length, 1);
});

test("selects the whole physical option while preserving row identity and pricing work", () => {
  const source = {
    id: "split-row-2",
    groupId: "lightning-bolt-group",
    sourceIndex: 4,
    requestedQuantity: 3,
    isBasicLand: false,
    quantity: 2,
    found: true,
    resolved: true,
    displayName: "Lightning Bolt",
    canonicalName: "Lightning Bolt",
    manuallyCreated: false,
    setSelectionSource: "default",
    setCode: "NEW",
    selectedPrintingUuid: "new-bolt-001",
    finish: "normal",
    treatment: "retro",
    foilTreatment: "standard",
    priceOverride: "4.25",
  };
  const option = exactPrintingSearchOptions(lightningBolt).find((candidate) => candidate.uuid === "p10-bolt-1");
  const selected = selectExactPrintingOption(source, lightningBolt, option);
  assert.deepEqual(
    {
      setCode: selected.setCode,
      uuid: selected.selectedPrintingUuid,
      finish: selected.finish,
      foilTreatment: selected.foilTreatment,
      treatment: selected.treatment,
      source: selected.setSelectionSource,
    },
    {
      setCode: "P10",
      uuid: "p10-bolt-1",
      finish: "foil",
      foilTreatment: "standard",
      treatment: "full-art",
      source: "manual",
    },
  );
  for (const field of ["id", "groupId", "sourceIndex", "requestedQuantity", "quantity", "found", "displayName", "canonicalName", "priceOverride"]) {
    assert.equal(selected[field], source[field], field);
  }
});

test("shows collector numbers only for a valid exact UUID", () => {
  const exact = {
    setCode: "P10",
    selectedPrintingUuid: "p10-bolt-1",
    finish: "foil",
    foilTreatment: "standard",
    treatment: "full-art",
  };
  assert.equal(collapsedPrintingLabel(lightningBolt, exact), "P10 · #1");
  assert.equal(collapsedPrintingLabel(lightningBolt, { ...exact, selectedPrintingUuid: "" }), "P10");
  assert.equal(collapsedPrintingLabel(lightningBolt, { ...exact, selectedPrintingUuid: "stale" }), "P10");
  const blankNumberCard = { name: "Blank", printings: [printing({ uuid: "blank", setCode: "P10", number: "" })] };
  assert.equal(collapsedPrintingLabel(blankNumberCard, {
    setCode: "P10",
    selectedPrintingUuid: "blank",
    finish: "normal",
    foilTreatment: "standard",
    treatment: "standard",
  }), "P10");
});

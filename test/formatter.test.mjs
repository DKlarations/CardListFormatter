import assert from "node:assert/strict";
import test from "node:test";

import {
  clearMtgjsonIndexCache,
  compactFormatterItems,
  outputDisplayName,
  parsePullList,
  processPullListText,
  resolveCardNames,
} from "../server/generated/server-formatter.mjs";

const structuredPriceList = `Contact
Name - Aaron Greene
Phone - (779) 555-3710
Email - aaron.greene@example.com

Sygg, Wanderwine Wisdom - Rare - $0.45- ECL - Blue/White
Wanderwine Hub - Rare - $3.50 - LRW - Land
Tempest Caller - Uncommon - $0.25 - XLN - Blue
River Sneak - Uncommon - $0.25 - XLN - Blue
Triton Shorestalker - Common - $0.20 - JOU - Blue
Opposition - Rare - $5.00 - 7ED / UDS - Blue
Transcendent Message - Rare - $0.50 - MAT - Blue
Rivendell - Rare - $1.50 - LTR - Land
Everything Comes to Dust - Rare - $0.75 - LTC - Colorless
Arcane Signet - Uncommon - $0.50 - ELD / LCC - Colorless
Deeproot Pilgrimage - Rare - $2.00 - LCI - Blue
Mist Dancer - Rare - $0.30 - MH2 - Blue
Bident of Thassa - Rare - $0.75 - THS / A25 - Blue
Seachrome Coast - Rare - $3.50 - SOM / ONE - Land
Floodpits Drowner - Uncommon - $0.25 - DSK - Blue
Reliquary Tower - Uncommon - $2.00 - M19 / CON - Land
Dazzling Theater // Prop Room - Rare - $1.00 - DSK - White
Mindspring Merfolk - Rare - $1.00 - DFT - Blue
Talisman of Progress - Uncommon - $1.50 - MRD / WHO - Colorless

Adarkar Wastes - Rare - $5.50 - DMU / 10E - Land
Skycloud Expanse - Rare - $0.30 - ODY / C20 - Land
Glacial Fortress - Rare - $2.50 - M10 / XLN - Land
Secret Tunnel - Common - $0.15 - ECL - Land
Deepway Navigator - Rare - $0.50 - ECL - Blue/White
Winnowing - Uncommon - $0.25 - ECL - Blue
Disruptor of Currents - Uncommon - $0.25 - ECL - Blue
Mirrorform - Uncommon - $0.25 - ECL - Blue
Harmonized Crescendo - Rare - $1.00 - ECL - Blue/White
Gathering Stone - Uncommon - $0.25 - ECL - Colorless
Eclipsed Realms - Rare - $1.50 - ECL - Land
Meanders Guide - Common - $0.15 - ECL - Blue
Champions of the Shoal - Rare - $1.00 - ECL - Blue
Adept Watershaper - Uncommon - $0.25 - ECL - Blue
Eclipsed Merrow - Common - $0.15 - ECL - Blue
Wanderbrine Trapper - Uncommon - $0.25 - ECL - Blue
Deepchannel Duelist - Common - $0.15 - ECL - Blue
Silvergill Mentor - Uncommon - $0.25 - ECL - Blue
Captain America, Living Legend - Uncommon - $0.35 - MSH - Blue/White
Unclaimed Territory - Uncommon - $0.50 - XLN / LCC - Land`;

test("parses hyphen-labeled contacts and structured price-list rows", () => {
  const parsed = parsePullList(structuredPriceList);

  assert.deepEqual(parsed.customer, {
    name: "Aaron Greene",
    phone: "779-555-3710",
    email: "aaron.greene@example.com",
  });
  assert.equal(parsed.cardLineCount, 39);
  assert.equal(parsed.cards.length, 39);

  const cardsByName = new Map(parsed.cards.map((card) => [card.inputName, card]));
  assert.deepEqual(cardsByName.get("Sygg, Wanderwine Wisdom")?.statedRarities, ["rare"]);
  assert.deepEqual(cardsByName.get("Dazzling Theater // Prop Room")?.statedRarities, ["rare"]);
  assert.deepEqual(cardsByName.get("Captain America, Living Legend")?.statedRarities, ["uncommon"]);
  assert.ok(parsed.cards.every((card) => !card.inputName.includes("$")));
  assert.ok(!cardsByName.has("Contact"));
  assert.ok(!cardsByName.has("Name - Aaron Greene"));
});

test("keeps colon-labeled contacts and sentence filtering compatible", () => {
  const parsed = parsePullList(`Contact Information
Name: Jane Doe
Phone: (206) 555-0142
Email: jane@example.com
Thanks for pulling these cards.
Lightning Bolt`);

  assert.deepEqual(parsed.customer, {
    name: "Jane Doe",
    phone: "206-555-0142",
    email: "jane@example.com",
  });
  assert.deepEqual(parsed.cards.map((card) => card.inputName), ["Lightning Bolt"]);
});

test("preserves explicit structured set and printing requests for Pricing Assistant defaults", () => {
  const parsed = parsePullList(`Putrefy - Rare - $0.35 - RVR - Black/Green\nSol Ring FOIL SHOWCASE\nCloud, Midgar Mercenary SURGE FOIL BORDERLESS`);
  assert.deepEqual(parsed.cards[0].requestedPrinting, { setCode: "RVR" });
  assert.deepEqual(parsed.cards[1].requestedPrinting, { finish: "foil", foilTreatment: "standard", treatment: "showcase" });
  assert.deepEqual(parsed.cards[2].requestedPrinting, { finish: "foil", foilTreatment: "surge", treatment: "borderless" });
});

test("compacts resolved formatter items without losing pricing identity or intent", () => {
  assert.deepEqual(compactFormatterItems([{
    index: 7,
    quantity: 2,
    inputName: "Raph's Jitte",
    status: "found",
    alternateTitle: "Raph's Jitte",
    requestedPrinting: { setCode: "PZA", finish: "foil", treatment: "borderless" },
    mtgjsonCard: { name: "Umezawa's Jitte", prices: { secret: 999 } },
    prints: [{ id: "large-provider-record" }],
  }]), [{
    index: 7,
    quantity: 2,
    inputName: "Raph's Jitte",
    status: "found",
    isBasicLand: false,
    isToken: false,
    alternateTitle: "Raph's Jitte",
    requestedDisplayName: "",
    requestedPrinting: { setCode: "PZA", finish: "foil", treatment: "borderless" },
    statedRarities: [],
    specialRequests: [],
    nonSecretRarities: [],
    eligibleRarityChecked: false,
    tokenDetails: [],
    caseNote: "",
    note: "",
    printLookupFailed: false,
    card: undefined,
    mtgjsonCard: { name: "Umezawa's Jitte" },
  }]);
});

const forbiddenNameFragments = new Set(["Ajani", "Boseiju", "Death", "Mentor of Heroes", "Greeter's Champion"]);

function assertCompleteCardNames(parsed, names) {
  assert.equal(parsed.cards.length, names.length);
  assert.deepEqual(parsed.cards.map((card) => card.inputName), names);
  for (const card of parsed.cards) {
    assert.ok(!forbiddenNameFragments.has(card.inputName), `Unexpected fragment: ${card.inputName}`);
    assert.doesNotMatch(card.inputName, /,\s*(?:M\s*)?$/);
  }
}

const commaNames = ["Ajani, Wise Counselor", "Ajani, Valiant Protector", "Ajani, Mentor of Heroes"];

test("preserves three raw comma-bearing names and extracts complete one-letter rarity fields", () => {
  const parsed = parsePullList(commaNames.map((name) => `${name}, M`).join("\n"));
  assertCompleteCardNames(parsed, commaNames);
  assert.equal(parsed.cardLineCount, 3);
  assert.deepEqual(parsed.cards.map((card) => card.statedRarities), [["mythic"], ["mythic"], ["mythic"]]);
});

test("parses comma-bearing names with separate rarity and quantity suffixes", () => {
  const parsed = parsePullList(commaNames.map((name, index) => `${name}, M, ${index + 1}`).join("\n"));
  assertCompleteCardNames(parsed, commaNames);
  assert.deepEqual(parsed.cards.map((card) => card.quantity), [1, 2, 3]);
  assert.deepEqual(parsed.cards.map((card) => card.statedRarities), [["mythic"], ["mythic"], ["mythic"]]);
});

test("parses a quoted comma-bearing name with rarity and quantity", () => {
  const parsed = parsePullList('"Ajani, Mentor of Heroes", M, 2');
  assertCompleteCardNames(parsed, ["Ajani, Mentor of Heroes"]);
  assert.equal(parsed.cards[0].quantity, 2);
  assert.deepEqual(parsed.cards[0].statedRarities, ["mythic"]);
});

test("retains quoted name boundaries and escaped internal quotes after removing metadata", () => {
  for (const [input, name] of [
    ['"Example, R", M, 2', "Example, R"],
    ['"Example-R", M, 2', "Example-R"],
    ['"Example Rare", M, 2', "Example Rare"],
    ['"Example ""Within"", R", M, 2', 'Example "Within", R'],
  ]) {
    const parsed = parsePullList(input);
    assertCompleteCardNames(parsed, [name]);
    assert.equal(parsed.cards[0].quantity, 2, input);
    assert.deepEqual(parsed.cards[0].statedRarities, ["mythic"], input);
  }
});

test("preserves a comma-bearing name without a metadata suffix", () => {
  const parsed = parsePullList("Ajani, Mentor of Heroes");
  assertCompleteCardNames(parsed, ["Ajani, Mentor of Heroes"]);
  assert.equal(parsed.cards[0].quantity, 1);
  assert.deepEqual(parsed.cards[0].statedRarities, []);
});

test("extracts every one-letter rarity only from a complete metadata field", () => {
  const names = ["Ajani, Mentor of Heroes", "Boseiju, Who Endures", "Tatyova, Benthic Druid", "Llanowar Elves"];
  const parsed = parsePullList(names.map((name, index) => `${name}, ${["M", "R", "U", "C"][index]}, ${index + 1}`).join("\n"));
  assertCompleteCardNames(parsed, names);
  assert.deepEqual(parsed.cards.map((card) => card.statedRarities), [["mythic"], ["rare"], ["uncommon"], ["common"]]);
  assert.deepEqual(parsed.cards.map((card) => card.quantity), [1, 2, 3, 4]);
});

test("recognizes all case-insensitive rarity aliases with the same classification and extraction grammar", () => {
  const aliases = [
    ["m", "mythic"], ["MR", "mythic"], ["Mythic", "mythic"], ["mYtHiC rArE", "mythic"],
    ["r", "rare"], ["Rare", "rare"], ["u", "uncommon"], ["UC", "uncommon"],
    ["unc", "uncommon"], ["Uncommon", "uncommon"], ["c", "common"], ["COM", "common"], ["Common", "common"],
  ];
  for (const [alias, rarity] of aliases) {
    const parsed = parsePullList(`Ajani, Mentor of Heroes, ${alias}, 2`);
    assertCompleteCardNames(parsed, ["Ajani, Mentor of Heroes"]);
    assert.deepEqual(parsed.cards[0].statedRarities, [rarity], alias);
    assert.equal(parsed.cards[0].quantity, 2, alias);
  }
});

test("preserves hyphens and apostrophes with comma, dash, leading quantity, and copied-table metadata", () => {
  const variants = [
    ["Death-Greeter's Champion", 1, []],
    ["Death-Greeter's Champion, R", 1, ["rare"]],
    ["Death-Greeter's Champion - R", 1, ["rare"]],
    ["1 Death-Greeter's Champion", 1, []],
    ["2x Death-Greeter's Champion", 2, []],
    ["Death-Greeter's Champion    R    2", 2, ["rare"]],
    ["Death-Greeter's Champion\tR\t1", 1, ["rare"]],
  ];
  for (const [input, quantity, rarities] of variants) {
    const parsed = parsePullList(input);
    assertCompleteCardNames(parsed, ["Death-Greeter's Champion"]);
    assert.equal(parsed.cards[0].quantity, quantity, input);
    assert.deepEqual(parsed.cards[0].statedRarities, rarities, input);
  }
});

test("preserves internal hyphens and removes only the final proven legacy dash suffix", () => {
  const names = ["Self-Assembler", "Eight-and-a-Half-Tails", "Cutthroat-Centric Example Name", "Goblin Game"];
  const parsed = parsePullList("Self-Assembler\nEight-and-a-Half-Tails\nCutthroat-Centric Example Name\nGoblin Game-rare");
  assertCompleteCardNames(parsed, names);
  assert.deepEqual(parsed.cards[3].statedRarities, ["rare"]);
  for (const delimiter of [" - ", " – ", " — "]) {
    const dashed = parsePullList(`Cutthroat-Centric Example Name${delimiter}Rare`);
    assertCompleteCardNames(dashed, ["Cutthroat-Centric Example Name"]);
    assert.deepEqual(dashed.cards[0].statedRarities, ["rare"]);
  }
});

test("preserves ordinary punctuation when no entire trailing field is metadata", () => {
  const names = [
    "Ajani, Mentor of Heroes", "Death-Greeter's Champion", "Cutthroat–Centric Example Name",
    "Cutthroat—Centric Example Name", "Who // What: Where", "Example, R Word",
    "Example-M Rare Companion", "Example, rare companion", "Example - rare companion",
    "Example, foil companion", "Example - foil companion", "Example, qty 2 extra words",
    "Example, rarity letter M inside words", "Example (unrecognized punctuation)",
    "Example [unrecognized punctuation]", "The Foil Companion", "The Showcase Companion",
  ];
  for (const name of names) {
    const parsed = parsePullList(name);
    assertCompleteCardNames(parsed, [name]);
    assert.deepEqual(parsed.cards[0].statedRarities, [], name);
    assert.deepEqual(parsed.cards[0].specialRequests, [], name);
    assert.equal(parsed.cards[0].quantity, 1, name);
  }
});

test("preserves name words following colons and double-faced separators", () => {
  for (const name of ["Circle of Protection: Red", "Circle of Protection: Blue", "Example: R", "Who // Red"]) {
    const parsed = parsePullList(name);
    assertCompleteCardNames(parsed, [name]);
    assert.deepEqual(parsed.cards[0].statedRarities, [], name);
  }
});

test("stops comma suffix parsing at the first unknown complete field", () => {
  const parsed = parsePullList("Example, rare companion, M, 2");
  assertCompleteCardNames(parsed, ["Example, rare companion"]);
  assert.equal(parsed.cards[0].quantity, 2);
  assert.deepEqual(parsed.cards[0].statedRarities, ["mythic"]);
});

test("does not partially consume unknown comma or dash fields ending with recognized words", () => {
  const names = [
    "Example, unknown words rare",
    "Example - unknown words rare", "Example - unknown words FOIL",
    "Example, qty 2 unrecognized Rare", "Example - unknown words M x2",
  ];
  for (const name of names) {
    const parsed = parsePullList(name);
    assertCompleteCardNames(parsed, [name]);
    assert.equal(parsed.cards[0].quantity, 1, name);
    assert.deepEqual(parsed.cards[0].statedRarities, [], name);
    assert.deepEqual(parsed.cards[0].specialRequests, [], name);
  }
});

test("preserves incomplete or conflicting metadata fields instead of peeling partial quantities", () => {
  for (const field of ["qty 2 qty 3", "M x2 x3", "-1", "0", "R/", "R and"]) {
    const name = `Example, ${field}`;
    const parsed = parsePullList(name);
    assertCompleteCardNames(parsed, [name]);
    assert.equal(parsed.cards[0].quantity, 1, field);
    assert.deepEqual(parsed.cards[0].statedRarities, [], field);
  }
  const parsed = parsePullList("Example - qty 2 qty 3");
  assertCompleteCardNames(parsed, ["Example - qty 2 qty 3"]);
  assert.equal(parsed.cards[0].quantity, 1);
});

test("extracts combined rarity and quantity fields without leaving an orphan comma", () => {
  for (const [metadata, quantity, rarities] of [
    ["M x2", 2, ["mythic"]], ["Rare x3", 3, ["rare"]],
    ["qty 2", 2, []], ["quantity: 2", 2, []],
  ]) {
    const parsed = parsePullList(`Ajani, Mentor of Heroes, ${metadata}`);
    assertCompleteCardNames(parsed, ["Ajani, Mentor of Heroes"]);
    assert.equal(parsed.cards[0].quantity, quantity, metadata);
    assert.deepEqual(parsed.cards[0].statedRarities, rarities, metadata);
  }
});

test("keeps printing, set, color, price, and cheapest-request metadata compatible", () => {
  const parsed = parsePullList("Ajani, Mentor of Heroes, M, SURGE FOIL, BORDERLESS, ECL, Blue/White, $0.45, cheapest you have, 2");
  assertCompleteCardNames(parsed, ["Ajani, Mentor of Heroes"]);
  assert.equal(parsed.cards[0].quantity, 2);
  assert.deepEqual(parsed.cards[0].statedRarities, ["mythic"]);
  assert.deepEqual(parsed.cards[0].requestedPrinting, { setCode: "ECL", finish: "foil", foilTreatment: "surge", treatment: "borderless" });
  for (const request of ["FOIL", "SURGE FOIL", "SHOWCASE", "BORDERLESS"]) {
    const item = parsePullList(`Ajani, Mentor of Heroes, ${request}`).cards[0];
    assert.equal(item.inputName, "Ajani, Mentor of Heroes");
    assert.ok(item.specialRequests.includes(request), request);
  }
});

test("preserves comma-bearing names through tab-separated and multiple-space copied tables", () => {
  for (const separator of ["\t", "    "]) {
    const parsed = parsePullList(`Ajani, Mentor of Heroes${separator}M${separator}2`);
    assertCompleteCardNames(parsed, ["Ajani, Mentor of Heroes"]);
    assert.equal(parsed.cards[0].quantity, 2);
    assert.deepEqual(parsed.cards[0].statedRarities, ["mythic"]);
  }
});

test("keeps complete copied-table name cells even when their final word resembles metadata", () => {
  for (const separator of ["\t", "    "]) {
    for (const name of ["Example, R", "Example-R", "Example Rare"]) {
      const parsed = parsePullList(`${name}${separator}M${separator}2`);
      assertCompleteCardNames(parsed, [name]);
      assert.equal(parsed.cards[0].quantity, 2, name);
      assert.deepEqual(parsed.cards[0].statedRarities, ["mythic"], name);
    }
  }
});

test("keeps duplicate aggregation, requested printing, basic lands, tokens, and double-faced names", () => {
  const parsed = parsePullList(`Ajani, Mentor of Heroes, M, 2
Ajani, Mentor of Heroes, M, 3
Death-Greeter's Champion, R, FOIL, SHOWCASE, 2
Death-Greeter's Champion, R, 1
2 Forest
3 Green Dinosaur Token 3/3 Trample
Dazzling Theater // Prop Room, R`);
  assertCompleteCardNames(parsed, ["Ajani, Mentor of Heroes", "Death-Greeter's Champion", "Forest", "Green Dinosaur Token", "Dazzling Theater // Prop Room"]);
  assert.deepEqual(parsed.cards.map((card) => card.quantity), [5, 3, 2, 3, 1]);
  assert.deepEqual(parsed.cards[1].requestedPrinting, { finish: "foil", foilTreatment: "standard", treatment: "showcase" });
  assert.equal(parsed.cards[3].isToken, true);
  assert.deepEqual(parsed.cards[3].tokenDetails, ["3/3", "Trample"]);
});

test("keeps complete parsed names in provider-disabled display and final formatted output", async () => {
  const result = await processPullListText("Name: Regression Customer\nAjani, Mentor of Heroes, M\nDeath-Greeter's Champion", {
    useMtgjson: false, useScryfall: false, useCheckboxes: false, processedAt: "2026-09-07T12:00:00Z",
  });
  assertCompleteCardNames(result.parsed, ["Ajani, Mentor of Heroes", "Death-Greeter's Champion"]);
  assert.deepEqual(result.items.map(outputDisplayName), ["Ajani, Mentor of Heroes", "Death-Greeter's Champion"]);
  assert.match(result.output, /^1 Ajani, Mentor of Heroes(?: \(|$)/m);
  assert.match(result.output, /^1 Death-Greeter's Champion(?: \(|$)/m);
  assert.doesNotMatch(result.output, /^\s*(?:\[ \]\s*)?\d+\s+(?:Ajani|Death|Mentor of Heroes|Greeter's Champion)(?:\s+\([^\n]*\))?\s*$/m);
});

test("preserves names through mixed metadata delimiters and orphan final commas", () => {
  for (const [input, name, quantity, rarity] of [
    ["Ajani, Mentor of Heroes - M", "Ajani, Mentor of Heroes", 1, "mythic"],
    ["Death-Greeter's Champion - R, 2", "Death-Greeter's Champion", 2, "rare"],
    ["Death-Greeter's Champion-R", "Death-Greeter's Champion", 1, "rare"],
    ["Ajani, Mentor of Heroes, M,", "Ajani, Mentor of Heroes", 1, "mythic"],
    ['"Example", "Unknown", M', "Example, Unknown", 1, "mythic"],
  ]) {
    const parsed = parsePullList(input);
    assertCompleteCardNames(parsed, [name]);
    assert.equal(parsed.cards[0].quantity, quantity, input);
    assert.deepEqual(parsed.cards[0].statedRarities, [rarity], input);
  }
});

test("keeps parenthesized token details without leaving empty punctuation in token names", () => {
  const parsed = parsePullList("2 Soldier Token (1/1, White)\n3 Green Dinosaur Token (3/3, Trample)");
  assertCompleteCardNames(parsed, ["White Soldier Token", "Green Dinosaur Token"]);
  assert.deepEqual(parsed.cards.map((card) => card.quantity), [2, 3]);
  assert.deepEqual(parsed.cards.map((card) => card.tokenDetails), [["1/1"], ["3/3", "Trample"]]);
  assert.ok(parsed.cards.every((card) => card.isToken));
});

test("MTGJSON resolves full parsed lookup candidates even when first-fragment aliases exist", async (t) => {
  const names = ["Ajani, Mentor of Heroes", "Death-Greeter's Champion"];
  const cards = {
    ajani: { name: names[0], rarities: ["mythic"] }, deathGreeter: { name: names[1], rarities: ["rare"] },
    wrongAjani: { name: "Ajani", rarities: ["mythic"] }, wrongDeath: { name: "Death", rarities: ["rare"] },
  };
  const queriedAliases = [];
  const aliases = new Proxy({ "ajani mentor of heroes": "ajani", "deathgreeters champion": "deathGreeter", ajani: "wrongAjani", death: "wrongDeath" }, {
    get(target, key) { queriedAliases.push(key); return target[key]; },
  });
  clearMtgjsonIndexCache();
  t.after(clearMtgjsonIndexCache);
  t.mock.method(globalThis, "fetch", async (url) => ({
    ok: true, status: 200,
    json: async () => String(url).endsWith("/manifest") ? { indexUrl: "https://formatter.test/index" } : { cards, aliases },
  }));
  const parsed = parsePullList(`${names[0]}, M\n${names[1]}, R`);
  const resolved = await resolveCardNames(parsed.cards, () => {}, false, { useMtgjson: true, useScryfall: false, mtgjsonManifestUrl: "https://formatter.test/manifest" });
  assertCompleteCardNames(parsed, names);
  assert.deepEqual(queriedAliases, ["ajani mentor of heroes", "deathgreeters champion"]);
  assert.deepEqual(resolved.map(outputDisplayName), names);
  assert.ok(resolved.every((item) => item.status === "found" && item.lookupSource === "mtgjson"));
});

test("Scryfall receives full exact candidates before any fuzzy lookup and keeps unknown suffixes", async (t) => {
  const names = ["Ajani, Mentor of Heroes", "Death-Greeter's Champion", "Example, rare companion"];
  const calls = [];
  t.mock.method(globalThis, "fetch", async (input, options) => {
    const url = new URL(input);
    if (url.pathname === "/cards/collection") {
      calls.push({ mode: "exact", names: JSON.parse(options.body).identifiers.map((entry) => entry.name) });
      return Response.json({ data: [] });
    }
    if (url.pathname === "/cards/named") {
      calls.push({ mode: "fuzzy", name: url.searchParams.get("fuzzy") });
      return Response.json({ object: "error", code: "not_found" }, { status: 404 });
    }
    throw new Error(`Unexpected provider URL: ${url}`);
  });
  const parsed = parsePullList(`${names[0]}, M\n${names[1]}, R\n${names[2]}`);
  const resolved = await resolveCardNames(parsed.cards, () => {}, false, { useMtgjson: false, useScryfall: true });
  assertCompleteCardNames(parsed, names);
  assert.deepEqual(calls, [{ mode: "exact", names }, ...names.map((name) => ({ mode: "fuzzy", name }))]);
  assert.deepEqual(resolved.map((item) => item.inputName), names);
  assert.ok(resolved.every((item) => item.status === "review"));
});

import assert from "node:assert/strict";
import test from "node:test";

import { parsePullList } from "../api/server-formatter.mjs";

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
    contact: "779-555-3710 / aaron.greene@example.com",
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
    contact: "206-555-0142 / jane@example.com",
  });
  assert.deepEqual(parsed.cards.map((card) => card.inputName), ["Lightning Bolt"]);
});

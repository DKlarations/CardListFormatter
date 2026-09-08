import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";
import { createFixture, ordinaryNames, mixedFixture, withHarness, remoteRequestCount, assertPacing } from "../tools/benchmark/formatter-harness.mjs";

test("30 exact paper cards finish ordinary formatting with zero Scryfall requests and zero enrichment waits", async () => {
  await withHarness(createFixture(), async ({ format, formatter, clock }) => {
    const result = await format();
    assert.equal(result.items.length, 30);
    assert.ok(result.items.every((item) => item.status === "found"));
    assert.equal(remoteRequestCount(result), 0);
    assert.equal(result.counts.manifest, 1);
    assert.equal(result.counts.index, 1);
    assert.equal(result.cardsResolvedLocally, 30);
    const start = clock.now;
    const enriched = await formatter.enrichPrintHistories(result.items, false, [], () => {}, false, { enrichmentPurpose: "formatter" });
    assert.equal(clock.now - start, 0, "No network means no per-five-card waits");
    assert.deepEqual(enriched.map((item) => item.index), result.items.map((item) => item.index));
    assert.match(result.output, /=== Rarity Shifted ===\n\[ \] 1 Ponder/);
  });
});

test("one foil request among 24 ordinary cards verifies only that printing", async () => {
  const fixture = createFixture({ text: [...ordinaryNames.slice(0, 24), "Beast Within FOIL"].join("\n") });
  const result = await withHarness(fixture, ({ format }) => format());
  assert.equal(result.items.length, 25);
  assert.equal(result.counts.history, 2);
  assert.equal(result.cardsRequiringRemote, 1);
  assert.equal(result.counts.collection + result.counts.exact, 1);
  assert.deepEqual(result.requests.filter(({ type }) => ["collection", "exact", "history"].includes(type)).flatMap(({ names }) => names), ["Beast Within", "Beast Within", "Beast Within"]);
  assert.ok(result.items.every((item) => item.status === "found"));
  assertPacing(result);
});

test("only two misspellings enter collection and fuzzy resolution, retaining source order", async () => {
  const text = ["Sol Ring", "Ligtning Bolt", "Counterspell", "Sakra-Tribe Elder", "Ponder"].join("\n");
  const result = await withHarness(createFixture({ text }), ({ format }) => format());
  assert.equal(result.counts.collection, 1);
  assert.equal(result.counts.fuzzy, 2);
  assert.equal(result.counts.exact, 0, "Resolved Scryfall objects must not be looked up exactly again");
  assert.deepEqual(result.requests.find(({ type }) => type === "collection").names, ["Ligtning Bolt", "Sakra-Tribe Elder"]);
  assert.equal(result.cardsRequiringRemote, 2);
  assert.deepEqual(result.items.map((item) => item.index), [0, 1, 2, 3, 4]);
  assert.deepEqual(result.items.map((item) => item.card.name), ["Sol Ring", "Lightning Bolt", "Counterspell", "Sakura-Tribe Elder", "Ponder"]);
  assertPacing(result);
});

test("mixed punctuation, duplicates, ambiguous names, specials, token and basic land retain printable baseline semantics", async () => {
  const baseline = await withHarness(mixedFixture(), ({ format }) => format(), { revision: "baseline" });
  const result = await withHarness(mixedFixture(), ({ format }) => format());
  assert.equal(result.output, baseline.output);
  assert.equal(result.items.find((item) => item.inputName === "Sol Ring").quantity, 3);
  assert.equal(result.items.find((item) => item.inputName === "Gather").status, "review");
  assert.equal(result.counts.fuzzy, 3);
  assert.equal(result.counts.search, 1);
  assert.ok(remoteRequestCount(result) < remoteRequestCount(baseline));
  assertPacing(result);
});

test("Case Check preserves CHECK CASE and CASE? and still obtains complete histories", async () => {
  const fixture = createFixture({ text: "Ajani, Mentor of Heroes\nSol Ring\nMisty Rainforest", caseCheck: true });
  const result = await withHarness(fixture, ({ format }) => format());
  assert.equal(result.counts.sets, 1);
  assert.equal(result.cardsRequiringRemote, 3);
  assert.equal(result.counts.history, 6);
  assert.deepEqual(result.items.map((item) => item.caseNote), ["CHECK CASE", "CASE?", "CASE?"]);
  assertPacing(result);
});

test("Careful Mode keeps at least 500ms between Scryfall starts and serial network work", async () => {
  const result = await withHarness(createFixture({ text: "Sol Ring FOIL\nCounterspell SHOWCASE\nLigtning Bolt", carefulMode: true }), ({ format }) => format());
  assert.ok(remoteRequestCount(result) > 0);
  assert.equal(result.maxConcurrentRequests, 1);
  assertPacing(result, 500);
});

test("transient Scryfall failure retries once, preserves output, and respects rate limits", async () => {
  const healthy = await withHarness(createFixture({ text: "Sol Ring FOIL" }), ({ format }) => format());
  const result = await withHarness(createFixture({ text: "Sol Ring FOIL", transient: true }), ({ format }) => format());
  assert.equal(result.output, healthy.output);
  assert.equal(remoteRequestCount(result), remoteRequestCount(healthy) + 1);
  assert.equal(result.counts.retries, 1);
  assert.ok(result.durationMs >= healthy.durationMs + 900);
  assertPacing(result);
});

test("prior schema exact matches conservatively require paper verification", async () => {
  const fixture = createFixture({ text: "Sol Ring" });
  fixture.index.version = 2;
  delete fixture.index.rarityHistoryComplete;
  for (const card of Object.values(fixture.index.cards)) {
    delete card.hasPlayablePaperPrinting;
    delete card.paperRarities;
  }
  const result = await withHarness(fixture, ({ format }) => format());
  assert.ok(remoteRequestCount(result) > 0);
  assert.equal(result.items[0].status, "found");
  assert.ok(result.items[0].prints.length);
});

test("unavailable providers preserve every affected card as Needs Review", async () => {
  const result = await withHarness(createFixture({ text: "Sol Ring\nCounterspell", manifestFailure: true }), ({ format }) => format({ useScryfall: false }));
  assert.equal(result.items.length, 2);
  assert.ok(result.items.every((item) => item.status === "review"));
  assert.equal(remoteRequestCount(result), 0);
  assert.match(result.output, /NEEDS REVIEW/);
});

test("simultaneous MTGJSON and Scryfall outages return a complete reviewable list", async () => {
  const result = await withHarness(createFixture({ text: "Sol Ring\nCounterspell", manifestFailure: true, scryfallFailure: true }), ({ format }) => format());
  assert.equal(result.items.length, 2);
  assert.ok(result.items.every((item) => item.status === "review"));
  assert.ok(remoteRequestCount(result) > 0);
  assert.match(result.output, /NEEDS REVIEW/);
  assert.match(result.output, /Sol Ring/);
  assert.match(result.output, /Counterspell/);
  assertPacing(result);
});

test("persisted compact formatter items recover only a card whose pricing shard is absent", async () => {
  const source = buildSync({ entryPoints: ["src/PricingPanel.tsx"], bundle: true, platform: "node", format: "esm", loader: { ".css": "empty" }, write: false, logLevel: "silent" }).outputFiles[0].text;
  const { fallbackCatalogWithPrintHistories } = await import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
  await withHarness(createFixture({ text: "Sol Ring\nCounterspell\nLightning Bolt" }), async ({ format, formatter, counters }) => {
    const initial = await format();
    assert.equal(remoteRequestCount(initial), 0);
    const persisted = JSON.parse(JSON.stringify(formatter.compactFormatterItems(initial.items)));
    assert.ok(persisted.every((item) => !item.prints));
    const printing = { uuid: "preserved-primary-uuid", setCode: "OLD", setName: "Primary", finishes: ["normal"], treatments: ["standard"], prices: {} };
    const catalog = { "sol ring": { name: "Sol Ring", printings: [printing] }, "counterspell": { name: "Counterspell", printings: [printing] } };
    const names = persisted.map((item) => item.card.name);
    // A failed shard reaches this actual panel helper with ALL requested names.
    // The helper must exclude the two cards already supplied by healthy shards.
    const recovered = await fallbackCatalogWithPrintHistories(persisted, catalog, names, () => {});
    assert.ok(recovered.catalog["lightning bolt"].printings.length > 0);
    assert.equal(recovered.failedCardKeys.size, 0);
    assert.equal(counters.exact, 1);
    assert.equal(counters.history, 2);
    assert.deepEqual(recovered.catalog["sol ring"], catalog["sol ring"]);
    assert.deepEqual(recovered.catalog.counterspell, catalog.counterspell);
    assert.equal(initial.items[0].prints, undefined);
  });
});

test("v3 digital-only evidence cannot become a locally verified paper card", async () => {
  const fixture = createFixture({ text: "Sol Ring\nCounterspell" });
  fixture.index.cards["sol ring"].hasPlayablePaperPrinting = false;
  fixture.index.cards["sol ring"].paperRarities = [];
  Object.assign(fixture.providerCards.get("Sol Ring"), { digital: true, games: ["arena"] });
  const result = await withHarness(fixture, ({ format }) => format());
  assert.equal(result.items[0].status, "review");
  assert.equal(result.items[1].status, "found");
  assert.equal(result.cardsRequiringRemote, 1);
  assert.match(result.items[0].note, /playable paper/i);
});

test("incomplete local rarity history requests Scryfall without demoting unrelated known cards", async () => {
  const fixture = createFixture({ text: "Sol Ring\nCounterspell" });
  fixture.index.cards["sol ring"].paperRarities = [];
  const result = await withHarness(fixture, ({ format }) => format());
  assert.equal(result.cardsRequiringRemote, 1);
  assert.equal(result.counts.history, 2);
  assert.ok(result.items.every((item) => item.status === "found"));
});

test("concurrent consumers of the same printing history reuse its in-flight pages", async () => {
  await withHarness(createFixture({ text: "Sol Ring" }), async ({ formatter, fixture, counters, requests }) => {
    const item = { ...formatter.parsePullList("Sol Ring FOIL").cards[0], status: "found", card: fixture.providerCards.get("Sol Ring") };
    const signal = new AbortController().signal;
    const options = { enrichmentPurpose: "pricing-recovery", signal };
    const [first, second] = await Promise.all([
      formatter.enrichPrintHistories([item], false, [], () => {}, false, options),
      formatter.enrichPrintHistories([{ ...item, index: 9, quantity: 4 }], false, [], () => {}, false, options),
    ]);
    assert.equal(counters.history, 2, "Two consumers share both history pages");
    assert.equal(counters.exact, 0, "Existing canonical response supplies the URI");
    assert.equal(first[0].quantity, 1);
    assert.equal(second[0].quantity, 4);
    assert.equal(second[0].index, 9);
    assert.ok(first[0].prints.length && second[0].prints.length);
    assertPacing({ requests });
  });
});

test("canceling active and queued Scryfall work releases the gate for a fresh processing run", async () => {
  await withHarness(createFixture({ text: "Sol Ring FOIL\nCounterspell SHOWCASE" }), async ({ formatter, fixture, clock, format, requests }) => {
    const signalController = new AbortController();
    const items = formatter.parsePullList(fixture.text).cards.map((item) => ({ ...item, status: "found", card: fixture.providerCards.get(item.inputName) }));
    const messages = [];
    const task = formatter.enrichPrintHistories(items, false, [], (message) => messages.push(message), false, { enrichmentPurpose: "formatter", signal: signalController.signal });
    setTimeout(() => signalController.abort(), 40);
    await assert.rejects(task, { name: "AbortError" });
    assert.equal(clock.now, 40, "Cancel must interrupt an active request and queued slot promptly");
    const messagesAtCancel = messages.length;
    const result = await format();
    assert.ok(result.items.every((item) => item.status === "found"));
    assert.equal(messages.length, messagesAtCancel, "Canceled work must not emit later progress");
    assertPacing({ requests });
  });
});

test("exhausted print-history retries retain the failed exception in review and leave ordinary cards usable", async () => {
  const result = await withHarness(createFixture({ text: "Sol Ring FOIL\nCounterspell", historyFailure: true }), ({ format }) => format());
  assert.equal(result.items[0].status, "review");
  assert.equal(result.items[0].printLookupFailed, true);
  assert.equal(result.items[0].printHistoryRetried, true);
  assert.equal(result.items[1].status, "found");
  assert.equal(result.counts.history, 12, "Only the failed first history page gets the bounded 4-attempt/3-pass retry budget");
  assert.equal(result.counts.collection, 1);
  assert.equal(result.counts.exact, 0);
  assertPacing(result);
});

test("each supported requested finish/treatment and a structured set still receives successful printing verification", async () => {
  const variants = [
    ["Sol Ring FOIL", {}],
    ["Sol Ring SURGE FOIL", { promo_types: ["surgefoil"] }],
    ["Sol Ring ETCHED", {}],
    ["Sol Ring SHOWCASE", {}],
    ["Sol Ring BORDERLESS", {}],
    ["Sol Ring EXTENDED ART", { frame_effects: ["extendedart"] }],
    ["Sol Ring FULL ART", {}],
    ["Sol Ring RETRO FRAME", { frame_effects: ["retro"] }],
    ["Sol Ring ALT ART", { promo_types: ["alternateart"] }],
    ["Sol Ring PROMO", { promo: true }],
    ["Sol Ring - Uncommon - $1.00 - OLD - Colorless", {}],
  ];
  for (const [text, printingFields] of variants) {
    const fixture = createFixture({ text: `${text}\nCounterspell` });
    Object.assign(fixture.providerCards.get("Sol Ring"), printingFields);
    const result = await withHarness(fixture, ({ format }) => format());
    assert.equal(result.items[0].status, "found", text);
    assert.equal(result.items[1].status, "found", text);
    assert.equal(result.counts.history, 2, text);
    assert.equal(result.cardsRequiringRemote, 1, text);
    assert.equal(result.items[0].inputName, "Sol Ring", text);
  }
});

test("requested flavor identity survives local canonical resolution, remote verification, and compact persistence", async () => {
  const fixture = createFixture({ text: "Raph's Jitte\nCounterspell" });
  fixture.index.aliases["raphs jitte"] = "umezawas jitte";
  fixture.index.aliases.raphsjitte = "umezawas jitte";
  fixture.providerCards.get("Umezawa's Jitte").flavor_name = "Raph's Jitte";
  await withHarness(fixture, async ({ format, formatter }) => {
    const result = await format();
    assert.equal(result.items[0].status, "found");
    assert.equal(result.items[0].card.name, "Umezawa's Jitte");
    assert.equal(result.items[0].alternateTitle, "Raph's Jitte");
    assert.equal(result.cardsRequiringRemote, 1);
    const [compact] = formatter.compactFormatterItems(result.items);
    assert.equal(compact.card.name, "Umezawa's Jitte");
    assert.equal(compact.alternateTitle, "Raph's Jitte");
    assert.match(result.output, /Umezawa's Jitte \(Raph's Jitte\)/);
  });
});

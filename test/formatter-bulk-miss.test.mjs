import assert from "node:assert/strict";
import test from "node:test";
import { createFixture, ordinaryNames, withHarness, remoteRequestCount } from "../tools/benchmark/formatter-harness.mjs";

function bulkFixture({ count = 20, misses = 13, structured = true, marker = "", ...overrides } = {}) {
  const fixture = createFixture(overrides);
  const names = ordinaryNames.slice(0, count);
  fixture.text = names.map((name, index) => structured
    ? `1 ${name} (TST) ${String(index + 1).padStart(3, "0")}${marker ? ` ${marker}` : ""}`
    : name).join("\n");
  const missingNames = new Set(names.slice(0, misses));
  const removedKeys = new Set();
  for (const [key, card] of Object.entries(fixture.index.cards)) {
    if (missingNames.has(card.name)) { delete fixture.index.cards[key]; removedKeys.add(key); }
  }
  for (const [alias, target] of Object.entries(fixture.index.aliases)) if (removedKeys.has(target)) delete fixture.index.aliases[alias];
  return fixture;
}

test("bulk export guard stops thirteen true misses among twenty ordinary names before remote requests", async () => {
  const result = await withHarness(bulkFixture(), ({ format }) => format());
  assert.equal(result.items.length, 20);
  assert.equal(result.items.filter((item) => item.status === "found").length, 7);
  assert.equal(result.items.filter((item) => item.status === "review").length, 13);
  assert.equal(result.performance.exactMissRatio, 0.65);
  assert.equal(result.performance.bulkMissGuardTriggered, true);
  assert.equal(result.performance.counts.fuzzyLookupsPrevented, 13);
  assert.equal(remoteRequestCount(result), 0);
  assert.equal(result.durationMs, 220);
  assert.match(result.output, /=== NEEDS REVIEW ===/);
  assert.match(result.messages.join("\n"), /Most card names failed exact matching.*unsupported export format.*Automatic provider lookups were stopped/);
  assert.equal(result.performance.providerCircuitState, "closed", "Parsing safety is distinct from provider failure");
});

test("a 215-row systematic export failure cannot enter fuzzy or printing-history fan-out", async () => {
  const fixture = createFixture();
  fixture.index = { version: 3, rarityHistoryComplete: true, cards: {}, aliases: {}, ambiguousAliases: {} };
  fixture.text = Array.from({ length: 215 }, (_, index) => `1 Bulk Export Fixture ${String(index + 1).padStart(3, "0")} (PMKM) ${index + 1}s *Z*`).join("\n");
  const result = await withHarness(fixture, ({ format }) => format());
  assert.equal(result.items.length, 215);
  assert.equal(result.performance.counts.mtgjsonMisses, 215);
  assert.equal(result.performance.exactMissRatio, 1);
  assert.equal(result.performance.bulkMissGuardTriggered, true);
  assert.equal(result.performance.counts.fuzzyLookupsPrevented, 215);
  assert.equal(result.counts.collection + result.counts.exact + result.counts.fuzzy + result.counts.history, 0);
  assert.equal(result.durationMs, 220);
  assert.ok(result.items.every((item) => item.status === "review"));
});

test("the bulk guard is strict above sixty percent and requires twenty unique names", async () => {
  for (const options of [{ count: 20, misses: 12 }, { count: 19, misses: 13 }]) {
    const result = await withHarness(bulkFixture(options), ({ format }) => format());
    assert.equal(result.performance.bulkMissGuardTriggered, false);
    assert.equal(result.performance.counts.fuzzyLookupsPrevented, 0);
    assert.equal(result.counts.collection, 1);
    assert.equal(result.counts.history, options.misses * 2);
    assert.ok(result.items.every((item) => item.status === "found"));
  }
});

test("large name-only misses retain bounded provider recovery without an unsupported-export diagnosis", async () => {
  const result = await withHarness(bulkFixture({ misses: 20, structured: false }), ({ format }) => format());
  assert.equal(result.performance.exactMissRatio, 1);
  assert.equal(result.performance.bulkMissGuardTriggered, false);
  assert.equal(result.performance.counts.fuzzyLookupsPrevented, 0);
  assert.ok(remoteRequestCount(result) > 0 && remoteRequestCount(result) <= 40);
});

test("the guard requires systematic export evidence among missing names", async () => {
  const fixture = bulkFixture();
  const lines = fixture.text.split("\n");
  // Seven of thirteen misses have export evidence: below the 60% evidence threshold.
  for (let index = 7; index < 13; index += 1) lines[index] = ordinaryNames[index];
  fixture.text = lines.join("\n");
  const result = await withHarness(fixture, ({ format }) => format());
  assert.equal(result.performance.exactMissRatio, 0.65);
  assert.equal(result.performance.bulkMissGuardTriggered, false);
  assert.equal(result.counts.collection, 1);
  assert.ok(result.items.every((item) => item.status === "found"));
});

test("imported foil markers stay ordinary for the bulk guard", async () => {
  const result = await withHarness(bulkFixture({ marker: "*f*" }), ({ format }) => format());
  assert.equal(result.performance.bulkMissGuardTriggered, true);
  assert.equal(result.performance.counts.fuzzyLookupsPrevented, 13);
  assert.equal(remoteRequestCount(result), 0);
  assert.ok(result.items.every((item) => item.requestedPrinting?.finish === "foil"));
});

test("a guard preserves genuine prose-printing exceptions for selective recovery", async () => {
  const fixture = bulkFixture();
  fixture.text += "\nSol Ring FOIL";
  const result = await withHarness(fixture, ({ format }) => format());
  assert.equal(result.items.length, 21);
  assert.equal(result.performance.bulkMissGuardTriggered, true);
  assert.equal(result.performance.exactMissRatio, 0.65);
  assert.equal(result.counts.collection, 1);
  assert.equal(result.counts.history, 2);
  const explicitFoil = result.items.find((item) => item.inputName === "Sol Ring" && !item.requestedPrinting?.sourceFormat);
  assert.equal(explicitFoil.status, "found");
  assert.ok(result.requests.filter((request) => !["manifest", "index"].includes(request.type)).every((request) => request.names.every((name) => name === "Sol Ring")));
});

test("duplicate printing rows do not inflate the unique-name threshold", async () => {
  const fixture = bulkFixture({ count: 5, misses: 5 });
  fixture.text = ordinaryNames.slice(0, 5).flatMap((name) => Array.from({ length: 4 }, (_, index) => `1 ${name} (TST) ${index + 1}`)).join("\n");
  const result = await withHarness(fixture, ({ format }) => format());
  assert.equal(result.performance.exactMissRatio, 1);
  assert.equal(result.performance.bulkMissGuardTriggered, false);
  assert.equal(result.performance.counts.fuzzyLookupsPrevented, 0);
  assert.ok(result.counts.collection > 0);
});

test("a few misspellings and newly indexed exceptions in healthy exports still recover normally", async () => {
  const fixture = bulkFixture({ misses: 1 });
  fixture.text = fixture.text.replace("Lightning Bolt", "Ligtning Bolt");
  const result = await withHarness(fixture, ({ format }) => format());
  assert.equal(result.performance.exactMissRatio, 0.05);
  assert.equal(result.performance.bulkMissGuardTriggered, false);
  assert.equal(result.counts.fuzzy, 1);
  assert.equal(result.counts.history, 2);
  assert.equal(result.items[0].card.name, "Lightning Bolt");
  assert.ok(result.items.every((item) => item.status === "found"));

  const newCard = await withHarness(bulkFixture({ misses: 1 }), ({ format }) => format());
  assert.equal(newCard.performance.bulkMissGuardTriggered, false);
  assert.equal(newCard.counts.fuzzy, 0);
  assert.equal(newCard.counts.history, 2);
  assert.ok(newCard.items.every((item) => item.status === "found"));
});

test("unrecognized terminal export markers are guarded without losing any input entry", async () => {
  const fixture = bulkFixture({ misses: 20, marker: "*Z*" });
  const result = await withHarness(fixture, ({ format }) => format());
  assert.equal(result.items.length, 20);
  assert.equal(result.performance.bulkMissGuardTriggered, true);
  assert.equal(result.performance.counts.fuzzyLookupsPrevented, 20);
  assert.equal(remoteRequestCount(result), 0);
  assert.ok(result.items.every((item) => item.status === "review" && item.original.includes("*Z*")));
});

test("bulk diagnostics contain only numeric counts and flags, and a later run starts fresh", async () => {
  const fixture = bulkFixture();
  fixture.text = `Name: Private Export Customer\nEmail: private-export@example.test\n${fixture.text}`;
  await withHarness(fixture, async ({ format }) => {
    const stopped = await format();
    assert.equal(stopped.performance.bulkMissGuardTriggered, true);
    assert.match(stopped.performanceText, /exactMissRatio: 0.65/);
    assert.match(stopped.performanceText, /fuzzyLookupsPrevented: 13/);
    assert.doesNotMatch(stopped.performanceText, /Private Export Customer|private-export|Lightning Bolt|https?:|token=/);
    fixture.text = "Lightning Bolt";
    const later = await format();
    assert.equal(later.performance.bulkMissGuardTriggered, false);
    assert.equal(later.performance.counts.fuzzyLookupsPrevented, 0);
    assert.equal(later.items[0].status, "found");
  });
});

test("an employee-selected review subset can recover without inheriting the previous bulk guard", async () => {
  const fixture = bulkFixture();
  await withHarness(fixture, async ({ format, formatter, diagnostics }) => {
    const stopped = await format();
    const reviewItem = stopped.items.find((item) => item.status === "review");
    assert.equal(reviewItem.bulkMissGuarded, true);
    const report = diagnostics.createProcessingPerformance();
    const options = { useMtgjson: true, useScryfall: true, enrichmentPurpose: "formatter", signal: null, performance: report };
    const resolved = await formatter.resolveCardNames([{ ...reviewItem, status: "missing", note: "" }], () => {}, false, options);
    const [recovered] = await formatter.enrichPrintHistories(resolved, false, [], () => {}, false, options);
    assert.equal(recovered.status, "found");
    assert.equal(recovered.bulkMissGuarded, false);
    assert.equal(report.bulkMissGuardTriggered, false);
    assert.equal(report.counts.fuzzyLookupsPrevented, 0);
  });
});

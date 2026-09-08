import assert from "node:assert/strict";
import test from "node:test";
import { buildSync } from "esbuild";
import { structuredExportExamples, structuredExportFixture, createFixture, withHarness, importFormatter, remoteRequestCount, assertPacing, MANIFEST_URL } from "../tools/benchmark/formatter-harness.mjs";

const formatter = await importFormatter();
async function bundled(path) {
  const source = buildSync({ entryPoints: [path], bundle: true, platform: "node", format: "esm", write: false, logLevel: "silent" }).outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

for (const example of structuredExportExamples) {
  test(`public parser separates exact identity and printing hint for ${example.name}`, () => {
    const raw = `1 ${example.rawName || example.name} (${example.setCode}) ${example.collectorNumber}${example.marker ? ` ${example.marker}` : ""}`;
    const parsed = formatter.parsePullList(raw);
    assert.equal(parsed.cards.length, 1);
    const [item] = parsed.cards;
    assert.equal(item.inputName, example.name);
    assert.equal(item.quantity, 1);
    assert.equal(item.original, raw);
    assert.deepEqual(item.originals, [raw]);
    assert.equal(item.requestedPrinting.setCode, example.setCode);
    assert.equal(item.requestedPrinting.collectorNumber, example.collectorNumber);
    assert.equal(item.requestedPrinting.sourceFormat, "set-collector-export");
    if (example.marker) {
      assert.equal(item.requestedPrinting.finish, "foil");
      assert.equal(item.requestedPrinting.foilTreatment, "standard");
    }
    assert.equal(item.lookupKey, example.name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w/ ]+/g, "").replace(/\s+/g, " ").trim());
  });
}

test("right-anchored export grammar preserves collector text and internal name punctuation", () => {
  for (const setCode of ["2X2", "5DN", "H2R", "PMKM", "V09", "V10", "007"]) {
    for (const collectorNumber of ["0007", "260s", "A-12", "12.5", "12/281", "123★", "★"]) {
      const raw = `2 Captain's Archive: East-West (First Edition) (${setCode}) ${collectorNumber} *f*`;
      const [item] = formatter.parsePullList(raw).cards;
      assert.equal(item.inputName, "Captain's Archive: East-West (First Edition)", raw);
      assert.equal(item.quantity, 2);
      assert.equal(item.requestedPrinting.setCode, setCode);
      assert.equal(item.requestedPrinting.collectorNumber, collectorNumber);
      assert.equal(item.requestedPrinting.finish, "foil");
    }
  }
});

test("ordinary parentheses, bare trailing numbers and name asterisks do not become imported printing hints", () => {
  for (const name of ["B.F.M. (Big Furry Monster)", "Our Market (After Hours)", "Seven Dwarves 7", "Archive *F* Watcher", "Name*With*Asterisks", "Archive (TST) 1 extra text"]) {
    const [item] = formatter.parsePullList(`1 ${name}`).cards;
    assert.equal(item.inputName, name, name);
    assert.notEqual(item.requestedPrinting?.sourceFormat, "set-collector-export", name);
    assert.notEqual(item.requestedPrinting?.finish, "foil", name);
  }
});

test("pure export helper requires the complete suffix and uses the final parenthetical candidate", async () => {
  const { parseStructuredExportLine } = await bundled("src/structured-export.ts");
  assert.deepEqual(parseStructuredExportLine("1 B.F.M. (Big Furry Monster) (UGL) 28a *f*"), {
    name: "B.F.M. (Big Furry Monster)", setCode: "UGL", collectorNumber: "28a", finish: "foil", foilTreatment: "standard", sourceFormat: "set-collector-export",
  });
  for (const line of ["1 Archive (TST)", "1 Seven Dwarves 7", "1 Archive *F* Watcher", "1 Archive (TST) *F*", "1 Archive (TST) 7 *Z*"]) assert.equal(parseStructuredExportLine(line), null, line);
  const [legacySet] = formatter.parsePullList("1 Archive (TST)").cards;
  assert.notEqual(legacySet.requestedPrinting?.sourceFormat, "set-collector-export", "Existing parenthetical prose metadata is distinct from imported set+collector grammar");
});

test("quantity removal never strips a numeric word from the card's canonical name", () => {
  const [item] = formatter.parsePullList("1 1996 World Champion (PCEL) 1").cards;
  assert.equal(item.quantity, 1);
  assert.equal(item.inputName, "1996 World Champion");
  assert.equal(item.lookupKey, "1996 world champion");
  assert.equal(item.requestedPrinting.collectorNumber, "1");
});

test("structured token metadata excludes set and collector text while retaining true token details", () => {
  for (const [raw, name, details, colors] of [
    ["1 Goblin Token (TST) 1/281", "Goblin Token", [], []],
    ["1 Bird Token (RED) 004", "Bird Token", [], []],
    ["1 Blue Bird Token 1/1 Flying (RED) 1/281", "Blue Bird Token", ["1/1", "Flying"], ["Blue"]],
  ]) {
    const [item] = formatter.parsePullList(raw).cards;
    assert.equal(item.inputName, name);
    assert.deepEqual(item.tokenDetails, details);
    assert.deepEqual(item.tokenColors, colors);
    assert.equal(item.original, raw);
    assert.deepEqual(item.originals, [raw]);
    assert.equal(item.status, "found");
  }
});

test("215 structured export rows resolve locally with exact hints and no unnecessary provider work", async () => {
  const fixture = structuredExportFixture();
  const result = await withHarness(fixture, ({ format }) => format());
  assert.equal(fixture.text.split("\n").length, 215);
  assert.equal(result.items.length, 215);
  assert.equal(result.performance.counts.mtgjsonMatches, 215);
  assert.equal(result.performance.counts.mtgjsonMisses, 0);
  assert.equal(remoteRequestCount(result), 0);
  assert.equal(result.counts.fuzzy, 0);
  assert.equal(result.counts.history, 0);
  assert.equal(result.durationMs, 220, "Only mocked manifest and index latency remains");
  assert.equal(result.performance.counts.structuredExportRowsDetected, 215);
  assert.equal(result.performance.counts.structuredExportRowsParsed, 215);
  assert.equal(result.performance.counts.importedPrintingHints, 215);
  assert.equal(result.performance.counts.mojibakeCorrections, 1);
  assert.equal(result.performance.exactMissRatio, 0);
  assert.equal(result.performance.bulkMissGuardTriggered, false);
  for (const [index, item] of result.items.entries()) {
    const row = fixture.structuredRows[index];
    assert.equal(item.index, index);
    assert.equal(item.status, "found");
    assert.equal(item.inputName, row.name);
    assert.equal(item.card.name, row.name);
    assert.equal(item.lookupSource, "mtgjson");
    assert.equal(item.requestedPrinting.setCode, row.setCode);
    assert.equal(item.requestedPrinting.collectorNumber, row.collectorNumber);
    assert.doesNotMatch(item.inputName, /\([A-Z0-9]+\)\s+\S+$|\*F\*/i);
    if (row.marker) assert.equal(item.requestedPrinting.finish, "foil");
  }
  assert.match(result.output, /=== Rarity Shifted ===/);
  assert.match(result.output, /=== Mythic\/Rare ===/);
  assert.match(result.output, /Mox Diamond.*FOIL/);
  assert.doesNotMatch(result.output, /\(2X2\) 43|\(PMKM\) 260s|\*F\*/);
  assertPacing(result);
});

test("same imported printing duplicates merge quantity while distinct collector numbers retain separate requests", async () => {
  const duplicates = structuredExportFixture({ duplicateRows: true });
  const result = await withHarness(duplicates, ({ format }) => format());
  assert.equal(duplicates.text.split("\n").length, 220);
  assert.equal(result.items.length, 215);
  assert.ok(result.items.slice(0, 5).every((item) => item.quantity === 2 && item.originals.length === 2));
  assert.equal(remoteRequestCount(result), 0);
  const parsed = formatter.parsePullList("1 Elegant Parlor (PMKM) 260s *F*\n2 Elegant Parlor (PMKM) 0260 *F*");
  assert.equal(parsed.cards.length, 2);
  assert.deepEqual(parsed.cards.map((item) => item.requestedPrinting.collectorNumber), ["260s", "0260"]);
  assert.deepEqual(parsed.cards.map((item) => item.quantity), [1, 2]);
  assert.equal(parsed.cards[0].lookupKey, parsed.cards[1].lookupKey, "Canonical lookup identity stays independent of exact-printing grouping");
});

test("an imported foil hint stays local while an explicit prose foil request still verifies printing history", async () => {
  const fixture = createFixture({ text: "1 Sol Ring (OLD) 001 *F*\nCounterspell FOIL" });
  const result = await withHarness(fixture, ({ format }) => format());
  assert.equal(result.items[0].status, "found");
  assert.equal(result.items[0].requestedPrinting.collectorNumber, "001");
  assert.equal(result.items[1].status, "found");
  assert.equal(result.counts.collection, 1);
  assert.equal(result.counts.history, 2);
  assert.ok(result.requests.filter(({ type }) => type === "history").every(({ names }) => names[0] === "Counterspell"));
  assert.match(result.output, /Sol Ring.*FOIL/);
  assertPacing(result);
});

test("Case Check still receives full histories for imported hints when enabled", async () => {
  const result = await withHarness(createFixture({ text: "1 Sol Ring (OLD) 001 *F*", caseCheck: true }), ({ format }) => format());
  assert.equal(result.items[0].status, "found");
  assert.equal(result.counts.collection, 1);
  assert.equal(result.counts.sets, 1);
  assert.equal(result.counts.history, 2);
  assert.equal(result.items[0].caseNote, "CASE?");
  assertPacing(result);
});

test("mojibake repair is cautious, reversible and preserves already-correct Unicode", async () => {
  const { repairMojibake } = await bundled("src/structured-export.ts");
  assert.equal(repairMojibake("Palant\u00c3\u00adr of Orthanc"), "Palantír of Orthanc");
  assert.equal(repairMojibake("Urza\u00e2\u20ac\u2122s Saga"), "Urza’s Saga");
  for (const correct of ["Lórien Revealed", "Palantír of Orthanc", "Urza’s Saga", "Dúnedain Rangers", "雪", "Æther Gust", "Ã", "Name \uFFFD unknown"]) {
    assert.equal(repairMojibake(correct), correct);
  }
  const [item] = formatter.parsePullList("1 Palant\u00c3\u00adr of Orthanc (LTR) 247").cards;
  assert.equal(item.inputName, "Palantír of Orthanc");
  assert.equal(item.lookupKey, "palantir of orthanc");
  assert.equal(item.original, "1 Palant\u00c3\u00adr of Orthanc (LTR) 247");
});

test("mojibake repair changes only structured card names and preserves raw collector identifiers", () => {
  const collectorNumber = "\u00c3\u0160";
  const raw = `1 Palant\u00c3\u00adr of Orthanc (LTR) ${collectorNumber} *F*`;
  const parsed = formatter.parsePullList(raw);
  const [item] = parsed.cards;
  assert.equal(item.inputName, "Palantír of Orthanc");
  assert.equal(item.requestedPrinting.collectorNumber, collectorNumber);
  assert.equal(item.requestedPrinting.setCode, "LTR");
  assert.equal(item.requestedPrinting.finish, "foil");
  assert.equal(item.original, raw);
  assert.deepEqual(item.originals, [raw]);
  assert.equal(parsed.diagnostics.structuredExportRowsDetected, 1);
  assert.equal(parsed.diagnostics.structuredExportRowsParsed, 1);
  assert.equal(parsed.diagnostics.importedPrintingHints, 1);
  assert.equal(parsed.diagnostics.mojibakeCorrections, 1);
  const unchanged = formatter.parsePullList(`1 Sol Ring (CMM) ${collectorNumber}`);
  assert.equal(unchanged.cards[0].requestedPrinting.collectorNumber, collectorNumber);
  assert.equal(unchanged.diagnostics.mojibakeCorrections, 0);
});

test("structured printing preferences survive Saved Pull List and share normalization without raw provider payloads", async () => {
  const jobs = await bundled("src/pull-list-job.ts");
  const shares = await bundled("src/share-link.ts");
  await withHarness(createFixture({ text: "1 Sol Ring (OLD) 0007 *F*" }), async ({ format, formatter }) => {
    const result = await format();
    const compact = formatter.compactFormatterItems(result.items);
    const draft = jobs.normalizePullListJobDraft({ formatterItems: compact, output: result.output });
    const shared = shares.decodeFormatterHash(shares.encodeFormattedHash({ formatterItems: compact, output: result.output }));
    for (const items of [compact, draft.formatterItems, shared.formatterItems]) {
      assert.equal(items[0].requestedPrinting.collectorNumber, "0007");
      assert.equal(items[0].requestedPrinting.sourceFormat, "set-collector-export");
      assert.equal(items[0].requestedPrinting.finish, "foil");
      assert.equal(items[0].prints, undefined);
      assert.equal(items[0].card?.prints_search_uri, undefined);
    }
    const legacy = jobs.normalizePullListJobDraft({ formatterItems: [{ ...compact[0], requestedPrinting: { setCode: "OLD", finish: "foil" } }] });
    assert.equal(legacy.formatterItems[0].requestedPrinting.collectorNumber, undefined);
    assert.equal(legacy.formatterItems[0].requestedPrinting.setCode, "OLD");
  });
});

test("server/email processing uses clean structured names and keeps all 215 printable entries local", async () => {
  const fixture = structuredExportFixture();
  await withHarness(fixture, async ({ formatter, counters }) => {
    const result = await formatter.processPullListText(fixture.text, { mtgjsonManifestUrl: MANIFEST_URL, processedAt: "2026-09-07T12:00:00.000Z" });
    assert.equal(result.items.length, 215);
    assert.ok(result.items.every((item) => item.status === "found"));
    assert.equal(result.performance.counts.mtgjsonMatches, 215);
    assert.equal(result.performance.counts.structuredExportRowsParsed, 215);
    assert.equal(counters.collection + counters.exact + counters.fuzzy + counters.history, 0);
  });
});

test("structured diagnostics retain numeric aggregates without card names, raw lines or customer details", async () => {
  const fixture = structuredExportFixture();
  fixture.text = `Name: Private Export Customer\nEmail: private-export@example.test\n${fixture.text}`;
  const result = await withHarness(fixture, ({ format }) => format());
  assert.doesNotMatch(result.performanceText, /Private Export|private-export|Consecrated|Elegant Parlor|Palant|\(PMKM\)|https?:/i);
  for (const field of ["structuredExportRowsDetected", "structuredExportRowsParsed", "importedPrintingHints", "mojibakeCorrections", "exactMissRatio", "bulkMissGuardTriggered", "fuzzyLookupsPrevented"]) {
    assert.match(result.performanceText, new RegExp(field));
  }
});

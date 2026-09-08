import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { importBundledModule } from "./test-module-bundle.mjs";

const pricing = await importBundledModule("src/pricing.ts", "imported-printing-pricing");
const formatter = await importBundledModule("src/formatter.ts", "imported-printing-formatter");
const jobs = await importBundledModule("src/pull-list-job.ts", "imported-printing-jobs");
const sharing = await importBundledModule("src/share-link.ts", "imported-printing-share");
const fingerprint = await importBundledModule("src/pull-list-fingerprint.ts", "imported-printing-fingerprint");
const print = (uuid, setCode, number, finishes = ["normal", "foil"], extra = {}) => ({
  uuid, setCode, number, finishes, setName: "Fixture edition", releaseDate: setCode === "NEW" ? "2026-09-01" : "2024-01-01",
  keyruneCode: setCode.toLowerCase(), rarity: "rare", treatments: ["standard"], foilTreatment: "standard", prices: {}, ...extra,
});
const card = { name: "Elegant Parlor", printings: [
  print("new-default", "NEW", "1"), print("pmkm-other", "PMKM", "260"),
  print("exact-promo", "PMKM", "260s"), print("leading-zero", "PMKM", "0260s"),
] };
const requested = { setCode: "PMKM", collectorNumber: "260s", finish: "foil", foilTreatment: "standard", sourceFormat: "set-collector-export" };
const item = (hint = requested) => ({ index: 0, quantity: 1, inputName: card.name, card: { name: card.name }, status: "found", requestedPrinting: hint });
const row = (hint = requested) => pricing.createPricingRowsFromFormatterItems([item(hint)])[0];

test("exact imported set and collector selects its stable UUID before newer or ordinary variants", () => {
  const selected = pricing.initializeFoundPricingSelection(row(), card, "2026-09-08");
  assert.equal(selected.selectedPrintingUuid, "exact-promo");
  assert.equal(selected.setCode, "PMKM");
  assert.equal(selected.finish, "foil");
  assert.equal(selected.requestedCollectorNumber, "260s");
  assert.equal(pricing.importedPrintingSelectionWarning(selected, card), "");
  assert.equal(pricing.preferredPrintingSelection(card, requested).selectedPrintingUuid, "exact-promo");
});

test("identifier comparisons ignore case while preserving suffixes, leading zeroes and punctuation", () => {
  assert.equal(pricing.initializeFoundPricingSelection(row({ ...requested, setCode: "pmkm", collectorNumber: "260S" }), card).selectedPrintingUuid, "exact-promo");
  assert.equal(pricing.initializeFoundPricingSelection(row({ ...requested, collectorNumber: "0260s" }), card).selectedPrintingUuid, "leading-zero");
  for (const [left, right] of [["01", "1"], ["260s", "260"], ["1-2", "12"], ["1.2", "12"], ["1/2", "12"], ["1★", "1"], [1, "1"]]) {
    assert.equal(pricing.collectorNumberMatches(left, right), false);
  }
  const normalized = pricing.normalizePricingAssistantRow({ ...row(), requestedCollectorNumber: " 001A★ " });
  assert.equal(normalized.requestedCollectorNumber, " 001A★ ");
  assert.equal(pricing.normalizePricingAssistantRow({ ...row(), requestedCollectorNumber: 260 }).requestedCollectorNumber, "");
});

test("same collector with an available finish wins over another collector with requested foil", () => {
  const limited = { ...card, printings: card.printings.map((printing) => printing.uuid === "exact-promo" ? { ...printing, finishes: ["normal"] } : printing) };
  const selected = pricing.initializeFoundPricingSelection(row(), limited);
  assert.equal(selected.selectedPrintingUuid, "exact-promo");
  assert.equal(selected.finish, "normal");
  assert.match(pricing.importedPrintingSelectionWarning(selected, limited), /no requested finish/);
  assert.equal(selected.resolved, true);
});

test("exact collector selection chooses valid treatment and finish without manufacturing combinations", () => {
  const onlyRetro = { name: card.name, printings: [print("retro-exact", "PMKM", "260s", ["foil"], { treatments: ["retro"] })] };
  const selected = pricing.initializeFoundPricingSelection(row({ ...requested, finish: "normal" }), onlyRetro);
  assert.deepEqual([selected.selectedPrintingUuid, selected.finish, selected.treatment], ["retro-exact", "foil", "retro"]);
  assert.equal(pricing.pricingPhysicalSelectionIsValid(selected, onlyRetro), true);
});

test("missing collector falls back within imported set and requested finish with a visible warning", () => {
  const selected = pricing.initializeFoundPricingSelection(row({ ...requested, collectorNumber: "999" }), card);
  assert.equal(selected.setCode, "PMKM");
  assert.equal(selected.finish, "foil");
  assert.match(pricing.importedPrintingSelectionWarning(selected, card), /not found.*another collector number in the requested set/);
  assert.equal(selected.resolved, true);
  assert.equal(pricing.preferredPrintingSelection(card, { ...requested, setCode: "pmkm", collectorNumber: "999" }).setCode, "PMKM");
});

test("missing imported set deliberately uses available default and warns without changing name identity", () => {
  const selected = pricing.initializeFoundPricingSelection(row({ ...requested, setCode: "ABSENT" }), card, "2026-09-08");
  assert.equal(selected.setCode, "NEW");
  assert.equal(selected.canonicalName, card.name);
  assert.equal(selected.resolved, true);
  assert.match(pricing.importedPrintingSelectionWarning(selected, card), /available default set/);
});

test("manual set and exact UUID stay authoritative through hydration and repeated Found initialization", () => {
  const initial = pricing.initializeFoundPricingSelection(row(), card);
  const selected = { ...pricing.selectManualPricingSet(initial, card, "NEW"), selectedPrintingUuid: "new-default", finish: "normal" };
  const restored = pricing.initializeFoundPricingSelection(pricing.normalizePricingAssistantRow(selected), card);
  assert.equal(restored.selectedPrintingUuid, "new-default");
  assert.equal(restored.setCode, "NEW");
  assert.equal(restored.finish, "normal");
  assert.equal(pricing.importedPrintingSelectionWarning(restored, card), "");
  const reconciled = pricing.reconcilePricingRowsWithFormatterItems([restored], [item()])[0];
  assert.equal(reconciled.selectedPrintingUuid, "new-default");
  assert.equal(reconciled.requestedCollectorNumber, "260s");
});

test("equivalent exact catalog records select the same UUID regardless of provider ordering", () => {
  const repeated = { name: card.name, printings: [print("b", "PMKM", "260s"), print("a", "PMKM", "260s")] };
  assert.equal(pricing.initializeFoundPricingSelection(row(), repeated).selectedPrintingUuid, "a");
  assert.equal(pricing.initializeFoundPricingSelection(row(), { ...repeated, printings: [...repeated.printings].reverse() }).selectedPrintingUuid, "a");
});

test("compact formatter, Saved Pull List and Copy Link retain the same requested printing hint", () => {
  const compact = formatter.compactFormatterItems([{ ...item(), prints: [{ privateProviderPayload: true }] }]);
  const priced = pricing.initializeFoundPricingSelection(row(), card);
  const draft = jobs.normalizePullListJobDraft({ formatterItems: compact, pricingState: { rows: [priced] } });
  assert.deepEqual(draft.formatterItems[0].requestedPrinting, requested);
  assert.equal(draft.pricingState.rows[0].requestedCollectorNumber, "260s");
  assert.equal(draft.pricingState.rows[0].requestedSourceFormat, "set-collector-export");
  assert.equal(draft.pricingState.rows[0].selectedPrintingUuid, "exact-promo");
  assert.equal("prints" in draft.formatterItems[0], false);
  const shared = sharing.decodeFormatterHash(sharing.encodeFormattedHash({ formatterItems: compact }));
  assert.deepEqual(shared.formatterItems[0].requestedPrinting, requested);
  const [fresh] = pricing.createPricingRowsFromFormatterItems(shared.formatterItems);
  assert.equal(fresh.found, false);
  assert.equal(pricing.initializeFoundPricingSelection(fresh, card).selectedPrintingUuid, "exact-promo");
});

test("legacy pricing rows and compact items without collector fields retain existing defaults", () => {
  const legacy = pricing.normalizePricingAssistantRow({ ...row(undefined), requestedCollectorNumber: undefined, requestedSourceFormat: undefined });
  assert.equal(legacy.requestedCollectorNumber, "");
  assert.equal(legacy.requestedSourceFormat, undefined);
  const [plain] = pricing.createPricingRowsFromFormatterItems([{ ...item(), requestedPrinting: undefined }]);
  assert.equal(pricing.initializeFoundPricingSelection(plain, card, "2026-09-08").setCode, "NEW");
});

test("different collector hints stay distinct in duplicate fingerprints without changing legacy hashes", () => {
  assert.notEqual(fingerprint.pullListFingerprint([item()]), fingerprint.pullListFingerprint([item({ ...requested, collectorNumber: "0260s" })]));
  assert.equal(fingerprint.pullListFingerprint([item()]), fingerprint.pullListFingerprint([item({ ...requested, collectorNumber: "260S" })]));
  const old = { quantity: 1, card: { name: "Sol Ring" } };
  const legacyJson = JSON.stringify([{ card: "solring", quantity: 1, set: "", finish: "", foilTreatment: "", treatment: "", flavor: "" }]);
  const expected = `plf1-${createHash("sha256").update(`pull-list-v1|${legacyJson}`).digest("hex")}`;
  assert.equal(fingerprint.pullListFingerprint([old]), expected);
});

import assert from "node:assert/strict";
import test from "node:test";
import { importBundledModule } from "./test-module-bundle.mjs";

const {
  normalizePullListForFingerprint,
  pullListFingerprint,
} = await importBundledModule("src/pull-list-fingerprint.ts", "pull-list-fingerprint");

const bolt = (quantity = 4, requestedPrinting = undefined) => ({
  quantity,
  inputName: "Lightningbolt",
  card: { name: "Lightning Bolt" },
  requestedPrinting,
});
const ring = (requestedPrinting = undefined) => ({
  quantity: 1,
  inputName: "sol ring",
  mtgjsonCard: { name: "Sol Ring" },
  requestedPrinting,
});

test("equivalent resolved requests fingerprint identically regardless of order or formatting", () => {
  const first = [bolt(), ring()];
  const second = [
    { ...ring(), inputName: "SOL RING" },
    { ...bolt(), inputName: "lightning-bolt" },
  ];
  assert.deepEqual(normalizePullListForFingerprint(first), normalizePullListForFingerprint(second));
  assert.equal(pullListFingerprint(first), pullListFingerprint(second));
});

test("grouped quantities affect duplicate identity", () => {
  assert.notEqual(pullListFingerprint([bolt(4)]), pullListFingerprint([bolt(3)]));
  assert.equal(pullListFingerprint([bolt(2), bolt(2)]), pullListFingerprint([bolt(4)]));
});

test("requested physical printing and reskin intent affect duplicate identity", () => {
  assert.notEqual(pullListFingerprint([ring()]), pullListFingerprint([ring({ finish: "foil" })]));
  assert.notEqual(
    pullListFingerprint([ring({ setCode: "CMM" })]),
    pullListFingerprint([ring({ setCode: "WHO" })]),
  );
  assert.notEqual(
    pullListFingerprint([{ ...bolt(1), alternateTitle: "Secret Lair Bolt" }]),
    pullListFingerprint([bolt(1)]),
  );
});

test("customer identity is deliberately absent from the card-request fingerprint", () => {
  const items = [bolt(), ring()];
  assert.equal(pullListFingerprint(items, { name: "Jane" }), pullListFingerprint(items, { name: "John" }));
});

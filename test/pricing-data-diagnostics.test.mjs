import assert from "node:assert/strict";
import test from "node:test";
import { importBundledModule } from "./test-module-bundle.mjs";

const diagnostics = await importBundledModule("src/pricing-data-diagnostics.ts", "pricing-data-diagnostics");

test("pricing diagnostics retain only safe bounded catalog metadata", () => {
  const events = Array.from({ length: 10 }, (_, index) => diagnostics.createPricingDataDiagnostic({
    timestamp: `2026-08-23T12:00:${String(index).padStart(2, "0")}.000Z`,
    stage: index % 2 ? "shard" : "fallback",
    outcome: index === 9 ? "partial" : "success",
    status: 200,
    shardKey: "m",
    requested: 13,
    cataloged: index,
    missing: 13 - index,
    message: `Catalog event ${index}`,
    customerName: "Private Customer",
    redisToken: "secret-token",
    signedUrl: "https://private.example.test/signed-token",
  }));
  const history = events.reduce((current, event) => diagnostics.addPricingDataDiagnostic(current, event), []);
  assert.equal(history.length, diagnostics.PRICING_DATA_DIAGNOSTIC_LIMIT);
  assert.equal(history[0].message, "Catalog event 9");
  assert.equal(history.at(-1).message, "Catalog event 2");

  const report = diagnostics.formatPricingDataDiagnosticReport(history);
  assert.match(report, /9\/13 cards cataloged/);
  assert.match(report, /4 unresolved after shard/);
  assert.equal(report.includes("Private Customer"), false);
  assert.equal(report.includes("secret-token"), false);
  assert.equal(report.includes("signed-token"), false);
});

test("pricing diagnostics redact URLs from provider error messages", () => {
  const event = diagnostics.createPricingDataDiagnostic({
    stage: "shard",
    outcome: "failed",
    message: "Fetch failed for https://private.example.test/shard.json?token=signed-token",
  });
  assert.equal(event.message, "Fetch failed for [URL omitted]");
  assert.equal(diagnostics.formatPricingDataDiagnosticReport([event]).includes("signed-token"), false);
});

import assert from "node:assert/strict";
import test from "node:test";
import { importBundledModule } from "./test-module-bundle.mjs";

const { BASE_DOCUMENT_TITLE, documentTitle } = await importBundledModule("src/document-title.ts", "document-title");

test("uses Pullsmith as the base browser title", () => {
  assert.equal(BASE_DOCUMENT_TITLE, "Pullsmith");
  assert.equal(documentTitle(), "Pullsmith");
});

test("uses a concise customer-aware Pullsmith browser title", () => {
  assert.equal(documentTitle("John Smith"), "John Smith | Pullsmith");
  assert.equal(documentTitle("  John Smith  "), "John Smith | Pullsmith");
});

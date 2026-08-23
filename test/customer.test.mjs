import assert from "node:assert/strict";
import test from "node:test";
import { importBundledModule } from "./test-module-bundle.mjs";

const {
  customerContactText,
  customerFromLegacyContact,
  customerSearchFields,
  mergeCustomerPreservingExisting,
  normalizeCustomer,
} = await importBundledModule("src/customer.ts", "customer");

test("normalizes structured customer fields and search forms", () => {
  const customer = normalizeCustomer({
    name: "  Jane   Doe ",
    phone: "+1 (309) 555-1234",
    email: " JANE@Example.COM ",
  });
  assert.deepEqual(customer, {
    name: "Jane Doe",
    phone: "309-555-1234",
    email: "jane@example.com",
  });
  assert.deepEqual(customerSearchFields(customer), {
    name: "jane doe",
    phone: "3095551234",
    email: "jane@example.com",
  });
});

test("migrates clear legacy contact values and retains ambiguous text safely", () => {
  assert.deepEqual(
    customerFromLegacyContact("(206) 555-0142 / Jane@Example.com"),
    { phone: "206-555-0142", email: "jane@example.com" },
  );
  assert.deepEqual(normalizeCustomer({ name: "Jane", contact: "Facebook" }), {
    name: "Jane",
    phone: "",
    email: "",
    legacyContact: "Facebook",
  });
  assert.equal(customerContactText({ name: "Jane", contact: "Facebook" }), "Facebook");
});

test("parsed customer data fills blanks without erasing staff corrections", () => {
  const merged = mergeCustomerPreservingExisting(
    { name: "Jane D.", phone: "", email: "corrected@example.com" },
    { name: "Jane Doe", phone: "3095551234", email: "old@example.com" },
  );
  assert.deepEqual(merged, {
    name: "Jane D.",
    phone: "309-555-1234",
    email: "corrected@example.com",
  });
  assert.deepEqual(
    mergeCustomerPreservingExisting(
      { name: "Manual Name", phone: "309-555-0000", email: "manual@example.com" },
      { name: "", phone: "", email: "" },
    ),
    { name: "Manual Name", phone: "309-555-0000", email: "manual@example.com" },
  );
});

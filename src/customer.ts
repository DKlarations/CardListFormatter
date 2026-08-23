export type Customer = {
  name: string;
  phone: string;
  email: string;
  /** Unclassifiable legacy `contact` text, retained during migration only. */
  legacyContact?: string;
};

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_PATTERN = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/;

export const EMPTY_CUSTOMER: Customer = {
  name: "",
  phone: "",
  email: "",
};

function cleanText(value: unknown) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
}

export function normalizePhoneForSearch(value: unknown) {
  const digits = cleanText(value).replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

export function formatCustomerPhone(value: unknown) {
  const raw = cleanText(value);
  const digits = normalizePhoneForSearch(raw);
  if (digits.length !== 10) return raw;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export function normalizeEmailForSearch(value: unknown) {
  return cleanText(value).toLowerCase();
}

export function normalizeCustomerNameForSearch(value: unknown) {
  return cleanText(value)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function customerSearchFields(customer: Customer) {
  return {
    name: normalizeCustomerNameForSearch(customer.name),
    phone: normalizePhoneForSearch(customer.phone),
    email: normalizeEmailForSearch(customer.email),
  };
}

export function customerFromLegacyContact(contactValue: unknown): Partial<Customer> {
  const contact = cleanText(contactValue);
  if (!contact) return {};

  const phoneMatch = contact.match(PHONE_PATTERN)?.[0] || "";
  const emailMatch = contact.match(EMAIL_PATTERN)?.[0] || "";
  const remainder = cleanText(contact
    .replace(phoneMatch, " ")
    .replace(emailMatch, " ")
    .replace(/^\s*[\/|,;]+|[\/|,;]+\s*$/g, " ")
    .replace(/\s*[\/|,;]+\s*/g, " "));

  return {
    ...(phoneMatch ? { phone: formatCustomerPhone(phoneMatch) } : {}),
    ...(emailMatch ? { email: normalizeEmailForSearch(emailMatch) } : {}),
    ...(remainder ? { legacyContact: remainder } : {}),
  };
}

export function normalizeCustomer(value: unknown): Customer {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const legacy = customerFromLegacyContact(raw.contact);
  const phone = cleanText(raw.phone) || legacy.phone || "";
  const email = cleanText(raw.email) || legacy.email || "";
  const explicitLegacy = cleanText(raw.legacyContact);

  return {
    name: cleanText(raw.name),
    phone: formatCustomerPhone(phone),
    email: normalizeEmailForSearch(email),
    ...((explicitLegacy || legacy.legacyContact)
      ? { legacyContact: explicitLegacy || legacy.legacyContact }
      : {}),
  };
}

/** Preserve intermediate name-editing whitespace while retaining existing field normalization. */
export function updateCustomerField(
  customer: Customer,
  field: "name" | "phone" | "email",
  value: string,
): Customer {
  if (field === "name") return { ...customer, name: value };
  return normalizeCustomer({ ...customer, [field]: value });
}

/** Parsed data fills blanks, while a staff-entered non-empty value remains authoritative. */
export function mergeCustomerPreservingExisting(existing: unknown, parsed: unknown): Customer {
  const current = normalizeCustomer(existing);
  const incoming = normalizeCustomer(parsed);
  return {
    name: current.name || incoming.name,
    phone: current.phone || incoming.phone,
    email: current.email || incoming.email,
    ...((current.legacyContact || incoming.legacyContact)
      ? { legacyContact: current.legacyContact || incoming.legacyContact }
      : {}),
  };
}

export function customerContactText(customerValue: unknown) {
  const customer = normalizeCustomer(customerValue);
  return Array.from(new Set([
    customer.phone,
    customer.email,
    customer.legacyContact,
  ].filter(Boolean))).join(" / ");
}

export function customerHasValue(customerValue: unknown) {
  const customer = normalizeCustomer(customerValue);
  return Boolean(customer.name || customer.phone || customer.email || customer.legacyContact);
}

/** Customer names reserved for the randomized, clearly fake starter pull list. */
export const GENERATED_SAMPLE_CUSTOMER_NAMES = [
  "Mark Rosewater",
  "Bill Rose",
  "Skaff Elias",
  "Beth Moursund",
  "Tom Wylie",
  "Aaron Forsythe",
  "Erik Lauer",
  "Devin Low",
  "Mark Gottlieb",
  "Tom LaPille",
  "Dave Humpherys",
  "Sam Stoddard",
  "Gavin Verhey",
  "Ken Nagle",
  "Ethan Fleischer",
  "Melissa DeTora",
  "Jeremy Jarvis",
  "Carmen Klomparens",
  "Matt Cavotta",
] as const;

function sampleCustomerNameKey(value: unknown) {
  return typeof value === "string"
    ? value.trim().replace(/\s+/g, " ").toLocaleLowerCase()
    : "";
}

const GENERATED_SAMPLE_CUSTOMER_NAME_KEYS = new Set(
  GENERATED_SAMPLE_CUSTOMER_NAMES.map(sampleCustomerNameKey),
);

/** Generated starter-list names are never eligible for Saved Pull List persistence. */
export function isGeneratedSampleCustomerName(value: unknown) {
  return GENERATED_SAMPLE_CUSTOMER_NAME_KEYS.has(sampleCustomerNameKey(value));
}

import { treatmentsForRawPrinting } from "./printing-normalization";
import {
  customerContactText,
  formatCustomerPhone,
  normalizeCustomer,
  type Customer,
} from "./customer";
import { GENERATED_SAMPLE_CUSTOMER_NAMES } from "./generated-sample";
import { type RequestedPrintingPreference } from "./requested-printing.js";
import { parseStructuredExportLine, detectStructuredExportSuffix, repairMojibake } from "./structured-export.js";
export { parseStructuredExportLine, detectStructuredExportSuffix, repairMojibake } from "./structured-export.js";
import { countPerformance, createProcessingPerformance, finishProcessingPerformance, processingNow, recordResolutionIndexReadiness, type ProcessingPerformance } from "./processing-performance.js";
import { loadMtgjsonResolutionIndex, prefetchMtgjsonResolutionIndex, clearMtgjsonResolutionIndexMemory } from "./mtgjson-index-cache.js";
import { hasSufficientLocalPaperEvidence, type MtgjsonIndexedCard, type MtgjsonCardIndex } from "./mtgjson-resolution-index.js";
import { createScryfallRunContext, providerCircuitFailure, startProviderPhase, remainingProviderMs, recordProviderAttempt, recordProviderSuccess, recordProviderFailure, countMalformedRecords, retryAfterDuration, waitForProvider, openScryfallCircuit, syncScryfallDiagnostics, SCRYFALL_REQUEST_TIMEOUT_MS, SCRYFALL_MAX_ATTEMPTS, type ProviderFailure, type ProviderOperation, type ScryfallRunContext } from "./scryfall-reliability.js";
export { createScryfallRunContext, providerCircuitFailure, type ProviderFailure, type ScryfallRunContext } from "./scryfall-reliability.js";
import { BULK_MISS_GUARD_MESSAGE, recordParsingPerformance } from "./processing-performance.js";

const SCRYFALL_COLLECTION_URL = "https://api.scryfall.com/cards/collection";
const SCRYFALL_NAMED_URL = "https://api.scryfall.com/cards/named";
const SCRYFALL_SEARCH_URL = "https://api.scryfall.com/cards/search";
const SCRYFALL_SETS_URL = "https://api.scryfall.com/sets";
const PRODUCTION_ORIGIN = "https://card-list-formatter.vercel.app";
const BATCH_SIZE = 50;
const PRINT_FACT_CONCURRENCY = 5;
const SCRYFALL_MIN_INTERVAL_MS = 120;
const CAREFUL_SCRYFALL_MIN_INTERVAL_MS = 500;
const CACHE_TTL_MS = 4 * 24 * 60 * 60 * 1000;
const CACHE_PREFIX = "rrg-scryfall-cache:";
const BUFFER_MARKER = ".";
const STORE_EMAIL_PATTERN = /\binfo@redraccoongames\.com\b/i;
const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_PATTERN = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/;
let scryfallRequestGate = Promise.resolve();
let lastScryfallRequestAt = 0;
let activeScryfallSignal: AbortSignal | null = null;
let activeScryfallMinIntervalMs = SCRYFALL_MIN_INTERVAL_MS;
let activeScryfallRun: ScryfallRunContext | undefined;

type ScryfallSetSummary = {
  code: string;
  index: number;
  name: string;
};

type PullItem = Record<string, any> & {
  index: number;
  original: string;
  originals?: string[];
  quantity: number;
  inputName: string;
  statedRarities: string[];
  specialRequests: string[];
  requestedPrinting?: RequestedPrintingPreference;
  lookupKey: string;
  note?: string;
  presetStatus?: string;
  status?: string;
};

type FetchResult = {
  ok: boolean;
  status: number;
  data: any;
  cached?: boolean;
  failure?: ProviderFailure;
};

type LabeledPattern = readonly [string, RegExp];

type ProcessPullListOptions = {
  useCheckboxes?: boolean;
  caseCheck?: boolean;
  carefulMode?: boolean;
  useMtgjson?: boolean;
  useScryfall?: boolean;
  mtgjsonManifestUrl?: string;
  processedAt?: string;
  setMessage?: (message: string) => void;
  signal?: AbortSignal;
};

export type ProviderOptions = {
  useMtgjson?: boolean;
  useScryfall?: boolean;
  enrichmentPurpose?: "formatter" | "pricing-recovery" | "case-check";
  mtgjsonManifestUrl?: string;
  signal?: AbortSignal | null;
  performance?: ProcessingPerformance;
  minIntervalMs?: number;
  requestType?: string;
  providerRun?: ScryfallRunContext;
};

export function clearMtgjsonIndexCache() {
  clearMtgjsonResolutionIndexMemory();
}

export function prefetchMtgjsonIndex() {
  return prefetchMtgjsonResolutionIndex(defaultMtgjsonManifestUrl());
}

const sampleCardList = `1 Chub Toad - G unc
Storm crow
Psychatog r
One With Nothing U
3x cheatyface foil
1 goblin game-rare
Squire
raph's jitte
4x Lightningbolt
Earthbending Student
4x Godless Shrine land
Yargle gluttin of urborg
sol ring :-)`;

// Picks a random Magic design/dev name so the sample list gets a tiny shuffle on reload.
function randomSampleCustomerName() {
  return GENERATED_SAMPLE_CUSTOMER_NAMES[Math.floor(Math.random() * GENERATED_SAMPLE_CUSTOMER_NAMES.length)];
}

// Makes a fake local-ish phone number; no real customers were bothered in the making of this sample.
function randomSamplePhoneNumber() {
  const areaCode = Math.random() < 0.5 ? "206" : "564";
  const lastFour = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  return `${areaCode}-555-${lastFour}`;
}

export function beginScryfallRun(signal: AbortSignal | null, carefulMode = false) {
  activeScryfallSignal = signal;
  activeScryfallMinIntervalMs = carefulMode ? CAREFUL_SCRYFALL_MIN_INTERVAL_MS : SCRYFALL_MIN_INTERVAL_MS;
  activeScryfallRun = createScryfallRunContext({ carefulMode });
}

export function endScryfallRun() {
  activeScryfallSignal = null;
  activeScryfallMinIntervalMs = SCRYFALL_MIN_INTERVAL_MS;
  activeScryfallRun = undefined;
}

// Builds the default paste-in sample with a fresh fake customer each page load.
export function createSampleList() {
  return `${randomSampleCustomerName()}
${randomSamplePhoneNumber()}

${sampleCardList}`;
}

const CARD_HINTS = new Set([
  "artifact",
  "black",
  "blue",
  "colorless",
  "common",
  "creature",
  "enchantment",
  "green",
  "instant",
  "land",
  "legendary",
  "mythic",
  "planeswalker",
  "rare",
  "red",
  "sorcery",
  "uncommon",
  "white",
]);

const BASIC_LANDS_BY_COLOR = {
  black: "Swamp",
  blue: "Island",
  green: "Forest",
  red: "Mountain",
  white: "Plains",
};
const BASIC_LAND_NAMES = new Set(Object.values(BASIC_LANDS_BY_COLOR));
const BASIC_LAND_ORDER = ["Plains", "Island", "Swamp", "Mountain", "Forest"];
const CASE_RELEVANT_SET_TYPES = new Set(["core", "commander", "draft_innovation", "expansion", "masters"]);
const RECENT_CASE_SET_COUNT = 3;
const CHECK_CASE_RECENT_SET_COUNT = 2;
const CASE_STAPLE_CARD_NAMES = new Set([
  "Ancient Tomb",
  "Arcane Signet",
  "Arid Mesa",
  "Blood Crypt",
  "Bloodstained Mire",
  "Boseiju, Who Endures",
  "Bountiful Promenade",
  "Breeding Pool",
  "Cavern of Souls",
  "City of Brass",
  "Command Tower",
  "Eiganjo, Seat of the Empire",
  "Exotic Orchard",
  "Flooded Strand",
  "Gemstone Caverns",
  "Godless Shrine",
  "Hallowed Fountain",
  "Indatha Triome",
  "Jetmir's Garden",
  "Ketria Triome",
  "Luxury Suite",
  "Mana Confluence",
  "Marsh Flats",
  "Misty Rainforest",
  "Morphic Pool",
  "Nykthos, Shrine to Nyx",
  "Otawara, Soaring City",
  "Overgrown Tomb",
  "Polluted Delta",
  "Prismatic Vista",
  "Raffine's Tower",
  "Raugrin Triome",
  "Reflecting Pool",
  "Rejuvenating Springs",
  "Reliquary Tower",
  "Sacred Foundry",
  "Savai Triome",
  "Scalding Tarn",
  "Sea of Clouds",
  "Sol Ring",
  "Sokenzan, Crucible of Defiance",
  "Spara's Headquarters",
  "Spectator Seating",
  "Steam Vents",
  "Stomping Ground",
  "Takenuma, Abandoned Mire",
  "Temple Garden",
  "Training Center",
  "Undergrowth Stadium",
  "Urborg, Tomb of Yawgmoth",
  "Vault of Champions",
  "Verdant Catacombs",
  "Watery Grave",
  "Windswept Heath",
  "Wooded Foothills",
  "Xander's Lounge",
  "Yavimaya, Cradle of Growth",
  "Zagoth Triome",
  "Ziatora's Proving Ground",
].map(normalizeName));
const TOKEN_KEYWORD_PATTERNS: LabeledPattern[] = [
  ["Double Strike", /\bdouble\s+strike\b/i],
  ["First Strike", /\bfirst\s+strike\b/i],
  ["Deathtouch", /\bdeathtouch\b/i],
  ["Defender", /\bdefender\b/i],
  ["Flying", /\bflying\b/i],
  ["Haste", /\bhaste\b/i],
  ["Hexproof", /\bhexproof\b/i],
  ["Indestructible", /\bindestructible\b/i],
  ["Lifelink", /\blifelink\b/i],
  ["Menace", /\bmenace\b/i],
  ["Reach", /\breach\b/i],
  ["Trample", /\btrample\b/i],
  ["Vigilance", /\bvigilance\b/i],
  ["Ward", /\bward\b/i],
  ["Prowess", /\bprowess\b/i],
  ["Toxic", /\btoxic\b/i],
  ["Infect", /\binfect\b/i],
  ["Wither", /\bwither\b/i],
  ["Shroud", /\bshroud\b/i],
  ["Fear", /\bfear\b/i],
  ["Intimidate", /\bintimidate\b/i],
  ["Islandwalk", /\bislandwalk\b/i],
  ["Swampwalk", /\bswampwalk\b/i],
  ["Mountainwalk", /\bmountainwalk\b/i],
  ["Forestwalk", /\bforestwalk\b/i],
  ["Plainswalk", /\bplainswalk\b/i],
];
const TOKEN_COLOR_PATTERNS: LabeledPattern[] = [
  ["White", /\bwhite\b/i],
  ["Blue", /\bblue\b/i],
  ["Black", /\bblack\b/i],
  ["Red", /\bred\b/i],
  ["Green", /\bgreen\b/i],
  ["Colorless", /\bcolorless\b/i],
];
const SPECIAL_REQUEST_PATTERNS = [
  { label: "SURGE FOIL", pattern: /\bsurge\s+foil\b/i },
  { label: "FOIL", pattern: /\b(?:foil|foiled)\b/i },
  { label: "NONFOIL", pattern: /\b(?:non[-\s]?foil|nonfoil)\b/i },
  { label: "SHOWCASE", pattern: /\bshowcase\b/i },
  { label: "BORDERLESS", pattern: /\bborderless\b/i },
  { label: "EXTENDED ART", pattern: /\bextended\s+art\b/i },
  { label: "FULL ART", pattern: /\bfull\s+art\b/i },
  { label: "ETCHED", pattern: /\betched\b/i },
  { label: "RETRO FRAME", pattern: /\b(?:retro\s+frame|old\s+border)\b/i },
  { label: "ALT ART", pattern: /\b(?:alt(?:ernate)?\s+art|alternate\s+art)\b/i },
  { label: "PROMO", pattern: /\bpromo\b/i },
];

// Squishes a card/customer string into a plain comparison key so spelling weirdness has less room to party.
function normalizeName(value) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w/ ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Removes spaces too, because "Lightningbolt" still knows what it did.
function compactName(value) {
  return normalizeName(value).replace(/\s+/g, "");
}

// Tiny pause helper for being polite to APIs and letting retry loops breathe so we can maybe stop breaking Scryfall so dang much :-)
function sleep(ms: number, signal?: AbortSignal | null) {
  throwIfAborted(signal);
  return new Promise<void>((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); signal?.removeEventListener("abort", cancel); reject(new DOMException("Processing canceled.", "AbortError")); };
    const timer = setTimeout(() => { signal?.removeEventListener("abort", cancel); resolve(); }, ms);
    signal?.addEventListener("abort", cancel, { once: true });
  });
}

function providerContext(options: ProviderOptions, carefulMode = false): ProviderOptions {
  const minIntervalMs = carefulMode ? CAREFUL_SCRYFALL_MIN_INTERVAL_MS : Math.max(SCRYFALL_MIN_INTERVAL_MS, options.minIntervalMs || (options.signal === undefined ? activeScryfallMinIntervalMs : SCRYFALL_MIN_INTERVAL_MS));
  options.providerRun ||= options.enrichmentPurpose !== "pricing-recovery" && activeScryfallRun
    ? activeScryfallRun : createScryfallRunContext({ carefulMode: minIntervalMs >= CAREFUL_SCRYFALL_MIN_INTERVAL_MS, purpose: options.enrichmentPurpose, performance: options.performance });
  if (options.performance) options.providerRun.performance = options.performance;
  syncScryfallDiagnostics(options.providerRun);
  return { ...options, signal: options.signal === undefined ? activeScryfallSignal : options.signal, minIntervalMs };
}

// Keeps Scryfall requests spaced out so we do not hammer the good card oracle.
async function waitForScryfallSlot(context: ProviderOptions) {
  const run = context.providerRun!;
  startProviderPhase(run);
  if (providerCircuitFailure(run)) return false;
  const previousGate = scryfallRequestGate;
  let releaseGate;
  scryfallRequestGate = new Promise((resolve) => {
    releaseGate = resolve;
  });

  try {
    // The gate holds at most one short interval; cancellation also interrupts a queued consumer.
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => { context.signal?.removeEventListener("abort", cancel); run.controller.signal.removeEventListener("abort", stopped); };
      const cancel = () => { cleanup(); reject(new DOMException("Processing canceled.", "AbortError")); };
      const stopped = () => { cleanup(); resolve(); };
      context.signal?.addEventListener("abort", cancel, { once: true });
      run.controller.signal.addEventListener("abort", stopped, { once: true });
      previousGate.then(() => { cleanup(); resolve(); }, reject);
    });
    throwIfAborted(context.signal);
    if (providerCircuitFailure(run)) return false;
    const elapsed = Date.now() - lastScryfallRequestAt;
    const interval = context.minIntervalMs || SCRYFALL_MIN_INTERVAL_MS;
    if (elapsed < interval && !await waitForProvider(run, interval - elapsed, context.signal)) return false;
    throwIfAborted(context.signal);
    if (providerCircuitFailure(run)) return false;
    lastScryfallRequestAt = Date.now();
    return true;
  } finally {
    // A canceled queued consumer must not let later consumers overtake its predecessor.
    previousGate.then(releaseGate, releaseGate);
  }
}

// Turns a request into a localStorage key for the four-day "we already asked this" stash.
function cacheKeyForRequest(url: string, options: RequestInit = {}) {
  const method = (options.method || "GET").toUpperCase();
  return `${CACHE_PREFIX}${method}:${url}:${String(options.body || "")}`;
}

// Checks the browser cache first, because repeating homework is for villains and slow Wi-Fi.
function readCachedResponse(url: string, options: RequestInit = {}): FetchResult | null {
  if (typeof localStorage === "undefined") return null;

  try {
    const raw = localStorage.getItem(cacheKeyForRequest(url, options));
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached?.savedAt || Date.now() - cached.savedAt > CACHE_TTL_MS) {
      localStorage.removeItem(cacheKeyForRequest(url, options));
      return null;
    }
    return { ok: true, status: cached.status || 200, data: cached.data, cached: true };
  } catch {
    return null;
  }
}

// Saves successful Scryfall answers locally so the next run can skip some waiting.
function writeCachedResponse(url: string, options: RequestInit = {}, result: FetchResult) {
  if (typeof localStorage === "undefined" || !result?.ok) return;

  try {
    localStorage.setItem(cacheKeyForRequest(url, options), JSON.stringify({
      savedAt: Date.now(),
      status: result.status,
      data: result.data,
    }));
  } catch {
    // Cache is an optimization; storage limits should never block processing.
  }
}

// Throws the emergency brake when the user hits cancel mid-Scryfall adventure.
function throwIfAborted(signal: AbortSignal | null = activeScryfallSignal) {
  if (signal?.aborted) {
    throw new DOMException("Processing canceled.", "AbortError");
  }
}

// Normalizes phone numbers into receipt-friendly 555-555-5555 format.
function formatPhoneNumber(value) {
  return formatCustomerPhone(value);
}

// Cleans contact details without wrapping emails or phone numbers in extra nonsense.
function normalizeContactValue(value) {
  const trimmed = value.trim();
  if (PHONE_PATTERN.test(trimmed)) {
    return formatPhoneNumber(trimmed);
  }
  return trimmed;
}

function contactParts(value) {
  const parts = [];
  const phone = value.match(PHONE_PATTERN)?.[0] || "";
  const email = value.match(EMAIL_PATTERN)?.[0] || "";
  const facebook = /\bfacebook\b|\bfb\b/i.test(value) ? "facebook" : "";

  if (phone) parts.push(formatPhoneNumber(phone));
  if (email) parts.push(email.trim());
  if (facebook) parts.push(facebook);
  if (!parts.length && value.trim()) parts.push(normalizeContactValue(value));

  return parts;
}

function mergeContactValues(...values) {
  const orderedParts = values.flatMap((value) => contactParts(value || ""));
  return Array.from(new Set(orderedParts)).join(" / ");
}

function cleanCustomerName(value) {
  return value
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();
}

function stripFieldLabel(value) {
  return value.replace(/^(?:name|customer|phone|email|e-mail|contact)(?:\s*:\s*|\s+-\s+)/i, "").trim();
}

function splitNameAndContact(value, extraContact = "") {
  const cleanedValue = stripFieldLabel(value);
  const email = value.match(EMAIL_PATTERN)?.[0] || "";
  const phone = value.match(PHONE_PATTERN)?.[0] || "";
  const facebook = /\bfacebook\b|\bfb\b/i.test(value) ? "facebook" : "";
  const contact = mergeContactValues(phone, email, facebook, extraContact);
  const name = [phone, email].reduce(
    (current, part) => part ? current.replace(part, "") : current,
    cleanedValue,
  ).replace(/\bfacebook\b|\bfb\b/i, "").replace(/\s+/g, " ").trim();

  return { name: cleanCustomerName(name), contact };
}

// Pulls a customer name/contact out of header-ish lines, emails, phones, and Facebook mentions.
function extractContact(line) {
  const labeledNameMatch = line.match(/^(?:name|customer)(?:\s*:\s*|\s+-\s+)(.+)$/i);
  if (labeledNameMatch) {
    return { name: cleanCustomerName(labeledNameMatch[1]), contact: "" };
  }

  const labeledContactMatch = line.match(/^(?:phone|email|e-mail|contact)(?:\s*:\s*|\s+-\s+)(.+)$/i);
  if (labeledContactMatch) {
    return { name: "", contact: mergeContactValues(labeledContactMatch[1]) };
  }

  const emailFromMatch = line.match(/^from:\s*(.+)$/i);
  if (emailFromMatch) {
    return splitNameAndContact(emailFromMatch[1]);
  }

  const headerFromMatch = line.match(/\bpull\s+list\s+from\s+(.+?)(?:\s+on\s+facebook|\s+\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|$)/i);
  if (headerFromMatch) {
    return splitNameAndContact(headerFromMatch[1], /\bfacebook\b|\bfb\b/i.test(line) ? "facebook" : "");
  }

  const headerForMatch = line.match(/\bpull\s+list\s+for\s+(.+)$/i);
  if (headerForMatch) {
    return splitNameAndContact(headerForMatch[1]);
  }

  const bracketMatch = line.match(/^([^<]+)<([^>]+)>$/);
  if (bracketMatch) {
    return {
      name: cleanCustomerName(bracketMatch[1]),
      contact: normalizeContactValue(bracketMatch[2]),
    };
  }

  const parsed = splitNameAndContact(line);
  if (!parsed.contact) return { name: line.trim(), contact: "" };
  return parsed;
}

// Spots divider lines from pasted emails so they do not pretend to be cards.
function isSeparatorLine(line) {
  return /^[-_=]{4,}$/.test(line.trim());
}

// Filters out friendly human chatter like "thanks!" before it can confuse the card parser. Another point of failure for sure.
function isLikelyNoteLine(line) {
  const normalized = normalizeName(line);
  if (!normalized) return true;
  if (STORE_EMAIL_PATTERN.test(line)) return true;
  if (/\bdeck\s*list\b/i.test(line) || /decklist$/i.test(line)) return true;
  if (/^(prices?\s+are|i used\b|i don'?t\b|i do not\b|i placed\b)/i.test(line)) return true;
  if (/^(hello|hi|hey|thanks|thank you|just one of each|i will|i'm|im|these are|please|once again|mtg pull list from|mtg pull list for)\b/i.test(line)) {
    return true;
  }
  if ((/[!?]/.test(line) || /\.\s*$/.test(line)) && normalized.split(" ").length > 4) return true;
  return false;
}

function isLabeledContactLine(line) {
  return /^(?:name|customer|phone|email|e-mail|contact)(?:\s*:\s*|\s+-\s+)/i.test(line);
}

function isContactSectionHeading(line, nextLine = "") {
  return /^(?:contact|contact information|customer information)$/i.test(line)
    && isLabeledContactLine(nextLine);
}

// Checks whether a line smells like customer info instead of expensive cardboard.
function hasContactOrHeader(line) {
  return EMAIL_PATTERN.test(line)
    || PHONE_PATTERN.test(line)
    || isLabeledContactLine(line)
    || /\bpull\s+list\s+(from|for)\b/i.test(line)
    || /\bfacebook\b|\bfb\b/i.test(line);
}

function isFromHeaderLine(line) {
  return /^from:\s*/i.test(line);
}

function isIgnoredEmailMetadataLine(line) {
  return /^pull list email received$/i.test(line)
    || /^(subject|received):\s*/i.test(line);
}

// Splits the big paste into customer info and possible card lines; first pass, broad net.
function parseCustomerAndCards(text) {
  const lines = text
    .split(/\r?\n/)
    .filter((line) => line.trim());

  const customer = { name: "", contact: "" };
  const emailHeaderContact = { name: "", contact: "" };
  const cardLines = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (isSeparatorLine(line) || STORE_EMAIL_PATTERN.test(line)) continue;

    if (isContactSectionHeading(line, lines[index + 1])) continue;

    if (isFromHeaderLine(line)) {
      const parsed = extractContact(line);
      emailHeaderContact.name = emailHeaderContact.name || parsed.name;
      emailHeaderContact.contact = mergeContactValues(emailHeaderContact.contact, parsed.contact);
      continue;
    }

    if (isIgnoredEmailMetadataLine(line)) continue;

    if (hasContactOrHeader(line)) {
      const parsed = extractContact(line);
      customer.name = customer.name || parsed.name;
      customer.contact = mergeContactValues(customer.contact, parsed.contact);
      continue;
    }

    if (parseStructuredPriceRow(line) || parseStructuredExportLine(line)) {
      cardLines.push(lines[index]);
      continue;
    }

    if (isLikelyNoteLine(line)) continue;
    cardLines.push(lines[index]);
  }

  customer.name = customer.name || emailHeaderContact.name;
  customer.contact = customer.contact || emailHeaderContact.contact;

  return { customer: normalizeCustomer(customer), cardLines };
}

const RARITY_ALIASES: Record<string, string> = {
  m: "mythic", mr: "mythic", mythic: "mythic", "mythic rare": "mythic",
  r: "rare", rare: "rare",
  u: "uncommon", uc: "uncommon", unc: "uncommon", uncommon: "uncommon",
  c: "common", com: "common", common: "common",
};

// Converts complete rarity fields, using the same aliases as the suffix grammar.
function parseRarity(value) {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, " ");
  return Object.hasOwn(RARITY_ALIASES, normalized) ? RARITY_ALIASES[normalized] : "";
}

function splitCommaFields(value) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "\"") {
      current += character;
      if (inQuotes && value[index + 1] === "\"") {
        current += value[++index];
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (character === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
      continue;
    }

    current += character;
  }

  fields.push(current.trim());
  return fields;
}

function unquoteField(value: string) {
  const trimmed = value.trim();
  return /^("|')[\s\S]*\1$/.test(trimmed)
    ? trimmed.slice(1, -1).replace(/""/g, '"').trim()
    : trimmed;
}

type ParsedMetadata = {
  rarities: string[];
  specialRequests: string[];
  quantity?: number;
  setCode?: string;
  price?: number;
  color?: string;
};

function emptyMetadata(): ParsedMetadata {
  return { rarities: [], specialRequests: [] };
}

// A field is metadata only if EVERY part is understood. Classification and
// extraction share this result, including field-aware single-letter rarities.
function parseMetadataField(value: string, delimited = true): ParsedMetadata | null {
  let remaining = unquoteField(value);
  if (!remaining) return null;
  const result = emptyMetadata();
  let invalidQuantity = false;
  remaining = remaining.replace(/(?:^|\s)(?:(?:quantity|qty)\s*[:=]?\s*(\d+)|x\s*(\d+)|(\d+)\s*x)(?=\s|$)/ig,
    (_, explicit, prefix, suffix) => {
      const quantity = Number(explicit || prefix || suffix);
      if (!Number.isSafeInteger(quantity) || quantity <= 0 || result.quantity !== undefined) invalidQuantity = true;
      result.quantity = quantity;
      return " ";
    }).trim();
  if (invalidQuantity) return null;
  if (!remaining) return result;

  if (/^\d+$/.test(remaining) && delimited && result.quantity === undefined) {
    const quantity = Number(remaining);
    return Number.isSafeInteger(quantity) && quantity > 0 ? { ...result, quantity } : null;
  }

  while (remaining) {
    const rarity = remaining.match(new RegExp(`^${rarityPattern()}(?=$|\\s|/|,)`, "i"));
    const request = SPECIAL_REQUEST_PATTERNS.find(({ pattern }) => {
      const match = remaining.match(pattern);
      return match?.index === 0 && /^(?:$|\s|\/|,)/.test(remaining.slice(match[0].length));
    });
    const color = remaining.match(/^(?:white|blue|black|red|green|colorless|[WUBRG]{1,5})(?=$|\s|\/|,)/i);
    const hint = remaining.match(/^[a-z]+(?=$|\s|\/|,)/i);
    let consumed = "";
    if (rarity) {
      result.rarities.push(parseRarity(rarity[0]));
      consumed = rarity[0];
    } else if (request) {
      result.specialRequests.push(request.label);
      // Preserve the existing SURGE FOIL + FOIL request representation.
      if (request.label === "SURGE FOIL") result.specialRequests.push("FOIL");
      consumed = remaining.match(request.pattern)[0];
    } else if (color && delimited) {
      result.color = [result.color, color[0]].filter(Boolean).join("/");
      consumed = color[0];
    } else if (hint && CARD_HINTS.has(hint[0].toLowerCase()) && (delimited || hint[0].toLowerCase() === "land")) {
      consumed = hint[0];
    } else if (delimited && /^[<>]?\$?\d+(?:\.\d{1,2})?$/.test(remaining)) {
      result.price = Number(remaining.replace(/^[<>]?\$?/, ""));
      consumed = remaining;
    } else if (delimited && /^[A-Z0-9]{2,6}(?:\s*\/\s*[A-Z0-9]{2,6})*$/.test(remaining)) {
      const codes = remaining.split(/\s*\/\s*/);
      if (codes.length === 1) result.setCode = codes[0];
      consumed = remaining;
    } else if (delimited && /^(?:yes|no|y|n|doesn'?t matter|does not matter|cheapest you have)$/i.test(remaining)) {
      consumed = remaining;
    } else {
      return null;
    }
    remaining = remaining.slice(consumed.length);
    if (!remaining) break;
    remaining = remaining.replace(/^(?:\s*[,/]\s*|\s+and\s+|\s+)/i, "");
    if (!remaining) return null; // A dangling separator is not a complete field.
  }
  return result;
}

function mergeMetadata(target: ParsedMetadata, field: ParsedMetadata) {
  target.rarities.push(...field.rarities);
  target.specialRequests.push(...field.specialRequests);
  for (const key of ["quantity", "setCode", "price", "color"] as const) {
    if (field[key] !== undefined) Object.assign(target, { [key]: field[key] });
  }
}

function applyCommaMetadata(line: string, metadata: ParsedMetadata) {
  const fields = splitCommaFields(line);
  if (fields.length < 2) return line;

  let metadataStart = fields.length;
  const parsedFields: ParsedMetadata[] = [];
  for (let index = fields.length - 1; index >= 1; index -= 1) {
    const parsed = parseMetadataField(fields[index]);
    if (!parsed) break;
    parsedFields.unshift(parsed);
    metadataStart = index;
  }
  if (!parsedFields.length) return line;
  parsedFields.forEach((field) => mergeMetadata(metadata, field));
  return fields.slice(0, metadataStart).join(", ").trim();
}

// Builds the regex chunk for rarity labels that may appear after card names. Hopefully this uncompasses all the options, but stuff could break it.
function rarityPattern() {
  return `(?:${Object.keys(RARITY_ALIASES).sort((a, b) => b.length - a.length).join("|")})`;
}

// Recognizes price-list exports shaped like Card - Rarity - Price - Set(s) - Color.
// Matching from the right keeps commas, hyphens, and double-faced separators in the card name intact.
function parseStructuredPriceRow(line) {
  const match = line.match(new RegExp(
    `^(.*?)\\s+-\\s+(${rarityPattern()})\\s+-\\s+(\\$?\\d+(?:\\.\\d{1,2})?)\\s*-\\s+([A-Z0-9]{2,6}(?:\\s*\\/\\s*[A-Z0-9]{2,6})*)\\s+-\\s+((?:white|blue|black|red|green|colorless|land|[WUBRG]{1,5})(?:\\/(?:white|blue|black|red|green|colorless|land|[WUBRG]{1,5}))*)\\s*$`,
    "i",
  ));
  if (!match) return null;

  const name = match[1].trim();
  const rarity = parseRarity(match[2]);
  if (!name || !rarity) return null;

  const setCodes = match[4].split("/").map((value) => value.trim().toUpperCase()).filter(Boolean);
  // A single explicitly-delimited set code is safe intent. A slash means the
  // source listed alternatives, so leave the selection unset rather than guess.
  return { name, rarity, setCode: setCodes.length === 1 ? setCodes[0] : "" };
}

function splitTableFields(line) {
  return line
    .split(/\t+|\s{2,}/)
    .map((field) => field.trim())
    .filter(Boolean);
}

// Catches lonely quantity cells from copied spreadsheet/table paste.
function isQuantityOnlyLine(line) {
  return /^\d+\s*x?$/i.test(line.trim());
}

// Tosses table headers like Qty, Card Name, and Rarity into the bin.
function isTableHeaderLine(line) {
  const normalized = normalizeName(line);
  if (["qty", "quantity", "card name", "card", "rarity"].includes(normalized)) return true;

  const fields = splitTableFields(line).map((field) => normalizeName(field));
  return fields.includes("card name") && fields.includes("rarity") && fields.includes("quantity");
}

// Catches rarity cells that got pasted on their own line.
function isStandaloneRarityLine(line) {
  return Boolean(parseRarity(line));
}

function normalizeHorizontalTableRow(line) {
  const fields = splitTableFields(line);
  if (fields.length < 2 || isTableHeaderLine(line)) return "";
  if (!fields.slice(1).every((field) => parseMetadataField(field))) return "";

  // Keep the whole name cell together, including its internal commas/quotes.
  return [`"${unquoteField(fields[0]).replace(/"/g, '""')}"`, ...fields.slice(1)].join(", ");
}

// Reassembles messy copied tables back into "qty card rarity" lines. This is worth a review if shit gets weird - we've had a few copy-pasted tables into teams and this should hopefully resolve it.
function normalizeCopiedTableLines(lines) {
  const normalized = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (isTableHeaderLine(line)) continue;

    const horizontalTableRow = normalizeHorizontalTableRow(line);
    if (horizontalTableRow) {
      normalized.push(horizontalTableRow);
      continue;
    }

    if (
      isQuantityOnlyLine(line)
      && lines[index + 1]
      && lines[index + 2]
      && !isTableHeaderLine(lines[index + 1])
      && isStandaloneRarityLine(lines[index + 2])
    ) {
      normalized.push(`${line} ${lines[index + 1]} ${lines[index + 2]}`);
      index += 2;
      continue;
    }

    if (isQuantityOnlyLine(line) || isStandaloneRarityLine(line)) continue;

    normalized.push(line);
  }

  return normalized;
}

// Tidies punctuation and pasted list leftovers before we ask Scryfall what this thing is.
function cleanCardName(value) {
  const cleaned = value
    .replace(/^[•*]\s+/, "")
    .replace(/\s+[:;=8xX][-']?[)(DPp]\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return splitCommaFields(cleaned).map(unquoteField).join(", ");
}

// Produces the Scryfall lookup name after special requests have been safely peeled off.
function cleanLookupName(value) {
  return cleanCardName(value);
}

// Spots token requests so they can skip Scryfall and go to their own little token corner.
function isTokenRequestName(value) {
  return /\btoken\b/i.test(value);
}

// Finds token stats like 3/3 and formats them first, as the cardboard gods intended.
function extractPowerToughness(value) {
  const match = value.match(/\b((?:\d+|x|\*)\s*\/\s*(?:\d+|x|\*))\b/i);
  return match ? match[1].replace(/\s+/g, "").toUpperCase() : "";
}

// Pulls token details into "(3/3, Trample, Vigilance)" style notes. P/T first, then keyword abilities.
function extractTokenDetails(value) {
  const powerToughness = extractPowerToughness(value);
  const keywords = TOKEN_KEYWORD_PATTERNS
    .filter(([, pattern]) => pattern.test(value))
    .map(([label]) => label);
  return Array.from(new Set([powerToughness, ...keywords].filter(Boolean)));
}

// Finds token colors so "Green Dinosaur Token" comes out green first.
function extractTokenColors(value) {
  const colors = TOKEN_COLOR_PATTERNS
    .filter(([, pattern]) => pattern.test(value))
    .map(([label]) => label);
  return Array.from(new Set(colors));
}

// Removes stats, colors, and keywords from token names so the final line is not double-stuffed.
function cleanTokenName(value) {
  let cleaned = value
    .replace(/\b(?:\d+|x|\*)\s*\/\s*(?:\d+|x|\*)\b/ig, " ");

  TOKEN_KEYWORD_PATTERNS.forEach(([, pattern]) => {
    cleaned = cleaned.replace(pattern, " ");
  });

  TOKEN_COLOR_PATTERNS.forEach(([, pattern]) => {
    cleaned = cleaned.replace(pattern, " ");
  });

  return cleaned
    .replace(/\b(?:with|and|or|has|having)\b/ig, " ")
    .replace(/\([\s,;/]*\)|\[[\s,;/]*\]/g, " ")
    .replace(/\s*[,.;:-]\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Adds color words before a token name to help with the pullingses
function applyTokenColors(name, colors = []) {
  if (!colors.length) return name;
  const colorPrefix = colors.join("/");
  return normalizeName(name).startsWith(normalizeName(colorPrefix))
    ? name
    : `${colorPrefix} ${name}`;
}

// Merges special-printing asks while deduping repeats from grouped lines.
function mergeSpecialRequests(a = [], b = []) {
  return Array.from(new Set([...a, ...b]));
}

function requestedPrintingFor(specialRequests: string[], setCode = ""): PullItem["requestedPrinting"] {
  const requests = new Set(specialRequests);
  const treatment = requests.has("RETRO FRAME") ? "retro"
    : requests.has("SHOWCASE") ? "showcase"
      : requests.has("BORDERLESS") ? "borderless"
        : requests.has("EXTENDED ART") ? "extended-art"
          : requests.has("FULL ART") ? "full-art"
            : "";
  const finish: PullItem["requestedPrinting"]["finish"] = requests.has("SURGE FOIL") ? "foil"
    : requests.has("ETCHED") ? "etched"
    : requests.has("FOIL") ? "foil"
      : requests.has("NONFOIL") ? "normal"
        : undefined;
  const foilTreatment: PullItem["requestedPrinting"]["foilTreatment"] = requests.has("SURGE FOIL") ? "surge"
    : requests.has("FOIL") ? "standard"
      : undefined;
  const requestedPrinting = {
    ...(setCode ? { setCode: setCode.toUpperCase() } : {}),
    ...(finish ? { finish } : {}),
    ...(foilTreatment ? { foilTreatment } : {}),
    ...(treatment ? { treatment } : {}),
  };
  return Object.keys(requestedPrinting).length ? requestedPrinting : undefined;
}

function mergeRequestedPrinting(a, b) {
  const shared = { ...(a || {}), ...(b || {}) };
  // A slash-separated row is intentionally not a set selection; likewise do
  // not choose between two grouped lines that explicitly requested different sets.
  if (a?.setCode && b?.setCode && a.setCode !== b.setCode) delete shared.setCode;
  return Object.keys(shared).length ? shared : undefined;
}

// Checks whether an item needs a specific printing style beyond plain old nonfoil.
function hasSpecialPrintRequest(item) {
  if (item.requestedPrinting?.sourceFormat === "set-collector-export") {
    return (item.specialRequests || []).some((request) => request !== "NONFOIL"
      && !(request === "FOIL" && item.requestedPrinting.finish === "foil"));
  }
  return Boolean(item.requestedPrinting?.setCode) || (item.specialRequests || []).some((request) => request !== "NONFOIL");
}

/** One decision shared by scheduling, progress and diagnostics; no provider calls. */
export function requiresScryfallEnrichment(item, options: ProviderOptions = {}) {
  const decision = (required: boolean, reason: string) => ({ required, reason });
  if (item.isToken) return decision(false, "token");
  if ((item.isBasicLand || BASIC_LAND_NAMES.has(item.inputName)) && !hasSpecialPrintRequest(item)) return decision(false, "basic-land");
  if (item.status === "review") return decision(false, "already-complete");
  if (item.status !== "found") return decision(true, item.enrichmentReason || "fuzzy-name-required");
  if (item.prints?.length && item.eligibleRarityChecked && !item.printLookupFailed) return decision(false, "already-complete");
  if (options.enrichmentPurpose === "pricing-recovery") return decision(true, "pricing-recovery");
  if (options.enrichmentPurpose === "case-check") return decision(true, "case-check");
  if (item.requestedFlavor) return decision(true, "requested-flavor-name");
  if (hasSpecialPrintRequest(item)) return decision(true, "special-printing-request");
  if (item.legacyIndexCompatibility) return decision(!item.paperIdentityVerified, "legacy-index-compatibility");
  if (!item.localPaperVerified && !isPlayablePaperCard(item.card)) return decision(true, "insufficient-paper-confidence");
  if (!item.localRarityVerified) return decision(true, "insufficient-local-rarity");
  return decision(false, "already-complete");
}

// Tests whether a specific Scryfall printing satisfies the customer's fancy-version request.
function printMatchesSpecialRequests(print, item) {
  if (!isPlayablePaperCard(print)) return false;
  if (item.requestedPrinting?.setCode && String(print.set || "").toUpperCase() !== item.requestedPrinting.setCode.toUpperCase()) return false;
  const requests = item.specialRequests || [];
  if (!requests.length) return true;

  return requests.every((request) => {
    if (request === "FOIL") return print.foil || print.finishes?.includes("foil");
    if (request === "NONFOIL") return print.nonfoil || print.finishes?.includes("nonfoil");
    if (request === "FULL ART") return Boolean(print.full_art);
    if (request === "BORDERLESS") return print.border_color === "borderless" || print.frame_effects?.includes("borderless");
    if (request === "EXTENDED ART") return print.frame_effects?.includes("extendedart") || print.promo_types?.includes("extendedart");
    if (request === "SHOWCASE") return print.frame_effects?.includes("showcase") || print.promo_types?.includes("showcase");
    if (request === "ETCHED") return print.finishes?.includes("etched");
    if (request === "SURGE FOIL") return (print.finishes?.includes("foil") || print.foil) && print.promo_types?.includes("surgefoil");
    if (request === "RETRO FRAME") return treatmentsForRawPrinting(print).includes("retro");
    if (request === "ALT ART") return print.promo_types?.some((type) => /alternate|boosterfun|showcase|borderless/.test(type));
    if (request === "PROMO") return Boolean(print.promo);
    return true;
  });
}

// Appends " - FOIL" and friends to the final output line.
function specialRequestNote(item) {
  return (item.specialRequests || []).map((request) => ` - ${request}`).join("");
}

// Explains why a special-printing request got kicked to Needs Review.
function specialRequestReviewNote(item) {
  const requests = item.specialRequests || [];
  if (!requests.length) return item.requestedPrinting?.setCode ? "Requested set not found" : "";
  if (requests.length === 1) return `${requests[0]} version not found`;
  return `${requests.join(" / ")} version not found`;
}

// Finds reskin/Universe Within style names so requested titles stay visible in parentheses.
function requestedFlavorName(item, prints = []) {
  const candidates = [item.card, ...prints].filter(Boolean);
  const inputNormalized = normalizeName(item.inputName);
  const inputCompact = compactName(item.inputName);
  const flavorNames = candidates.flatMap((print) => [
    print.flavor_name,
    ...(print.card_faces || []).map((face) => face.flavor_name),
  ]).filter(Boolean);
  const match = flavorNames.find((flavorName) => (
    normalizeName(flavorName) === inputNormalized
      || compactName(flavorName) === inputCompact
  ));

  return match || "";
}

function pullTrailingParentheticalQuantity(line) {
  const match = line.match(/\s*\((\d+)\)\s*$/);
  const quantity = Number(match?.[1] || 0);
  if (!match || !Number.isFinite(quantity) || quantity <= 0) {
    return { line, quantity: 0 };
  }

  return {
    line: line.slice(0, match.index).trim(),
    quantity,
  };
}

// Reads parenthetical rarities/print asks, then removes only the useful metadata bits.
function stripReviewParentheticals(line: string, metadata: ParsedMetadata) {
  const match = line.match(/\(([^()]*)\)\s*$|\[([^\[\]]*)\]\s*$/);
  if (!match || !match.index) return line;
  const parsed = parseMetadataField(match[1] ?? match[2]);
  if (!parsed) return line;
  mergeMetadata(metadata, parsed);
  return line.slice(0, match.index).trim();
}

// Peel only complete suffixes. Try dash boundaries from right to left so earlier
// internal punctuation never becomes an automatic end-of-name marker.
function stripTrailingDescriptors(line: string, metadata: ParsedMetadata) {
  let remaining = line.trim().replace(/,\s*$/, "").trim();

  while (remaining) {
    const parenthetical = stripReviewParentheticals(remaining, metadata);
    if (parenthetical !== remaining) {
      remaining = parenthetical;
      continue;
    }
    const comma = applyCommaMetadata(remaining, metadata);
    if (comma !== remaining) {
      remaining = comma;
      // The first unknown comma field established the name boundary. Don't
      // reinterpret words within it as a second, shorter candidate.
      if (splitCommaFields(remaining).length > 1) break;
      continue;
    }

    // A quoted name is one name field; its contents aren't metadata.
    if (unquoteField(remaining) !== remaining) break;

    const hasCommaFields = splitCommaFields(remaining).length > 1;
    const dashes = Array.from(remaining.matchAll(/[-–—]/g)).reverse().filter((match) => (
      !hasCommaFields || /\s/.test(remaining[match.index - 1] || "") && /\s/.test(remaining[match.index + 1] || "")
    ));
    const dashSuffix = dashes.map((match) => ({
      index: match.index,
      parsed: parseMetadataField(remaining.slice(match.index + 1), /\s/.test(remaining[match.index - 1] || "") && /\s/.test(remaining[match.index + 1] || "")),
    })).find(({ index, parsed }) => index > 0 && parsed);
    if (dashSuffix) {
      mergeMetadata(metadata, dashSuffix.parsed);
      remaining = remaining.slice(0, dashSuffix.index).trim();
      continue;
    }
    if (/\s[-–—]\s/.test(remaining)) break;

    // Retain legacy space-separated asks, including multiword SURGE FOIL and
    // Mythic Rare. Set codes/prices/plain numbers require a field delimiter.
    let wordSuffix: { index: number; parsed: ParsedMetadata } | null = null;
    for (const match of Array.from(remaining.matchAll(/\s+/g)).reverse()) {
      if (/[:/]$/.test(remaining.slice(0, match.index))) break;
      const parsed = parseMetadataField(remaining.slice(match.index + match[0].length), false);
      // Bare printing asks on comma-bearing names are established input syntax.
      // Other comma fields must pass the full-field grammar above.
      if (hasCommaFields && (!parsed?.specialRequests.length || parsed.rarities.length || parsed.quantity !== undefined || parsed.color)) continue;
      if (parsed) wordSuffix = { index: match.index, parsed };
      else if (wordSuffix) break;
    }
    if (wordSuffix) {
      mergeMetadata(metadata, wordSuffix.parsed);
      remaining = remaining.slice(0, wordSuffix.index).trim();
      continue;
    }
    break;
  }

  // Remove only an orphan final separator, never internal punctuation.
  return remaining.replace(/\s*,\s*$/, "").trim();
}

// Converts one raw pasted line into a structured card/token/basic-land request.
function parseCardLine(rawLine: string, index: number): PullItem | null {
  let line = rawLine.trim().replace(/^[-•]\s*/, "");
  if (!line || /^(\/\/|#)/.test(line)) return null;

  const quantityMatch = line.match(/^(\d+)\s*x?\s+(.+)$/i);
  let quantity = quantityMatch ? Number(quantityMatch[1]) : 1;
  line = quantityMatch ? quantityMatch[2].trim() : line;
  const structuredExport = parseStructuredExportLine(line, true);
  // Correct display-name encoding without rewriting imported source identifiers.
  const nameToRepair = structuredExport ? structuredExport.name : line;
  const repairedName = repairMojibake(nameToRepair);
  const mojibakeCorrected = repairedName !== nameToRepair;
  if (structuredExport) structuredExport.name = repairedName;
  else line = repairedName;

  const manaMatch = line.match(/^(white|blue|black|red|green)\s+mana$/i);
  if (manaMatch) {
    const color = manaMatch[1].toLowerCase();
    const landName = BASIC_LANDS_BY_COLOR[color];
    return {
      index,
      original: rawLine,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      inputName: landName,
      statedRarities: ["common"],
      specialRequests: [],
      lookupKey: normalizeName(landName),
    };
  }

  const metadata = emptyMetadata();
  const structuredPriceRow = structuredExport ? null : parseStructuredPriceRow(line);
  if (structuredExport) line = structuredExport.name;
  if (structuredPriceRow) {
    line = structuredPriceRow.name;
    metadata.rarities.push(structuredPriceRow.rarity);
    metadata.setCode = structuredPriceRow.setCode;
  }

  if (!structuredExport) {
    const parentheticalQuantity = pullTrailingParentheticalQuantity(line);
    line = parentheticalQuantity.line;
    quantity = parentheticalQuantity.quantity || quantity;
    if (!structuredPriceRow) line = stripTrailingDescriptors(line, metadata);
  }
  quantity = metadata.quantity || quantity;

  let inputName = cleanLookupName(line);
  if (!inputName) return null;
  const isToken = isTokenRequestName(inputName);
  // Imported set/collector identifiers are not token colors, abilities, or P/T.
  const tokenSource = structuredExport ? inputName : rawLine;
  const tokenDetails = isToken ? extractTokenDetails(tokenSource) : [];
  const tokenColors = isToken ? extractTokenColors(tokenSource) : [];
  if (isToken) inputName = applyTokenColors(cleanTokenName(inputName), tokenColors);
  if (!inputName) return null;

  const uniqueSpecialRequests = Array.from(new Set([...metadata.specialRequests, ...(structuredExport?.finish === "foil" ? ["FOIL"] : [])]));
  return {
    index,
    original: rawLine,
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    inputName,
    statedRarities: Array.from(new Set(metadata.rarities)),
    specialRequests: uniqueSpecialRequests,
    requestedPrinting: structuredExport ? {
      setCode: structuredExport.setCode, collectorNumber: structuredExport.collectorNumber,
      ...(structuredExport.finish ? { finish: structuredExport.finish, foilTreatment: structuredExport.foilTreatment } : {}),
      sourceFormat: structuredExport.sourceFormat,
    } : requestedPrintingFor(uniqueSpecialRequests, metadata.setCode),
    structuredExportDetected: detectStructuredExportSuffix(rawLine),
    structuredExportParsed: Boolean(structuredExport),
    mojibakeCorrected,
    lookupKey: isToken ? normalizeName(`${inputName} ${tokenDetails.join(" ")}`) : normalizeName(inputName),
    ...(isToken ? {
      status: "found",
      isToken: true,
      tokenDetails,
      tokenColors,
      rarities: ["common"],
      nonSecretRarities: ["common"],
    } : {}),
  };
}

// Parses the whole input, groups duplicates, and counts what we need to resolve.
export function parsePullList(text: string) {
  const { customer, cardLines } = parseCustomerAndCards(text);
  const normalizedCardLines = normalizeCopiedTableLines(cardLines);
  const grouped = new Map<string, PullItem>();
  const diagnostics = { structuredExportRowsDetected: 0, structuredExportRowsParsed: 0, importedPrintingHints: 0, mojibakeCorrections: 0 };

  normalizedCardLines.forEach((line, index) => {
    const item = parseCardLine(line, index);
    if (!item) return;
    if (item.structuredExportDetected) diagnostics.structuredExportRowsDetected += 1;
    if (item.structuredExportParsed) { diagnostics.structuredExportRowsParsed += 1; diagnostics.importedPrintingHints += 1; }
    if (item.mojibakeCorrected) diagnostics.mojibakeCorrections += 1;

    // Keep imported physical preferences distinct, while identical requests still
    // combine quantities. The lookupKey itself remains only canonical name text.
    const hint = item.requestedPrinting;
    const groupKey = hint?.sourceFormat === "set-collector-export"
      ? JSON.stringify([item.lookupKey, hint.setCode?.toLowerCase(), hint.collectorNumber?.toLowerCase(), hint.finish || "", hint.foilTreatment || ""])
      : item.lookupKey;
    const existing = grouped.get(groupKey);
    if (existing) {
      existing.quantity += item.quantity;
      existing.originals.push(item.original);
      existing.statedRarities = Array.from(new Set([...existing.statedRarities, ...item.statedRarities]));
      existing.specialRequests = mergeSpecialRequests(existing.specialRequests, item.specialRequests);
      existing.requestedPrinting = mergeRequestedPrinting(existing.requestedPrinting, item.requestedPrinting);
      existing.tokenDetails = Array.from(new Set([...(existing.tokenDetails || []), ...(item.tokenDetails || [])]));
      existing.tokenColors = Array.from(new Set([...(existing.tokenColors || []), ...(item.tokenColors || [])]));
      existing.presetStatus = existing.presetStatus || item.presetStatus;
      existing.note = existing.note || item.note;
      return;
    }

    grouped.set(groupKey, { ...item, originals: [item.original] });
  });

  return { customer, cards: Array.from(grouped.values()), cardLineCount: normalizedCardLines.length, diagnostics };
}

// Slices arrays into small batches for parallel-but-polite Scryfall work, so scryfall doesn't give me a spank.
function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function runtimeEnv(name: string) {
  return typeof process !== "undefined" ? process.env?.[name] || "" : "";
}

function isServerRuntime() {
  return typeof window === "undefined";
}

function defaultMtgjsonManifestUrl() {
  if (typeof window !== "undefined") {
    const isLocalhost = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
    const origin = isLocalhost ? PRODUCTION_ORIGIN : window.location.origin;
    return `${origin}/api/mtgjson-index`;
  }

  return new URL("/api/mtgjson-index", runtimeEnv("FORMATTER_BASE_URL") || PRODUCTION_ORIGIN).toString();
}

function scryfallRequestHeaders(headersInit: HeadersInit | undefined) {
  const headers = new Headers(headersInit || {});
  if (isServerRuntime() && !headers.has("user-agent")) {
    headers.set("user-agent", "rrg-pull-list-formatter/0.5.2");
  }
  return headers;
}

function mtgjsonAliasKey(value: string) {
  const normalized = normalizeName(value);
  const compact = compactName(value);
  return [normalized, compact].filter(Boolean);
}

function chooseExactMtgjsonCandidate(index: MtgjsonCardIndex, inputName: string, cardKeys: string[]) {
  const inputNormalized = normalizeName(inputName);
  const inputCompact = compactName(inputName);
  const matches = cardKeys
    .map((cardKey) => index.cards?.[cardKey] || null)
    .filter(Boolean)
    .filter((card) => (
      normalizeName(card.name) === inputNormalized
        || compactName(card.name) === inputCompact
        || normalizeName(card.asciiName || "") === inputNormalized
        || compactName(card.asciiName || "") === inputCompact
    ));

  return matches.length === 1 ? matches[0] : null;
}

function findMtgjsonCard(index: MtgjsonCardIndex | null, inputName: string) {
  if (!index?.cards) return null;

  for (const key of mtgjsonAliasKey(inputName)) {
    if (index.ambiguousAliases?.[key]?.length) {
      const card = chooseExactMtgjsonCandidate(index, inputName, index.ambiguousAliases[key]);
      return card ? { card, ambiguous: false } : { card: null, ambiguous: true };
    }
    const cardKey = index.aliases?.[key];
    const card = cardKey ? index.cards[cardKey]
      : chooseExactMtgjsonCandidate(index, inputName, [key]);
    if (card) return { card, ambiguous: false };
  }

  return null;
}

function mtgjsonCardRarities(card: MtgjsonIndexedCard, safePaper = false) {
  if (safePaper) return Array.from(new Set((card.paperRarities || []).map(parseRarity).filter(Boolean)));
  const sourceRarities = card.nonSecretRarities?.length ? card.nonSecretRarities : card.rarities || [];
  return Array.from(new Set(sourceRarities.map((rarity) => parseRarity(rarity)).filter(Boolean)));
}

function mtgjsonCardShape(card: MtgjsonIndexedCard, item: PullItem, paperVerified: boolean) {
  const rarity = item.statedRarities?.[0] || mtgjsonCardRarities(card)[0] || "";
  return {
    name: card.name,
    rarity,
    type_line: card.type || card.types?.join(" ") || "",
    games: paperVerified ? ["paper"] : [],
    digital: !paperVerified,
    set_type: "mtgjson",
    scryfall_oracle_id: card.scryfallOracleId || "",
    mtgjson: card,
  };
}

function resolveItemWithMtgjsonCard(item: PullItem, card: MtgjsonIndexedCard, index: MtgjsonCardIndex) {
  const paperVerified = index.version === 3 && card.hasPlayablePaperPrinting === true;
  const localRarityVerified = hasSufficientLocalPaperEvidence(card, index);
  const inputRarities = item.statedRarities?.length ? item.statedRarities : [];
  const providerRarities = mtgjsonCardRarities(card, localRarityVerified);
  const rarities = providerRarities.length ? providerRarities : inputRarities;
  return {
    ...item,
    card: mtgjsonCardShape(card, item, paperVerified),
    status: "found",
    lookupSource: "mtgjson",
    raritySource: inputRarities.length ? "input" : providerRarities.length ? "mtgjson" : "",
    isBasicLand: BASIC_LAND_NAMES.has(card.name),
    correction: normalizeName(card.name) !== normalizeName(item.inputName),
    rarities,
    nonSecretRarities: rarities,
    eligibleRarityChecked: Boolean(rarities.length),
    mtgjsonCard: card,
    localPaperVerified: paperVerified,
    localRarityVerified,
    rarityEvidence: localRarityVerified ? "current-index" : "legacy-index",
    legacyRarities: localRarityVerified ? undefined : providerRarities,
    requestedFlavor: ![card.name, card.asciiName].filter(Boolean).some((name) => compactName(name) === compactName(item.inputName)),
  };
}

async function resolveExactWithMtgjson(items: PullItem[], setMessage, options: ProviderOptions) {
  if (!items.length) return { resolved: [], missing: items };

  if (options.performance) options.performance.stage = "index";
  const recordDiagnostics = (diagnostics) => {
    if (!options.performance) return;
    options.performance.indexSource = diagnostics.source;
    options.performance.indexFailureStage = diagnostics.failureStage;
    options.performance.stages.manifest += diagnostics.manifestMs;
    options.performance.stages.indexLoad += diagnostics.indexLoadMs;
    options.performance.stages.indexParseValidation += diagnostics.indexParseValidationMs;
    countPerformance(options.performance, "manifestRequests", diagnostics.manifestRequests);
    countPerformance(options.performance, "indexRequests", diagnostics.indexRequests);
    countPerformance(options.performance, "indexCacheHits", diagnostics.cacheHits);
    options.performance.stage = "mtgjsonLookup";
  };
  let loaded;
  try {
    loaded = await loadMtgjsonResolutionIndex(options.mtgjsonManifestUrl || defaultMtgjsonManifestUrl(), { signal: options.signal, onProgress: setMessage });
  } catch (error) {
    if (error?.diagnostics) recordDiagnostics(error.diagnostics);
    throw error;
  }
  const { index, diagnostics } = loaded;
  recordDiagnostics(diagnostics);
  recordResolutionIndexReadiness(options.performance, index);
  const lookupStarted = processingNow();
  const resolved = [];
  const missing = [];

  for (const item of items) {
    const result = findMtgjsonCard(index, item.inputName);
    if (result?.ambiguous) {
      countPerformance(options.performance, "ambiguousMatches");
      missing.push({ ...item, enrichmentReason: "mtgjson-ambiguous", note: "Ambiguous MTGJSON exact match" });
      continue;
    }

    if (!result?.card) {
      countPerformance(options.performance, "mtgjsonMisses");
      missing.push({ ...item, enrichmentReason: "mtgjson-miss" });
      continue;
    }

    countPerformance(options.performance, "mtgjsonMatches");
    const local: PullItem = resolveItemWithMtgjsonCard(item, result.card, index);
    if (!local.localRarityVerified && !local.requestedFlavor && !hasSpecialPrintRequest(local)
      && options.enrichmentPurpose !== "case-check" && options.enrichmentPurpose !== "pricing-recovery") {
      local.legacyIndexCompatibility = true;
      if (options.performance) options.performance.legacyIndexCompatibilityMode = true;
      if (options.useScryfall === false) {
        resolved.push({ ...local, status: "review", lessVerified: true, note: "Card-name index requires refresh; paper identity not verified (Scryfall disabled)." });
      } else {
        missing.push({ ...local, status: "missing", mtgjsonExactName: result.card.name, enrichmentReason: "legacy-index-compatibility" });
      }
      continue;
    }
    const decision = requiresScryfallEnrichment(local, options);
    if (decision.required && options.useScryfall !== false) {
      missing.push({ ...local, status: "missing", mtgjsonExactName: result.card.name, enrichmentReason: decision.reason });
    } else resolved.push(local);
  }

  const guarded = guardBulkExactMisses(items, resolved, missing, options);
  if (options.performance) options.performance.stages.mtgjsonLookup += processingNow() - lookupStarted;
  if (guarded) {
    setMessage(BULK_MISS_GUARD_MESSAGE);
    return guarded;
  }
  setMessage(`MTGJSON matched ${resolved.length} cards ready locally; ${missing.length} need further verification.`);
  if (missing.some((item) => item.legacyIndexCompatibility)) setMessage("Card-name index is outdated. Using compatibility verification.");
  return { resolved, missing };
}

const BULK_MISS_MINIMUM_NAMES = 20;
const BULK_MISS_RATIO_THRESHOLD = 0.60;
const BULK_MISS_EXPORT_EVIDENCE_RATIO = 0.60;

/** Detect a failed export shape after exact lookup, before any per-name remote work. */
function guardBulkExactMisses(items: PullItem[], resolved: PullItem[], missing: PullItem[], options: ProviderOptions) {
  const ordinary = (item: PullItem) => !item.isToken && !item.isBasicLand && !BASIC_LAND_NAMES.has(item.inputName)
    && !item.requestedFlavor && !hasSpecialPrintRequest(item);
  const ordinaryNames = new Set(items.filter(ordinary).map((item) => normalizeName(item.inputName)));
  const missingNames = new Map<string, PullItem[]>();
  for (const item of missing) {
    if (item.enrichmentReason !== "mtgjson-miss" || !ordinary(item)) continue;
    const key = normalizeName(item.inputName);
    missingNames.set(key, [...(missingNames.get(key) || []), item]);
  }
  const exactMissRatio = ordinaryNames.size ? missingNames.size / ordinaryNames.size : null;
  if (options.performance) options.performance.exactMissRatio = exactMissRatio;
  if (options.useScryfall === false || options.enrichmentPurpose === "pricing-recovery"
    || ordinaryNames.size < BULK_MISS_MINIMUM_NAMES || !(exactMissRatio > BULK_MISS_RATIO_THRESHOLD)) return null;

  // Hints prove the supported parser ran. Raw suffix evidence also catches an
  // export variant that the parser conservatively left untouched. Names-only
  // misspellings and newly released individual cards keep normal recovery.
  const hasExportEvidence = (item: PullItem) => item.requestedPrinting?.sourceFormat === "set-collector-export"
    || [item.original, ...(item.originals || [])].some((line) => typeof line === "string" && detectStructuredExportSuffix(line));
  const exportMisses = [...missingNames.values()].filter((entries) => entries.some(hasExportEvidence)).length;
  if (exportMisses / missingNames.size < BULK_MISS_EXPORT_EVIDENCE_RATIO) return null;

  const blocked = missing.filter((item) => item.enrichmentReason === "mtgjson-miss" && ordinary(item));
  const blockedItems = new Set(blocked);
  if (options.performance) options.performance.bulkMissGuardTriggered = true;
  countPerformance(options.performance, "fuzzyLookupsPrevented", missingNames.size);
  return {
    resolved: [...resolved, ...blocked.map((item) => ({
      ...item, status: "review", bulkMissGuarded: true, lessVerified: true,
      enrichmentReason: "bulk-exact-miss-guard",
      note: "Most exact card names failed. Check the pasted export format before reprocessing.",
    }))],
    missing: missing.filter((item) => !blockedItems.has(item)),
  };
}

// Fetches JSON with cache, retries, throttling, and a little patience when Scryfall has a mood.
const scryfallFlights = new Map<string, { signal: AbortSignal | null | undefined; run: ScryfallRunContext; promise: Promise<FetchResult> }[]>();

function evictScryfallResponse(url: string, options: RequestInit = {}) {
  try { if (typeof localStorage !== "undefined") localStorage.removeItem(cacheKeyForRequest(url, options)); } catch { /* Optional cache. */ }
}

function normalizedScryfallResponse(url: string, data, context: ProviderOptions, countDropped = false) {
  const type = context.requestType || scryfallRequestCounter(url);
  if (type === "scryfallExact" || type === "scryfallFuzzy") return normalizeScryfallCard(data);
  if (type === "scryfallCollection" || type === "scryfallPrintPages") {
    if (!Array.isArray(data?.data) || (data.has_more !== undefined && typeof data.has_more !== "boolean")
      || (data.has_more && (!safeScryfallUrl(data.next_page) || data.next_page === url))) return null;
    const cards = data.data.map(normalizeScryfallCard).filter((card) => card
      && (type !== "scryfallPrintPages" || (Array.isArray(card.games) && Boolean(parseRarity(card.rarity))
        && (Boolean(card.type_line) || card.card_faces?.some((face) => Boolean(face.type_line))))));
    const dropped = data.data.length - cards.length;
    if (countDropped && dropped && context.providerRun) countMalformedRecords(context.providerRun, dropped);
    if (!cards.length && (data.data.length || type === "scryfallPrintPages")) return null;
    return { ...data, data: cards };
  }
  if (type === "scryfallSets") return Array.isArray(data?.data) && data.data.every((set) => set && typeof set.code === "string") ? data : null;
  return Number.isFinite(data?.total_cards) && data.total_cards >= 0 ? data : null;
}

function safeScryfallUrl(value) {
  if (typeof value !== "string") return false;
  try { const url = new URL(value); return url.origin === "https://api.scryfall.com" && !url.username && !url.password; }
  catch { return false; }
}

function scryfallRequestCounter(url: string) {
  const parsed = new URL(url);
  if (parsed.pathname.endsWith("/collection")) return "scryfallCollection";
  if (parsed.pathname.endsWith("/named")) return parsed.searchParams.has("exact") ? "scryfallExact" : "scryfallFuzzy";
  if (parsed.pathname.endsWith("/sets")) return "scryfallSets";
  if (parsed.searchParams.get("unique") === "prints" || parsed.searchParams.has("order") || /oracleid|oracle_id|!"/.test(parsed.searchParams.get("q") || "")) return "scryfallPrintPages";
  return "scryfallSearch";
}

async function fetchJsonWithRetry(url: string, options: RequestInit = {}, attempts = SCRYFALL_MAX_ATTEMPTS, context: ProviderOptions = {}): Promise<FetchResult> {
  context = providerContext(context);
  throwIfAborted(context.signal);
  const cached = readCachedResponse(url, options);
  const normalizedCache = cached && normalizedScryfallResponse(url, cached.data, context);
  if (cached && normalizedCache) { countPerformance(context.performance, "scryfallCacheHits"); return { ...cached, data: normalizedCache }; }
  if (cached) evictScryfallResponse(url, options);
  const stopped = providerCircuitFailure(context.providerRun, (context.requestType || scryfallRequestCounter(url)) as ProviderOperation);
  if (stopped) return { ok: false, status: 0, data: null, failure: stopped };
  const key = cacheKeyForRequest(url, options);
  const existing = scryfallFlights.get(key)?.find((entry) => entry.signal === context.signal && entry.run === context.providerRun);
  if (existing) { countPerformance(context.performance, "scryfallCacheHits"); return existing.promise; }
  const entry = { signal: context.signal, run: context.providerRun!, promise: fetchJsonAttempts(url, options, Math.min(attempts, SCRYFALL_MAX_ATTEMPTS), context) };
  scryfallFlights.set(key, [...(scryfallFlights.get(key) || []), entry]);
  try { return await entry.promise; }
  finally {
    const remaining = (scryfallFlights.get(key) || []).filter((item) => item !== entry);
    if (remaining.length) scryfallFlights.set(key, remaining); else scryfallFlights.delete(key);
  }
}

async function fetchJsonAttempts(url: string, options: RequestInit, attempts: number, context: ProviderOptions): Promise<FetchResult> {
  const run = context.providerRun!;
  const operation = (context.requestType || scryfallRequestCounter(url)) as ProviderOperation;
  const retryableStatuses = new Set([408, 425, 500, 502, 503, 504]);
  let failure: ProviderFailure = { kind: "network", retryable: true, operation, attemptCount: 0 };

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    let timedOut = false;
    let responseStatus: number | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      throwIfAborted(context.signal);
      if (!await waitForScryfallSlot(context)) return { ok: false, status: 0, data: null, failure: providerCircuitFailure(run, operation)! };
      throwIfAborted(context.signal);
      context.signal?.addEventListener("abort", abort, { once: true });
      run.controller.signal.addEventListener("abort", abort, { once: true });
      recordProviderAttempt(run, operation, attempt);
      // Abort cooperative fetch and bound even a transport/body reader that ignores abort.
      const remaining = remainingProviderMs(run);
      const deadline = new Promise<never>((_, reject) => {
        const cancel = () => reject(new DOMException("Request interrupted.", "AbortError"));
        controller.signal.addEventListener("abort", cancel, { once: true });
        timeout = setTimeout(() => {
          timedOut = true;
          if (remaining <= SCRYFALL_REQUEST_TIMEOUT_MS) openScryfallCircuit(run, "time_budget");
          controller.abort();
        }, Math.min(SCRYFALL_REQUEST_TIMEOUT_MS, remaining));
      });
      const response = await Promise.race([fetch(url, {
        ...options, headers: scryfallRequestHeaders(options.headers), signal: controller.signal,
      }).then(async (response) => {
        responseStatus = response.status;
        return { ok: response.ok, status: response.status, headers: response.headers,
          data: response.ok ? await response.json() : null };
      }), deadline]);
      clearTimeout(timeout);
      if (!response.ok) {
        failure = { kind: response.status === 403 ? "forbidden" : response.status === 429 ? "rate-limited" : "http-status",
          status: response.status, retryable: retryableStatuses.has(response.status), operation, attemptCount: attempt,
          ...(response.status === 429 ? { retryAfterMs: retryAfterDuration(response.headers.get("Retry-After"), run.now()) } : {}) };
      } else {
        const normalized = normalizedScryfallResponse(url, response.data, context, true);
        if (normalized) {
          recordProviderSuccess(run);
          const result = { ok: true, status: response.status, data: normalized };
          writeCachedResponse(url, options, result);
          return result;
        }
        failure = { kind: response.data?.has_more && response.data.next_page === url ? "pagination-loop" : "invalid-response", status: response.status, retryable: false, operation, attemptCount: attempt };
      }
    } catch (error) {
      if (context.signal?.aborted) recordProviderFailure(run, { kind: "canceled", retryable: false, operation, attemptCount: attempt });
      throwIfAborted(context.signal);
      const stopped = providerCircuitFailure(run, operation);
      if (stopped) return { ok: false, status: 0, data: null, failure: { ...stopped, attemptCount: attempt } };
      const kind = timedOut ? "timeout" : error instanceof SyntaxError ? "malformed-json" : "network";
      failure = { kind, ...(responseStatus ? { status: responseStatus } : {}), retryable: kind === "timeout" || kind === "network", operation, attemptCount: attempt };
    } finally {
      clearTimeout(timeout);
      context.signal?.removeEventListener("abort", abort);
      run.controller.signal.removeEventListener("abort", abort);
    }
    recordProviderFailure(run, failure);
    if (!failure.retryable || attempt === attempts || providerCircuitFailure(run, operation)) break;
    // One retry layer, bounded jittered exponential backoff. 429 never reaches this path.
    const backoff = Math.min(1500, 400 * 2 ** (attempt - 1) * (0.75 + run.random() * 0.5));
    if (!await waitForProvider(run, backoff, context.signal)) break;
  }
  return { ok: false, status: failure.status || 0, data: null, failure };
}

// Sends up to 50 exact card-name lookups to Scryfall in one neat bundle. This has been reduced from 100, then 75, might end up reducing it again to 25 if we have to.
async function fetchCollection(items, context: ProviderOptions) {
  const result = await fetchJsonWithRetry(SCRYFALL_COLLECTION_URL, {
    method: "POST",
    headers: {
      Accept: "application/json;q=0.9,*/*;q=0.8",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      identifiers: items.map((item) => ({ name: item.mtgjsonExactName || item.inputName })),
    }),
  }, SCRYFALL_MAX_ATTEMPTS, context);
  return result;
}

function normalizeScryfallCard(card) {
  if (!card || typeof card !== "object" || Array.isArray(card) || typeof card.name !== "string" || !card.name) return null;
  const normalized = { ...card };
  // Scryfall's official Card/Face types mark these optional. Null and absence have
  // identical meaning to our treatment/flavor checks; never relax core field types.
  for (const key of ["flavor_name", "type_line", "oracle_text", "printed_name", "printed_type_line", "printed_text", "flavor_text"]) {
    if (normalized[key] === null) normalized[key] = "";
    if (normalized[key] !== undefined && typeof normalized[key] !== "string") return null;
  }
  for (const key of ["frame_effects", "promo_types"]) if (normalized[key] === null) normalized[key] = [];
  if (["id", "oracle_id", "rarity", "set", "set_name", "set_type", "prints_search_uri", "collector_number", "released_at", "border_color", "frame"].some((key) => normalized[key] !== undefined && typeof normalized[key] !== "string")) return null;
  if (["digital", "booster", "foil", "nonfoil", "full_art", "promo"].some((key) => normalized[key] !== undefined && typeof normalized[key] !== "boolean")) return null;
  if (["games", "finishes", "frame_effects", "promo_types"].some((key) => normalized[key] !== undefined
    && (!Array.isArray(normalized[key]) || normalized[key].some((value) => typeof value !== "string")))) return null;
  if (normalized.prices !== undefined && normalized.prices !== null
    && (typeof normalized.prices !== "object" || Array.isArray(normalized.prices)
      || Object.values(normalized.prices).some((price) => price !== null && typeof price !== "string"))) return null;
  if (normalized.card_faces === null) normalized.card_faces = [];
  if (normalized.card_faces !== undefined) {
    if (!Array.isArray(normalized.card_faces)) return null;
    normalized.card_faces = normalized.card_faces.map((face) => {
      if (!face || typeof face !== "object" || Array.isArray(face)) return null;
      const copy = { ...face };
      for (const key of ["name", "flavor_name", "type_line", "oracle_text", "mana_cost", "printed_name", "printed_text", "flavor_text"]) {
        if (copy[key] === null) copy[key] = "";
        if (copy[key] !== undefined && typeof copy[key] !== "string") return null;
      }
      return copy;
    });
    if (normalized.card_faces.some((face) => !face)) return null;
  }
  return normalized;
}

// Convenience wrapper for a named-card lookup when we only care about the card.
async function fetchNamedCard(name, mode = "fuzzy", context: ProviderOptions = {}) {
  const result = await fetchNamedCardResult(name, mode, context);
  return result.ok ? result.data : null;
}

// Asks Scryfall for one card by exact or fuzzy name and keeps the status details.
async function fetchNamedCardResult(name, mode = "fuzzy", context: ProviderOptions = {}) {
  const params = new URLSearchParams({ [mode]: name });
  const result = await fetchJsonWithRetry(`${SCRYFALL_NAMED_URL}?${params.toString()}`, {
    headers: { Accept: "application/json;q=0.9,*/*;q=0.8" },
  }, SCRYFALL_MAX_ATTEMPTS, context);
  return result;
}

// Checks short one-word inputs so vague names do not sneak into the sorted list. mostly just for silly edge cases the customer might have put in the list
async function hasAmbiguousPlayableName(inputName, context: ProviderOptions = {}) {
  const normalized = normalizeName(inputName);
  const words = normalized.split(" ").filter(Boolean);
  if (words.length !== 1 || normalized.length < 4) return false;

  const params = new URLSearchParams({
    q: `name:${inputName} game:paper -type:card -type:token -type:emblem`,
    unique: "cards",
  });
  const result = await fetchJsonWithRetry(`${SCRYFALL_SEARCH_URL}?${params.toString()}`, {
    headers: { Accept: "application/json;q=0.9,*/*;q=0.8" },
  }, 2, context);

  if (!result.ok) return result.status !== 404;
  const totalCards = result.data?.total_cards;
  return !Number.isFinite(totalCards) || totalCards > 1;
}

// Decides whether Scryfall's fuzzy answer is helpful or a little too confident because shit gets weird.
async function isAmbiguousFuzzyMatch(inputName, card, context: ProviderOptions = {}) {
  if (!card) return false;
  if (compactName(inputName) === compactName(card.name)) return false;
  return hasAmbiguousPlayableName(inputName, context);
}

// Filters out digital-only, tokens, emblems, and other not-for-the-drawer nonsense objects.
function isPlayablePaperCard(card) {
  if (!card || card.digital) return false;
  if (!Array.isArray(card.games) || !card.games.includes("paper")) return false;
  const typeLine = card.type_line || card.card_faces?.map((face) => face.type_line || "").join(" // ");
  if (!typeLine) return false;
  if (card.set_type === "memorabilia" || card.set_type === "token") return false;
  if (/\b(Card|Emblem|Token)\b/i.test(typeLine)) return false;
  return true;
}

// Keeps Secret Lair weirdness from incorrectly changing rarity buckets. why these might count as 'rare' to scryfall is beyond me but they do, and it breaks the sorting rules hard when they do.
function isSecretLairPrint(print) {
  return /^sl[dupc]?$/i.test(print?.set || "")
    || /\bsecret\s+lair\b/i.test(print?.set_name || "");
}

// Keeps old player-reward promos from pretending they are normal rare printings because otherwise god damn everything becomes rarity shifted and sad.
function isPlayerRewardPrint(print) {
  return /\bplayer\s+rewards?\b/i.test(print?.set_name || "")
    || /^mpr$/i.test(print?.set || "");
}

// Decides which printings count for the real rarity-shift sorting rules.
function isEligibleRarityPrint(print) {
  if (!isPlayablePaperCard(print)) return false;
  if (isSecretLairPrint(print) || isPlayerRewardPrint(print)) return false;
  if (print.booster) return true;
  return print.set_type === "commander";
}

// Turns Scryfall's USD price string into a usable number for case-check math.
function priceValue(print) {
  return Number(print?.prices?.usd || 0);
}

// Filters printings down to the ones that can reasonably trigger a display-case check.
function isCasePricePrint(print) {
  if (!print || print.digital) return false;
  if (isSecretLairPrint(print) || isPlayerRewardPrint(print)) return false;
  if (print.set_type === "promo" || print.set_type === "memorabilia" || print.set_type === "token") return false;
  return Boolean(print.prices?.usd);
}

// Tiny land detector for the "$10 land might be in the case" rule. WORTH REVISITING THIS - Hard & Fast rules for display case cards?
function isLandCard(cardOrPrint) {
  return /\bLand\b/i.test(cardOrPrint?.type_line || "");
}

// Gets the three most recent case-relevant sets so the rules stay current over time. This will hopefully then future proof this thang.
export async function fetchRecentCaseSets(options: ProviderOptions = {}) {
  const result = await fetchJsonWithRetry(SCRYFALL_SETS_URL, {
    headers: { Accept: "application/json;q=0.9,*/*;q=0.8" },
  }, SCRYFALL_MAX_ATTEMPTS, providerContext(options));

  if (!result.ok || !Array.isArray(result.data?.data)) return Object.assign([], { lookupFailed: true });

  const today = new Date();
  today.setHours(23, 59, 59, 999);

  return (result.data.data || [])
    .filter((set) => set && !set.digital)
    .filter((set) => CASE_RELEVANT_SET_TYPES.has(set.set_type))
    .filter((set) => set.released_at && new Date(`${set.released_at}T00:00:00`) <= today)
    .sort((a, b) => new Date(b.released_at).getTime() - new Date(a.released_at).getTime())
    .slice(0, RECENT_CASE_SET_COUNT)
    .map((set, index) => ({ code: set.code, index, name: set.name }));
}

function isCaseStapleCard(item: PullItem) {
  return [item.card?.name, item.mtgjsonCard?.name, item.inputName]
    .filter(Boolean)
    .some((name) => CASE_STAPLE_CARD_NAMES.has(normalizeName(name)));
}

// Figures out whether a card gets CHECK CASE  (or the gentler CASE? nudge.)
function caseNoteForItem(item: PullItem, recentSets: ScryfallSetSummary[]) {
  const prints = item.prints || [];
  if (!prints.length) return "";

  const recentIndexByCode = new Map(recentSets.map((set) => [set.code, set.index]));
  const highRecentPrint = prints.find((print) => {
    const setIndex = recentIndexByCode.get(print.set);
    return setIndex !== undefined
      && setIndex < CHECK_CASE_RECENT_SET_COUNT
      && (print.rarity === "rare" || print.rarity === "mythic")
      && isEligibleRarityPrint(print);
  });

  if (highRecentPrint) return "CHECK CASE";
  if (isCaseStapleCard(item)) return "CASE?";

  const casePricePrints = prints.filter(isCasePricePrint);
  const midRecentPricePrint = casePricePrints.find((print) => {
    const setIndex = recentIndexByCode.get(print.set);
    return setIndex !== undefined
      && setIndex >= CHECK_CASE_RECENT_SET_COUNT
      && setIndex < RECENT_CASE_SET_COUNT
      && priceValue(print) >= 5;
  });

  const highAnyPrint = casePricePrints.find((print) => priceValue(print) >= 50);
  const landCasePrint = casePricePrints.find((print) => isLandCard(print) && priceValue(print) >= 10);

  if (midRecentPricePrint || highAnyPrint || landCasePrint) return "CASE?";
  return "";
}

// Confirms a card has at least one real playable paper printing somewhere because otherwise online-only cards get super obnoxious.
function hasPlayablePaperPrint(prints) {
  return (prints || []).some((print) => isPlayablePaperCard(print));
}

// Walks a card's print history to learn real rarities, special versions, and case-check facts - hopefully all without breakign scryfall
async function fetchPrintFacts(card, context: ProviderOptions) {
  context = providerContext(context);
  let started = false;
  const prints = [];
  const failedFacts = (failure: ProviderFailure) => {
    countPerformance(context.performance, started ? "printHistoryCardsFailed"
      : failure.kind === "circuit-open" || failure.kind === "phase-budget-exhausted" ? "printHistoryCardsSkippedAfterCircuit" : "printHistoryCardsFailed");
    return {
      rarities: [card?.rarity].filter(Boolean), nonSecretRarities: [card?.rarity].filter(Boolean),
      hasFullArt: prints.some((print) => print.full_art) || Boolean(card?.full_art), prints: prints.length ? prints : [card].filter(Boolean),
      eligibleRarityChecked: false, printLookupFailed: true, providerFailure: failure, historyProcessingStarted: started,
    };
  };
  const structuralFailure = (kind: ProviderFailure["kind"]): ProviderFailure => ({ kind, retryable: false, operation: "scryfallPrintPages", attemptCount: 0 });
  if (!safeScryfallUrl(card?.prints_search_uri)) {
    return failedFacts(providerCircuitFailure(context.providerRun) || structuralFailure("invalid-response"));
  }

  let nextUrl = card.prints_search_uri;
  const visited = new Set<string>();

  while (nextUrl) {
    if (typeof nextUrl !== "string" || visited.has(nextUrl) || visited.size >= 100) {
      for (const url of visited) evictScryfallResponse(url);
      const failure = structuralFailure(visited.size >= 100 ? "pagination-limit" : "pagination-loop");
      recordProviderFailure(context.providerRun!, failure);
      return failedFacts(failure);
    }
    visited.add(nextUrl);
    const result = await fetchJsonWithRetry(nextUrl, {
      headers: { Accept: "application/json;q=0.9,*/*;q=0.8" },
    }, SCRYFALL_MAX_ATTEMPTS, { ...context, requestType: "scryfallPrintPages" });

    if (!started && (result.ok || (result.failure?.attemptCount || 0) > 0)) {
      started = true;
      countPerformance(context.performance, "printHistoryCardsStarted");
    }
    if (!result.ok) return failedFacts(result.failure || structuralFailure("invalid-response"));

    const data = result.data;
    prints.push(...(data.data || []));
    nextUrl = data.has_more ? data.next_page : "";
  }

  const usablePrints = prints.filter((print) => Array.isArray(print.games) && Boolean(parseRarity(print.rarity)));
  if (!usablePrints.length) {
    for (const url of visited) evictScryfallResponse(url);
    const failure = structuralFailure("invalid-response");
    recordProviderFailure(context.providerRun!, failure);
    return failedFacts(failure);
  }
  const eligibleRarityPrints = usablePrints.filter(isEligibleRarityPrint);
  const rarityPrints = eligibleRarityPrints.length
    ? eligibleRarityPrints
    : usablePrints.filter((print) => isPlayablePaperCard(print) && !isSecretLairPrint(print) && !isPlayerRewardPrint(print) && print.set_type !== "promo");

  countPerformance(context.performance, "printHistoryCardsCompleted");
  return {
    rarities: Array.from(new Set(usablePrints.map((print) => print.rarity).filter(Boolean))),
    nonSecretRarities: Array.from(new Set(rarityPrints.map((print) => print.rarity).filter(Boolean))),
    hasFullArt: usablePrints.some((print) => print.full_art),
    prints: usablePrints,
    eligibleRarityChecked: true,
    historyProcessingStarted: started,
    rarityEvidence: "scryfall",
    printLookupFailed: false,
    providerFailure: undefined,
  };
}

// Matches Scryfall collection results back onto the original parsed items.
function mergeResolvedCards(batch, result) {
  const byName = new Map();
  (result.data || []).forEach((card) => {
    byName.set(normalizeName(card.name), card);
  });

  return batch.map((item) => {
    if (item.presetStatus === "review") {
      return { ...item, status: "review" };
    }

    const card = byName.get(normalizeName(item.mtgjsonExactName || item.inputName));
    if (item.legacyIndexCompatibility) {
      const verified = card && isPlayablePaperCard(card) && item.legacyRarities?.length;
      return {
        ...item,
        // Keep the exact canonical MTGJSON identity and its lower-confidence history.
        card: card ? { ...card, name: item.mtgjsonExactName || item.card.name } : item.card,
        status: verified ? "found" : "review",
        paperIdentityVerified: Boolean(card && isPlayablePaperCard(card)),
        rarityEvidence: "legacy-index",
        lessVerified: true,
        note: verified
          ? "Paper identity verified; grouping uses legacy index rarity history."
          : card && !isPlayablePaperCard(card)
            ? "Not a playable paper card; card-name index requires refresh."
            : "Card-name index requires refresh; compatibility verification incomplete.",
      };
    }
    if (card) {
      return {
        ...item,
        card,
        status: "found",
        isBasicLand: BASIC_LAND_NAMES.has(card.name),
        correction: card.name !== item.inputName,
      };
    }
    return { ...item, status: "missing" };
  });
}

// Attaches a known Scryfall card to one parsed request... hopefully.
function resolveItemWithCard(item, card) {
  return {
    ...item,
    card,
    status: "found",
    isBasicLand: BASIC_LAND_NAMES.has(card.name),
    correction: normalizeName(card.name) !== normalizeName(item.inputName),
  };
}

// A failed collection never fans out. Only a successful collection's true misses
// may enter named recovery; request-level retries are authoritative.
async function resolveExactBatch(batch, batchNumber, setMessage, context: ProviderOptions) {
  setMessage(`Exact lookup batch ${batchNumber}...`);
  const result = await fetchCollection(batch, context);
  if (result.ok) return mergeResolvedCards(batch, result.data);
  return batch.map((item) => ({
    ...item,
    status: "review",
    providerFailure: result.failure,
    lessVerified: true,
    note: item.legacyIndexCompatibility
      ? "Card-name index requires refresh; compatibility verification unavailable. Reprocess Needs Review later."
      : "Scryfall verification unavailable. Reprocess Needs Review later.",
  }));
}

// Chooses the output section: high rarity/low rarity (or rarity-shifted chaos because WotC)
function rarityBucket(item) {
  const eligiblePrintRarities = item.nonSecretRarities?.length
    ? item.nonSecretRarities
    : item.eligibleRarityChecked
      ? []
      : [item.card?.rarity].filter(Boolean);
  const compatibleStatedRarities = (item.statedRarities || []).filter((rarity) => eligiblePrintRarities.includes(rarity));
  const printRarities = compatibleStatedRarities.length ? compatibleStatedRarities : eligiblePrintRarities;
  const rarities = new Set([
    ...printRarities,
  ].filter(Boolean));
  const hasHigh = rarities.has("rare") || rarities.has("mythic");
  const hasLow = rarities.has("common") || rarities.has("uncommon");

  if (hasHigh && hasLow) return "both";
  if (hasHigh) return "high";
  return "low";
}

// Use provider spelling when resolved; otherwise preserve the customer's name.
function displayName(item) {
  return item.card?.name || item.inputName;
}

// Adds the requested reskin name in parentheses after the real card name. So far this is working fine, but I do have concerns with it & scryfall's output
function alternateTitleNote(item) {
  return item.alternateTitle ? ` (${item.alternateTitle})` : "";
}

// Adds token stats/keywords after the token name. POTENTIALLY REFACTORABLE OR COMBINABLE WITH OTHER FUNCTIONS
function tokenDetailsNote(item) {
  return item.tokenDetails?.length ? ` (${item.tokenDetails.join(", ")})` : "";
}

// Alphabetizes cards in a nice case-insensitive way.
function sortByName(a, b) {
  return displayName(a).localeCompare(displayName(b), undefined, { sensitivity: "base" });
}

// Sorts basics in WUBRG order instead of alphabet soup.
function sortBasicLands(a, b) {
  return BASIC_LAND_ORDER.indexOf(displayName(a)) - BASIC_LAND_ORDER.indexOf(displayName(b));
}

// Gives interactive tools the exact same card order as the receipt output.
export function sortItemsForOutput(items) {
  const found = items.filter((item) => item.status === "found");
  const needsReview = items.filter((item) => item.status !== "found").sort(sortByName);
  const tokens = found.filter((item) => item.isToken).sort(sortByName);
  const basics = found.filter((item) => item.isBasicLand).sort(sortBasicLands);
  const nonBasics = found.filter((item) => !item.isBasicLand && !item.isToken);
  const high = nonBasics.filter((item) => rarityBucket(item) === "high").sort(sortByName);
  const both = nonBasics.filter((item) => rarityBucket(item) === "both").sort(sortByName);
  const low = nonBasics.filter((item) => rarityBucket(item) === "low").sort(sortByName);
  return [...high, ...both, ...low, ...tokens, ...basics, ...needsReview];
}

export function outputDisplayName(item) {
  return displayName(item);
}

// Builds one printable output line with quantity, notes, case tags, and optional checkbox.
function formatCardLine(item, useCheckboxes) {
  const specialNote = specialRequestNote(item);
  const caseNote = item.caseNote ? ` - ${item.caseNote}` : "";
  const reviewNote = item.status !== "found" && item.note ? ` (${item.note})` : "";
  return `${useCheckboxes ? "[ ] " : ""}${item.quantity} ${displayName(item)}${alternateTitleNote(item)}${tokenDetailsNote(item)}${specialNote}${caseNote}${reviewNote}`;
}

// Formats contact info -  right now Facebook gets parentheses, phone/email do not.
function formatContactLine(customer) {
  const normalized = customerContactText(customer);
  if (!normalized) return "";
  if (/^facebook$/i.test(normalized)) return "(Facebook)";
  return normalized;
}

// Capitalizes customer names while respecting hyphens and apostrophes.
function formatCustomerName(name) {
  return name
    .trim()
    .split(/\s+/)
    .map((word) => word
      .toLowerCase()
      .replace(/(^|[-'])([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`))
    .join(" ");
}

// Makes the printed timestamp readable for the receipt/printer workflow.
function formatTimestamp(value) {
  const date = value ? new Date(value) : new Date();
  return new Intl.DateTimeFormat(undefined, {
    timeZone: "America/Chicago",
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

// Spots a likely customer name accidentally parsed as the first/last card line.
function isBoundaryNameCandidate(item, cardLineCount) {
  if (!item || item.status === "found") return false;
  if (item.card || item.lookupSource || item.mtgjsonCard) return false;
  if (item.quantity !== 1 || item.statedRarities?.length || item.specialRequests?.length) return false;
  if (item.index > 1 && item.index < cardLineCount - 2) return false;

  const words = item.inputName.trim().split(/\s+/);
  if (words.length < 2 || words.length > 5) return false;
  if (/\d|@|[!?]/.test(item.inputName)) return false;
  return words.every((word) => /^[A-Za-z.'-]+$/.test(word));
}

// Helps combine two loose name fragments like first-name / last-name lines.
function isBoundaryNameFragment(item, expectedIndex) {
  if (!item || item.status === "found" || item.index !== expectedIndex) return false;
  if (item.card || item.lookupSource || item.mtgjsonCard) return false;
  if (item.quantity !== 1 || item.statedRarities?.length || item.specialRequests?.length) return false;
  if (/\d|@|[!?]/.test(item.inputName)) return false;
  return /^[A-Za-z.'-]+$/.test(item.inputName.trim());
}

// Rescues customer names from the edges of the card list when no contact header was obvious (REVIST THIS - BREAKS SOMETIMES)
export function inferBoundaryCustomer(customer, items, cardLineCount) {
  if (customer.name) return { customer, items };
  if (!items.some((item) => item.status === "found")) return { customer, items };

  const candidate = items.find((item) => isBoundaryNameCandidate(item, cardLineCount));
  if (candidate) {
    return {
      customer: { ...customer, name: candidate.inputName },
      items: items.filter((item) => item !== candidate),
    };
  }

  const firstName = items.find((item) => isBoundaryNameFragment(item, 0));
  const firstLast = items.find((item) => isBoundaryNameFragment(item, 1));
  if (firstName && firstLast) {
    return {
      customer: { ...customer, name: `${firstName.inputName} ${firstLast.inputName}` },
      items: items.filter((item) => item !== firstName && item !== firstLast),
    };
  }

  const lastName = items.find((item) => isBoundaryNameFragment(item, cardLineCount - 2));
  const lastLast = items.find((item) => isBoundaryNameFragment(item, cardLineCount - 1));
  if (lastName && lastLast) {
    return {
      customer: { ...customer, name: `${lastName.inputName} ${lastLast.inputName}` },
      items: items.filter((item) => item !== lastName && item !== lastLast),
    };
  }

  return { customer, items };
}

// Assembles the receipt-ready final text, including also now some blank header/footer breathing room.
export function formatOutput(customer, items, useCheckboxes, processedAt) {
  const found = items.filter((item) => item.status === "found");
  const needsReview = items.filter((item) => item.status !== "found");
  const tokens = found.filter((item) => item.isToken).sort(sortByName);
  const basics = found.filter((item) => item.isBasicLand).sort(sortBasicLands);
  const nonBasics = found.filter((item) => !item.isBasicLand && !item.isToken);
  const high = nonBasics.filter((item) => rarityBucket(item) === "high").sort(sortByName);
  const both = nonBasics.filter((item) => rarityBucket(item) === "both").sort(sortByName);
  const low = nonBasics.filter((item) => rarityBucket(item) === "low").sort(sortByName);
  const lines = [BUFFER_MARKER, "", "", ""];

  if (customer.name) {
    lines.push(formatCustomerName(customer.name));
  } else {
    lines.push("NAME:");
    lines.push("");
  }

  if (customerContactText(customer)) {
    lines.push(formatContactLine(customer));
  } else {
    lines.push("CONTACT:");
    lines.push("");
  }

  lines.push(`Printed: ${formatTimestamp(processedAt)}`);
  lines.push("");

  if (high.length) {
    lines.push("=== Mythic/Rare ===");
    high.forEach((item) => lines.push(formatCardLine(item, useCheckboxes)));
  }

  if (both.length) {
    if (lines.at(-1) !== "") lines.push("");
    lines.push("=== Rarity Shifted ===");
    both.forEach((item) => lines.push(formatCardLine(item, useCheckboxes)));
  }

  if (low.length) {
    if (lines.at(-1) !== "") lines.push("");
    lines.push("=== Uncommon/Common ===");
    low.forEach((item) => lines.push(formatCardLine(item, useCheckboxes)));
  }

  if (tokens.length) {
    if (lines.at(-1) !== "") lines.push("");
    lines.push("=== Tokens ===");
    tokens.forEach((item) => lines.push(formatCardLine(item, useCheckboxes)));
  }

  if (basics.length) {
    if (lines.at(-1) !== "") lines.push("");
    lines.push("=== Basic Lands ===");
    basics.forEach((item) => lines.push(formatCardLine(item, useCheckboxes)));
  }

  if (needsReview.length) {
    if (lines.at(-1) !== "") lines.push("");
    lines.push("=== NEEDS REVIEW ===");
    needsReview.sort(sortByName).forEach((item) => lines.push(formatCardLine(item, useCheckboxes)));
  }

  lines.push("", "", "", "", "", BUFFER_MARKER);
  return lines.join("\n");
}

// Makes a friendly .txt filename from the customer's name and the day it was processed.
export function safeFileName(customer, processedAtValue) {
  const base = customer.name ? formatCustomerName(customer.name) : "pull-list";
  const date = processedAtValue ? new Date(processedAtValue) : new Date();
  const datePart = [
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    String(date.getFullYear()).slice(-2),
  ].join("-");
  const namePart = base.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "pull-list";
  return `${namePart}-${datePart}.txt`;
}

// Adds print-history facts to one found card; tokens and basics get the express lane.
async function enrichResolvedItem(item, caseCheck, recentCaseSets, providerOptions: ProviderOptions = {}) {
  if (item.status !== "found") return item;

  if (item.isToken) {
    return {
      ...item,
      rarities: ["common"],
      nonSecretRarities: ["common"],
      hasFullArt: false,
      specialRequestFound: !hasSpecialPrintRequest(item),
      caseNote: "",
      alternateTitle: "",
      tokenDetails: item.tokenDetails || [],
      tokenColors: item.tokenColors || [],
      printLookupFailed: false,
    };
  }

  if (item.isBasicLand && !hasSpecialPrintRequest(item)) {
    return {
      ...item,
      rarities: ["common"],
      nonSecretRarities: ["common"],
      hasFullArt: Boolean(item.card?.full_art),
      specialRequestFound: !hasSpecialPrintRequest(item),
      caseNote: "",
      alternateTitle: "",
    };
  }

  const decision = requiresScryfallEnrichment(item, providerOptions);
  if (!decision.required && !item.prints?.length) {
    return { ...item, caseNote: caseCheck ? caseNoteForItem(item, recentCaseSets) : "" };
  }

  if (decision.required && providerOptions.useScryfall === false) {
    if (!item.localRarityVerified || hasSpecialPrintRequest(item) || caseCheck) {
      return {
        ...item,
        status: "review",
        note: item.note || "Scryfall disabled; paper rarity or requested printing not verified",
      };
    }

    return {
      ...item,
      caseNote: "",
      alternateTitle: "",
      lessVerified: true,
    };
  }

  let itemForFacts = item;
  if (decision.required && !item.card?.prints_search_uri) {
    const exactResult = await fetchNamedCardResult(item.card?.name || item.inputName, "exact", providerOptions);
    if (exactResult.ok) {
      itemForFacts = {
        ...resolveItemWithCard(item, exactResult.data),
        lookupSource: "mtgjson+scryfall",
        mtgjsonCard: item.mtgjsonCard,
      };
    } else {
      if (exactResult.failure?.attemptCount === 0
        && ["circuit-open", "phase-budget-exhausted"].includes(exactResult.failure.kind)) {
        countPerformance(providerOptions.performance, "printHistoryCardsSkippedAfterCircuit");
      }
      return {
        ...item,
        printLookupFailed: true,
        providerFailure: exactResult.failure,
      };
    }
  }

  const facts = decision.required ? await fetchPrintFacts(itemForFacts.card, providerOptions) : itemForFacts;
  const enrichedItem = { ...itemForFacts, ...facts };
  const notPlayablePaper = !facts.printLookupFailed && !hasPlayablePaperPrint(facts.prints);
  const specialRequestMissing = hasSpecialPrintRequest(item)
    && !facts.printLookupFailed
    && !facts.prints?.some((print) => printMatchesSpecialRequests(print, item));
  const ambiguousNonPlayable = notPlayablePaper && providerOptions.useScryfall !== false && await hasAmbiguousPlayableName(item.inputName, providerOptions);

  return {
    ...enrichedItem,
    status: specialRequestMissing || notPlayablePaper ? "review" : item.status,
    caseNote: caseCheck ? caseNoteForItem(enrichedItem, recentCaseSets) : "",
    alternateTitle: requestedFlavorName(item, facts.prints),
    note: specialRequestMissing
      ? specialRequestReviewNote(item)
      : notPlayablePaper
          ? ambiguousNonPlayable ? "Ambiguous card name" : "Not a playable paper card"
          : itemForFacts.note,
  };
}

// Isolate unexpected item errors without restarting a complete card lookup.
async function safelyEnrichResolvedItem(item, caseCheck, recentCaseSets, providerOptions: ProviderOptions) {
  try { return await enrichResolvedItem(item, caseCheck, recentCaseSets, providerOptions); }
  catch (error) {
    throwIfAborted(providerOptions.signal);
    if (error?.name === "AbortError") throw error;
    const failure: ProviderFailure = { kind: "invalid-response", retryable: false, operation: "scryfallPrintPages", attemptCount: 0 };
    if (providerOptions.providerRun) recordProviderFailure(providerOptions.providerRun, failure);
    return { ...item, printLookupFailed: true, enrichmentFailed: true, providerFailure: failure };
  }
}

// Resolves parsed names through MTGJSON exact matches, then Scryfall exact/fuzzy cleanup when enabled.
export async function resolveCardNames(items, setMessage, carefulMode, providerOptions: ProviderOptions = {}) {
  providerOptions = providerContext(providerOptions, carefulMode);
  throwIfAborted(providerOptions.signal);
  const report = providerOptions.performance;
  const useMtgjson = providerOptions.useMtgjson !== false;
  const useScryfall = providerOptions.useScryfall !== false;
  // Employee-requested reprocessing must not inherit previous failures or stale
  // printing evidence. The new index/provider run establishes confidence again.
  items = items.map((item) => item.status === "missing" ? {
    ...item, providerFailure: undefined, printLookupFailed: false, enrichmentFailed: false,
    bulkMissGuarded: false,
    printHistoryRetried: false, paperIdentityVerified: false, localPaperVerified: false,
    localRarityVerified: false, legacyIndexCompatibility: false, legacyRarities: undefined,
    rarityEvidence: undefined, prints: undefined, eligibleRarityChecked: false,
  } : item);
  // Ordinary named basics need neither an index download nor provider lookup.
  items = items.map((item) => BASIC_LAND_NAMES.has(item.inputName) && !hasSpecialPrintRequest(item)
    ? { ...item, status: "found", isBasicLand: true, card: { name: item.inputName, rarity: "common" } }
    : item);
  const firstPass = items.filter((item) => item.status === "found" || item.status === "review");
  let lookupItems = items.filter((item) => item.status !== "found" && item.status !== "review");
  const order = new Map(items.map((item, index) => [item.index, index]));
  const ordered = (values) => values.sort((a, b) => Number(order.get(a.index)) - Number(order.get(b.index)));

  if (useMtgjson && lookupItems.length) {
    try {
      const mtgjsonResolved = await resolveExactWithMtgjson(lookupItems, setMessage, {
        ...providerOptions,
        useScryfall,
      });
      firstPass.push(...mtgjsonResolved.resolved);
      lookupItems = mtgjsonResolved.missing;
    } catch (error) {
      throwIfAborted(providerOptions.signal);
      if (error?.name === "AbortError") throw error;
      setMessage(`MTGJSON index unavailable; ${useScryfall ? "falling back to Scryfall" : "unable to verify exact names"}.`);
      if (!useScryfall) {
        firstPass.push(...lookupItems.map((item) => ({
          ...item,
          status: "review",
          note: "MTGJSON unavailable and Scryfall disabled",
        })));
        lookupItems = [];
      }
    }
  }

  for (const item of [...firstPass, ...lookupItems]) {
    const decision = requiresScryfallEnrichment(item, providerOptions);
    countPerformance(report, decision.required && useScryfall ? "remoteCards" : "skippedCards");
    if (decision.required && useScryfall) countPerformance(report, "logicalRemoteCards");
    if (report) report.reasons[decision.reason] = (report.reasons[decision.reason] || 0) + 1;
  }

  if (!useScryfall) {
    firstPass.push(...lookupItems.map((item) => ({
      ...item,
      status: "review",
      note: item.note || "No MTGJSON exact match; Scryfall disabled",
    })));
    return ordered(firstPass);
  }

  const exactBatches = chunk(lookupItems, BATCH_SIZE);
  const exactStarted = processingNow();
  if (report && exactBatches.length) report.stage = "scryfall-exact";

  for (const [batchIndex, batch] of exactBatches.entries()) {
    firstPass.push(...await resolveExactBatch(batch, batchIndex + 1, setMessage, providerOptions));
  }
  if (report) report.stages.scryfallExactBatch += processingNow() - exactStarted;

  const fuzzyResolved = [];
  const fuzzyStarted = processingNow();
  for (const item of firstPass) {
    if (item.status === "found" || item.status === "review") {
      fuzzyResolved.push(item);
      continue;
    }

    setMessage(`Trying fuzzy match for "${item.inputName}"...`);
    if (report) report.stage = "scryfall-fuzzy";
    const fuzzyResult = await fetchNamedCardResult(item.inputName, "fuzzy", providerOptions);
    const card = fuzzyResult.ok ? fuzzyResult.data : null;
    const ambiguous = card && await isAmbiguousFuzzyMatch(item.inputName, card, providerOptions);
    fuzzyResolved.push(
      card && !ambiguous
        ? resolveItemWithCard(item, card)
        : {
          ...item,
          status: "review",
          providerFailure: fuzzyResult.failure,
          note: ambiguous
            ? "Ambiguous card name"
            : item.note
              ? item.note.includes("not a playable paper card")
                ? "Not a playable paper card"
                : fuzzyResult.status && fuzzyResult.status !== 404
                  ? `${item.note}; fuzzy lookup failed (${fuzzyResult.status})`
                  : `${item.note}; no fuzzy Scryfall match`
              : fuzzyResult.status && fuzzyResult.status !== 404
                ? `Fuzzy lookup failed (${fuzzyResult.status})`
                : "No Scryfall match",
        },
    );
  }
  if (report) report.stages.scryfallFuzzy += processingNow() - fuzzyStarted;
  return ordered(fuzzyResolved);
}

// Walks only selective histories once. Staff can explicitly reprocess review items.
export async function enrichPrintHistories(items, caseCheck, recentCaseSets, setMessage, carefulMode, providerOptions: ProviderOptions = {}) {
  providerOptions = providerContext(providerOptions, carefulMode);
  providerOptions = { ...providerOptions, enrichmentPurpose: caseCheck ? "case-check" : providerOptions.enrichmentPurpose || "formatter" };
  throwIfAborted(providerOptions.signal);
  const started = processingNow();
  const report = providerOptions.performance;
  if (report) report.stage = "print-history";
  let withRarities = [...items];
  const concurrency = carefulMode ? 1 : PRINT_FACT_CONCURRENCY;
  const remote = [];
  for (const [index, item] of items.entries()) {
    if (providerOptions.useScryfall !== false && requiresScryfallEnrichment(item, providerOptions).required) {
      remote.push({ item, index });
    } else {
      withRarities[index] = await safelyEnrichResolvedItem(item, caseCheck, recentCaseSets, providerOptions);
    }
  }
  const printGroups = chunk(remote, concurrency);

  for (const [groupIndex, group] of printGroups.entries()) {
    const starting = groupIndex * concurrency + 1;
    const ending = starting + group.length - 1;
    setMessage(`Verifying Scryfall exceptions ${starting}-${ending} of ${remote.length}...`);
    await Promise.all(group.map(async ({ item, index }) => {
      withRarities[index] = await safelyEnrichResolvedItem(item, caseCheck, recentCaseSets, providerOptions);
    }));
  }

  if (report) report.stages.printHistory += processingNow() - started;
  return withRarities.map((item) => ((item.printLookupFailed
    && (!item.localRarityVerified || hasSpecialPrintRequest(item) || item.requestedFlavor || item.enrichmentFailed || caseCheck))
    || (caseCheck && recentCaseSets.lookupFailed && !item.isBasicLand && !item.isToken))
    ? { ...item, status: "review", note: item.note || "Paper rarity or requested printing not verified; retry needed" }
    : item);
}

export function reliabilityMessage(items, options: ProviderOptions = {}) {
  const notes = [];
  const fallbackCount = items.filter((item) => item.status === "found" && item.printLookupFailed).length;

  if (options.useScryfall === false) notes.push("Scryfall off: output is less verified.");
  if (items.some((item) => item.legacyIndexCompatibility)) notes.push("Card-name index is outdated. Using compatibility verification.");
  if (items.some((item) => item.status === "found" && item.rarityEvidence === "legacy-index")) notes.push("Paper identities verified; rarity grouping uses lower-confidence legacy index evidence.");
  if (options.performance?.providerCircuitState === "open") notes.push("Scryfall verification stopped after repeated failures. Affected cards were placed in Needs Review.");
  if (fallbackCount) notes.push(`${fallbackCount} card${fallbackCount === 1 ? "" : "s"} used fallback rarity.`);
  return notes.join(" ");
}

/** Keeps only resolved formatter identity/intent needed to start fresh pricing. */
export function compactFormatterItems(items: any[]) {
  return items.map((item) => ({
    index: item.index,
    quantity: item.quantity,
    inputName: item.inputName,
    status: item.status,
    isBasicLand: Boolean(item.isBasicLand),
    isToken: Boolean(item.isToken),
    alternateTitle: item.alternateTitle || "",
    requestedDisplayName: item.requestedDisplayName || "",
    requestedPrinting: item.requestedPrinting || undefined,
    statedRarities: Array.isArray(item.statedRarities) ? item.statedRarities : [],
    specialRequests: Array.isArray(item.specialRequests) ? item.specialRequests : [],
    nonSecretRarities: Array.isArray(item.nonSecretRarities) ? item.nonSecretRarities : [],
    eligibleRarityChecked: Boolean(item.eligibleRarityChecked),
    tokenDetails: Array.isArray(item.tokenDetails) ? item.tokenDetails : [],
    caseNote: item.caseNote || "",
    note: item.note || "",
    printLookupFailed: Boolean(item.printLookupFailed),
    rarityEvidence: ["current-index", "legacy-index", "scryfall"].includes(item.rarityEvidence) ? item.rarityEvidence : undefined,
    legacyIndexCompatibility: Boolean(item.legacyIndexCompatibility),
    paperIdentityVerified: Boolean(item.paperIdentityVerified),
    lessVerified: Boolean(item.lessVerified),
    card: item.card?.name ? { name: item.card.name } : undefined,
    mtgjsonCard: item.mtgjsonCard?.name ? { name: item.mtgjsonCard.name } : undefined,
  }));
}

export async function processPullListText(text: string, options: ProcessPullListOptions = {}) {
  const {
    useCheckboxes = true,
    caseCheck = false,
    carefulMode = false,
    useMtgjson = true,
    useScryfall = true,
    mtgjsonManifestUrl = "",
    processedAt = new Date().toISOString(),
    setMessage = () => {},
  } = options;
  const performance = createProcessingPerformance();
  const parseStarted = processingNow();
  const parsed = parsePullList(text);
  recordParsingPerformance(performance, parsed.diagnostics);
  performance.stages.parse = processingNow() - parseStarted;
  const providerOptions: ProviderOptions = { useMtgjson, useScryfall, mtgjsonManifestUrl, enrichmentPurpose: caseCheck ? "case-check" : "formatter", signal: options.signal || null, performance, minIntervalMs: carefulMode ? 500 : 120 };

  try {
    const fuzzyResolved = await resolveCardNames(parsed.cards, setMessage, carefulMode, providerOptions);
    let recentCaseSets = [];
    if (caseCheck && useScryfall) {
      setMessage("Checking recent set list for case rules...");
      performance.stage = "case-sets";
      const setsStarted = processingNow();
      recentCaseSets = await fetchRecentCaseSets(providerOptions);
      performance.stages.caseSets = processingNow() - setsStarted;
    }

    const withRarities = await enrichPrintHistories(fuzzyResolved, caseCheck && useScryfall, recentCaseSets, setMessage, carefulMode, providerOptions);
    const inferred = inferBoundaryCustomer(parsed.customer, withRarities, parsed.cardLineCount);

    const output = formatOutput(inferred.customer, inferred.items, useCheckboxes, processedAt);
    performance.stage = "ready";
    return {
      parsed,
      customer: inferred.customer,
      items: inferred.items,
      processedAt,
      output,
      performance: finishProcessingPerformance(performance),
      reliabilityNote: reliabilityMessage(inferred.items, providerOptions),
    };
  } catch (error) {
    finishProcessingPerformance(performance, error?.name === "AbortError" ? "canceled" : "failed");
    throw error;
  }
}


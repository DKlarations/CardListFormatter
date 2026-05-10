const SCRYFALL_COLLECTION_URL = "https://api.scryfall.com/cards/collection";
const SCRYFALL_NAMED_URL = "https://api.scryfall.com/cards/named";
const SCRYFALL_SEARCH_URL = "https://api.scryfall.com/cards/search";
const SCRYFALL_SETS_URL = "https://api.scryfall.com/sets";
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

type Customer = {
  name: string;
  contact: string;
};

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
  error?: unknown;
};

type LabeledPattern = readonly [string, RegExp];

type ProcessPullListOptions = {
  useCheckboxes?: boolean;
  caseCheck?: boolean;
  carefulMode?: boolean;
  processedAt?: string;
  setMessage?: (message: string) => void;
};

const SAMPLE_CUSTOMER_NAMES = [
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
];

const sampleCardList = `1 Chub Toad - G unc
Storm crow
Psychatog r
One With Nothing U
3x cheatyface foil
1 goblin game-rare
Squire
raph's jitte
4x Lightningbolt
liliana
4x Godless Shrine land
Yargle gluttin of urborg
sol ring :-)`;

// Picks a random Magic design/dev name so the sample list gets a tiny shuffle on reload.
function randomSampleCustomerName() {
  return SAMPLE_CUSTOMER_NAMES[Math.floor(Math.random() * SAMPLE_CUSTOMER_NAMES.length)];
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
}

export function endScryfallRun() {
  activeScryfallSignal = null;
  activeScryfallMinIntervalMs = SCRYFALL_MIN_INTERVAL_MS;
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

// Gives unmatched names a readable title-case glow-up when Scryfall cannot bless us with the official name.
function titleCaseFallback(value) {
  const smallWords = new Set(["a", "an", "and", "at", "by", "for", "in", "of", "or", "the", "to"]);
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index > 0 && smallWords.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

// Tiny pause helper for being polite to APIs and letting retry loops breathe so we can maybe stop breaking Scryfall so dang much :-)
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Keeps Scryfall requests spaced out so we do not hammer the good card oracle.
async function waitForScryfallSlot() {
  const previousGate = scryfallRequestGate;
  let releaseGate;
  scryfallRequestGate = new Promise((resolve) => {
    releaseGate = resolve;
  });

  await previousGate;
  const elapsed = Date.now() - lastScryfallRequestAt;
  if (elapsed < activeScryfallMinIntervalMs) {
    await sleep(activeScryfallMinIntervalMs - elapsed);
  }
  lastScryfallRequestAt = Date.now();
  releaseGate();
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
function throwIfAborted() {
  if (activeScryfallSignal?.aborted) {
    throw new DOMException("Processing canceled.", "AbortError");
  }
}

// Normalizes phone numbers into receipt-friendly 555-555-5555 format.
function formatPhoneNumber(value) {
  const digits = value.replace(/\D/g, "");
  const tenDigits = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (tenDigits.length !== 10) return value.trim();
  return `${tenDigits.slice(0, 3)}-${tenDigits.slice(3, 6)}-${tenDigits.slice(6)}`;
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

function splitNameAndContact(value, extraContact = "") {
  const email = value.match(EMAIL_PATTERN)?.[0] || "";
  const phone = value.match(PHONE_PATTERN)?.[0] || "";
  const facebook = /\bfacebook\b|\bfb\b/i.test(value) ? "facebook" : "";
  const contact = mergeContactValues(phone, email, facebook, extraContact);
  const name = [phone, email].reduce(
    (current, part) => part ? current.replace(part, "") : current,
    value,
  ).replace(/\bfacebook\b|\bfb\b/i, "").replace(/\s+/g, " ").trim();

  return { name: cleanCustomerName(name), contact };
}

// Pulls a customer name/contact out of header-ish lines, emails, phones, and Facebook mentions.
function extractContact(line) {
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
  if (/^(hello|hi|hey|thanks|thank you|just one of each|i will|i'm|im|these are|please|mtg pull list from|mtg pull list for)\b/i.test(line)) {
    return true;
  }
  return /[!?]$/.test(line) && normalized.split(" ").length > 4;
}

// Checks whether a line smells like customer info instead of expensive cardboard.
function hasContactOrHeader(line) {
  return EMAIL_PATTERN.test(line)
    || PHONE_PATTERN.test(line)
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
    .map((line) => line.trim())
    .filter(Boolean);

  const customer = { name: "", contact: "" };
  const emailHeaderContact = { name: "", contact: "" };
  const cardLines = [];

  for (const line of lines) {
    if (isSeparatorLine(line) || STORE_EMAIL_PATTERN.test(line)) continue;

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

    if (isLikelyNoteLine(line)) continue;
    cardLines.push(line);
  }

  customer.name = customer.name || emailHeaderContact.name;
  customer.contact = mergeContactValues(customer.contact, emailHeaderContact.contact);

  return { customer, cardLines };
}

// Converts shorthand like R, UC, and mythic into the rarity words the sorter expects.
function parseRarity(value) {
  const normalized = normalizeName(value);
  if (normalized === "m" || normalized === "mr" || normalized === "mythic" || normalized === "mythic rare") return "mythic";
  if (normalized === "r" || normalized === "rare") return "rare";
  if (normalized === "u" || normalized === "uc" || normalized === "unc" || normalized === "uncommon") return "uncommon";
  if (normalized === "c" || normalized === "com" || normalized === "common") return "common";
  return "";
}

// Handles rarity combos like "C / R" without making everyone sad.
function parseRarities(value) {
  return value
    .split(/[,/]+|\band\b/i)
    .map((part) => parseRarity(part.trim()))
    .filter(Boolean);
}

// Builds the regex chunk for rarity labels that may appear after card names. Hopefully this uncompasses all the options, but stuff could break it.
function rarityPattern() {
  return "(?:mythic rare|mythic|rare|uncommon|common|mr|unc|com|uc|m|r|u|c)";
}

// Catches lonely quantity cells from copied spreadsheet/table paste.
function isQuantityOnlyLine(line) {
  return /^\d+\s*x?$/i.test(line.trim());
}

// Tosses table headers like Qty, Card Name, and Rarity into the bin.
function isTableHeaderLine(line) {
  return ["qty", "quantity", "card name", "card", "rarity"].includes(normalizeName(line));
}

// Catches rarity cells that got pasted on their own line.
function isStandaloneRarityLine(line) {
  return Boolean(parseRarity(line));
}

// Reassembles messy copied tables back into "qty card rarity" lines. This is worth a review if shit gets weird - we've had a few copy-pasted tables into teams and this should hopefully resolve it.
function normalizeCopiedTableLines(lines) {
  const normalized = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (isTableHeaderLine(line)) continue;

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

// Decides whether a trailing chunk is metadata, not part of a hyphenated card name.
function isDescriptor(part) {
  const normalized = normalizeName(part);
  if (parseRarities(normalized).length) return true;
  if (SPECIAL_REQUEST_PATTERNS.some(({ pattern }) => pattern.test(part))) return true;
  if (CARD_HINTS.has(normalized)) return true;
  if (/^[wubrg]$/i.test(part)) return true;
  if (/^(white|blue|black|red|green|colorless)(\/(white|blue|black|red|green|colorless))*$/i.test(part)) return true;
  return false;
}

// Collects asks like FOIL, FULL ART, BORDERLESS, and other picky-printing business.
function extractSpecialRequests(value) {
  return SPECIAL_REQUEST_PATTERNS
    .filter(({ pattern }) => pattern.test(value))
    .map(({ label }) => label);
}

// Removes special-printing words from the lookup name while keeping them for the final note.
function stripSpecialRequests(value) {
  return SPECIAL_REQUEST_PATTERNS.reduce(
    (current, { pattern }) => current.replace(pattern, ""),
    value,
  );
}

// Tidies punctuation and pasted list leftovers before we ask Scryfall what this thing is.
function cleanCardName(value) {
  return value
    .replace(/[•*]/g, "")
    .replace(/\([^)]*\)\s*\d*$/g, "")
    .replace(/\[[^\]]+\]\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Produces the Scryfall lookup name after special requests have been safely peeled off.
function cleanLookupName(value) {
  return cleanCardName(stripSpecialRequests(value));
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

// Checks whether an item needs a specific printing style beyond plain old nonfoil.
function hasSpecialPrintRequest(item) {
  return (item.specialRequests || []).some((request) => request !== "NONFOIL");
}

// Tests whether a specific Scryfall printing satisfies the customer's fancy-version request.
function printMatchesSpecialRequests(print, item) {
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
    if (request === "RETRO FRAME") return print.frame_effects?.includes("retro") || print.promo_types?.includes("retroframe");
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
  if (!requests.length) return "";
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

// Reads parenthetical rarities/print asks, then removes only the useful metadata bits.
function stripReviewParentheticals(line, statedRarities, specialRequests) {
  return line.replace(/\(([^)]*)\)/g, (match, content) => {
    const rarities = parseRarities(content);
    const requests = extractSpecialRequests(content);
    if (!rarities.length && !requests.length) return match;

    statedRarities.push(...rarities);
    specialRequests.push(...requests);
    return "";
  });
}

// Peels off trailing descriptors like "- rare" without chopping real names (e.g. "Retro-Mutation" threw an error previously, hopefully this fixes that)
function stripTrailingDescriptors(line, statedRarities) {
  let remaining = line.trim();

  while (remaining) {
    const spacedDescriptorMatch = remaining.match(/^(.*?)\s{2,}(.+)$/);
    if (spacedDescriptorMatch && isDescriptor(spacedDescriptorMatch[2])) {
      statedRarities.push(...parseRarities(spacedDescriptorMatch[2]));
      remaining = spacedDescriptorMatch[1].trim();
      continue;
    }

    const hyphenDescriptorMatch = remaining.match(/^(.*)\s*[-–—]\s*([^-–—]+)$/);
    if (hyphenDescriptorMatch && isDescriptor(hyphenDescriptorMatch[2])) {
      statedRarities.push(...parseRarities(hyphenDescriptorMatch[2]));
      remaining = hyphenDescriptorMatch[1].trim();
      continue;
    }

    break;
  }

  return remaining;
}

// Converts one raw pasted line into a structured card/token/basic-land request.
function parseCardLine(rawLine: string, index: number): PullItem | null {
  let line = rawLine.trim().replace(/^[-•]\s*/, "");
  if (!line || /^(\/\/|#)/.test(line)) return null;

  const quantityMatch = line.match(/^(\d+)\s*x?\s+(.+)$/i);
  const quantity = quantityMatch ? Number(quantityMatch[1]) : 1;
  line = quantityMatch ? quantityMatch[2].trim() : line;

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

  const specialRequests = extractSpecialRequests(line);
  const statedRarities = [];
  line = stripReviewParentheticals(line, statedRarities, specialRequests).trim();

  line = stripTrailingDescriptors(line, statedRarities);

  const trailingRaritiesMatch = line.match(new RegExp(`\\s+(${rarityPattern()}(?:\\s*(?:/|,|and)\\s*${rarityPattern()})*)$`, "i"));
  if (trailingRaritiesMatch) {
    statedRarities.push(...parseRarities(trailingRaritiesMatch[1]));
    line = line.slice(0, trailingRaritiesMatch.index).trim();
  }

  let inputName = cleanLookupName(line);
  if (!inputName) return null;
  const isToken = isTokenRequestName(inputName);
  const tokenDetails = isToken ? extractTokenDetails(rawLine) : [];
  const tokenColors = isToken ? extractTokenColors(rawLine) : [];
  if (isToken) inputName = applyTokenColors(cleanTokenName(inputName), tokenColors);
  if (!inputName) return null;

  return {
    index,
    original: rawLine,
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    inputName,
    statedRarities: Array.from(new Set(statedRarities)),
    specialRequests: Array.from(new Set(specialRequests)),
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

  normalizedCardLines.forEach((line, index) => {
    const item = parseCardLine(line, index);
    if (!item) return;

    const existing = grouped.get(item.lookupKey);
    if (existing) {
      existing.quantity += item.quantity;
      existing.originals.push(item.original);
      existing.statedRarities = Array.from(new Set([...existing.statedRarities, ...item.statedRarities]));
      existing.specialRequests = mergeSpecialRequests(existing.specialRequests, item.specialRequests);
      existing.tokenDetails = Array.from(new Set([...(existing.tokenDetails || []), ...(item.tokenDetails || [])]));
      existing.tokenColors = Array.from(new Set([...(existing.tokenColors || []), ...(item.tokenColors || [])]));
      existing.presetStatus = existing.presetStatus || item.presetStatus;
      existing.note = existing.note || item.note;
      return;
    }

    grouped.set(item.lookupKey, { ...item, originals: [item.original] });
  });

  return { customer, cards: Array.from(grouped.values()), cardLineCount: normalizedCardLines.length };
}

// Slices arrays into small batches for parallel-but-polite Scryfall work, so scryfall doesn't give me a spank.
function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

// Fetches JSON with cache, retries, throttling, and a little patience when Scryfall has a mood.
async function fetchJsonWithRetry(url: string, options: RequestInit = {}, attempts = 4): Promise<FetchResult> {
  throwIfAborted();
  const cached = readCachedResponse(url, options);
  if (cached) return cached;

  let lastError;
  let lastStatus = 0;
  const retryableStatuses = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      throwIfAborted();
      await waitForScryfallSlot();
      throwIfAborted();
      const response = await fetch(url, {
        ...options,
        signal: options.signal || activeScryfallSignal || undefined,
      });
      lastStatus = response.status;

      if (retryableStatuses.has(response.status) && attempt < attempts) {
        const retryAfter = Number(response.headers.get("Retry-After")) || 1;
        await sleep(Math.max(retryAfter * 1000, 900 * attempt));
        continue;
      }

      if (!response.ok) {
        return { ok: false, status: response.status, data: null };
      }

      const result = { ok: true, status: response.status, data: await response.json() };
      writeCachedResponse(url, options, result);
      return result;
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      lastError = error;
      if (attempt < attempts) await sleep(900 * attempt);
    }
  }

  return { ok: false, status: lastStatus, data: null, error: lastError };
}

// Sends up to 50 exact card-name lookups to Scryfall in one neat bundle. This has been reduced from 100, then 75, might end up reducing it again to 25 if we have to.
async function fetchCollection(items) {
  return fetchJsonWithRetry(SCRYFALL_COLLECTION_URL, {
    method: "POST",
    headers: {
      Accept: "application/json;q=0.9,*/*;q=0.8",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      identifiers: items.map((item) => ({ name: item.inputName })),
    }),
  });
}

// Convenience wrapper for a named-card lookup when we only care about the card.
async function fetchNamedCard(name, mode = "fuzzy") {
  const result = await fetchNamedCardResult(name, mode);
  return result.ok ? result.data : null;
}

// Asks Scryfall for one card by exact or fuzzy name and keeps the status details.
async function fetchNamedCardResult(name, mode = "fuzzy") {
  const params = new URLSearchParams({ [mode]: name });
  return fetchJsonWithRetry(`${SCRYFALL_NAMED_URL}?${params.toString()}`, {
    headers: { Accept: "application/json;q=0.9,*/*;q=0.8" },
  });
}

// Checks short one-word inputs so vague names do not sneak into the sorted list. mostly just for silly edge cases the customer might have put in the list
async function hasAmbiguousPlayableName(inputName) {
  const normalized = normalizeName(inputName);
  const words = normalized.split(" ").filter(Boolean);
  if (words.length !== 1 || normalized.length < 4) return false;

  const params = new URLSearchParams({
    q: `name:${inputName} game:paper -type:card -type:token -type:emblem`,
    unique: "cards",
  });
  const result = await fetchJsonWithRetry(`${SCRYFALL_SEARCH_URL}?${params.toString()}`, {
    headers: { Accept: "application/json;q=0.9,*/*;q=0.8" },
  }, 2);

  if (!result.ok) return false;
  return Number(result.data?.total_cards || 0) > 1;
}

// Decides whether Scryfall's fuzzy answer is helpful or a little too confident because shit gets weird.
async function isAmbiguousFuzzyMatch(inputName, card) {
  if (!card) return false;
  if (compactName(inputName) === compactName(card.name)) return false;
  return hasAmbiguousPlayableName(inputName);
}

// Filters out digital-only, tokens, emblems, and other not-for-the-drawer nonsense objects.
function isPlayablePaperCard(card) {
  if (!card || card.digital) return false;
  if (!card.games?.includes("paper")) return false;
  if (card.set_type === "memorabilia" || card.set_type === "token") return false;
  if (/\b(Card|Emblem|Token)\b/i.test(card.type_line || "")) return false;
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
  if (!print || print.digital) return false;
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

// Gets the five most recent case-relevant sets so the rules stay current over time. This will hopefully then future proof this thang.
export async function fetchRecentCaseSets() {
  const result = await fetchJsonWithRetry(SCRYFALL_SETS_URL, {
    headers: { Accept: "application/json;q=0.9,*/*;q=0.8" },
  });

  if (!result.ok) return [];

  const today = new Date();
  today.setHours(23, 59, 59, 999);

  return (result.data.data || [])
    .filter((set) => !set.digital)
    .filter((set) => CASE_RELEVANT_SET_TYPES.has(set.set_type))
    .filter((set) => set.released_at && new Date(`${set.released_at}T00:00:00`) <= today)
    .sort((a, b) => new Date(b.released_at).getTime() - new Date(a.released_at).getTime())
    .slice(0, 5)
    .map((set, index) => ({ code: set.code, index, name: set.name }));
}

// Figures out whether a card gets CHECK CASE  (or the gentler CASE? nudge.)
function caseNoteForItem(item: PullItem, recentSets: ScryfallSetSummary[]) {
  const prints = item.prints || [];
  if (!prints.length) return "";

  const recentIndexByCode = new Map(recentSets.map((set) => [set.code, set.index]));
  const highRecentPrint = prints.find((print) => {
    const setIndex = recentIndexByCode.get(print.set);
    return setIndex !== undefined
      && setIndex <= 1
      && (print.rarity === "rare" || print.rarity === "mythic")
      && isEligibleRarityPrint(print);
  });

  if (highRecentPrint) return "CHECK CASE";

  const casePricePrints = prints.filter(isCasePricePrint);
  const midRecentPricePrint = casePricePrints.find((print) => {
    const setIndex = recentIndexByCode.get(print.set);
    return setIndex !== undefined
      && setIndex >= 2
      && setIndex <= 4
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
async function fetchPrintFacts(card) {
  if (!card?.prints_search_uri) {
    return {
      rarities: [card?.rarity].filter(Boolean),
      nonSecretRarities: [card?.rarity].filter(Boolean),
      hasFullArt: Boolean(card?.full_art),
      prints: [card].filter(Boolean),
      eligibleRarityChecked: false,
    };
  }

  let nextUrl = card.prints_search_uri;
  const prints = [];

  while (nextUrl) {
    const result = await fetchJsonWithRetry(nextUrl, {
      headers: { Accept: "application/json;q=0.9,*/*;q=0.8" },
    });

    if (!result.ok) {
      return {
        rarities: [card.rarity].filter(Boolean),
        nonSecretRarities: [card.rarity].filter(Boolean),
        hasFullArt: Boolean(card.full_art),
        prints: [card].filter(Boolean),
        eligibleRarityChecked: false,
        printLookupFailed: true,
      };
    }

    const data = result.data;
    prints.push(...(data.data || []));
    nextUrl = data.has_more ? data.next_page : "";
    if (nextUrl) await sleep(75);
  }

  const usablePrints = prints.length ? prints : [card];
  const eligibleRarityPrints = usablePrints.filter(isEligibleRarityPrint);
  const rarityPrints = eligibleRarityPrints.length
    ? eligibleRarityPrints
    : usablePrints.filter((print) => !isSecretLairPrint(print) && !isPlayerRewardPrint(print) && print.set_type !== "promo");

  return {
    rarities: Array.from(new Set(usablePrints.map((print) => print.rarity).filter(Boolean))),
    nonSecretRarities: Array.from(new Set(rarityPrints.map((print) => print.rarity).filter(Boolean))),
    hasFullArt: usablePrints.some((print) => print.full_art),
    prints: usablePrints,
    eligibleRarityChecked: true,
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

    const card = byName.get(normalizeName(item.inputName));
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

// Tries exact batch lookup first, then exact one-by-one when the batch trips over itself.
async function resolveExactBatch(batch, batchNumber, setMessage) {
  let lastResult = null;

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    setMessage(attempt === 1
      ? `Exact lookup batch ${batchNumber}...`
      : `Exact lookup batch ${batchNumber} retry ${attempt}...`);
    lastResult = await fetchCollection(batch);
    if (lastResult.ok) return mergeResolvedCards(batch, lastResult.data);
    await sleep(500 * attempt);
  }

  setMessage(`Exact lookup batch ${batchNumber} failed; trying exact names one at a time...`);
  const resolved = [];

  for (const [index, item] of batch.entries()) {
    setMessage(`Exact retry ${index + 1} of ${batch.length}: "${item.inputName}"...`);
    const result = await fetchNamedCardResult(item.inputName, "exact");

    if (result.ok) {
      resolved.push(resolveItemWithCard(item, result.data));
    } else {
      resolved.push({
        ...item,
        status: "missing",
        note: result.status && result.status !== 404
          ? `Exact lookup failed (${result.status})`
          : "",
      });
    }

    await sleep(250);
  }

  return resolved;
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

// Picks the official card name when we have it, otherwise makes the input not look like bootysauce
function displayName(item) {
  return item.card?.name || titleCaseFallback(item.inputName);
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

// Builds one printable output line with quantity, notes, case tags, and optional checkbox.
function formatCardLine(item, useCheckboxes) {
  const specialNote = specialRequestNote(item);
  const caseNote = item.caseNote ? ` - ${item.caseNote}` : "";
  const reviewNote = item.status !== "found" && item.note ? ` (${item.note})` : "";
  return `${useCheckboxes ? "[ ] " : ""}${item.quantity} ${displayName(item)}${alternateTitleNote(item)}${tokenDetailsNote(item)}${specialNote}${caseNote}${reviewNote}`;
}

// Formats contact info -  right now Facebook gets parentheses, phone/email do not.
function formatContactLine(contact) {
  if (!contact) return "";
  const normalized = mergeContactValues(contact);
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
  if (item.quantity !== 1 || item.statedRarities?.length || item.specialRequests?.length) return false;
  if (/\d|@|[!?]/.test(item.inputName)) return false;
  return /^[A-Za-z.'-]+$/.test(item.inputName.trim());
}

// Rescues customer names from the edges of the card list when no contact header was obvious (REVIST THIS - BREAKS SOMETIMES)
export function inferBoundaryCustomer(customer, items, cardLineCount) {
  if (customer.name) return { customer, items };

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

  if (customer.contact) {
    lines.push(formatContactLine(customer.contact));
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
async function enrichResolvedItem(item, caseCheck, recentCaseSets) {
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

  if (item.isBasicLand) {
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

  const facts = await fetchPrintFacts(item.card);
  const enrichedItem = { ...item, ...facts };
  const notPlayablePaper = !facts.printLookupFailed && !hasPlayablePaperPrint(facts.prints);
  const specialRequestMissing = hasSpecialPrintRequest(item)
    && !facts.printLookupFailed
    && !facts.prints?.some((print) => printMatchesSpecialRequests(print, item));
  const ambiguousNonPlayable = notPlayablePaper && await hasAmbiguousPlayableName(item.inputName);

  return {
    ...enrichedItem,
    status: specialRequestMissing || notPlayablePaper ? "review" : item.status,
    caseNote: caseCheck ? caseNoteForItem(enrichedItem, recentCaseSets) : "",
    alternateTitle: requestedFlavorName(item, facts.prints),
    note: specialRequestMissing
      ? specialRequestReviewNote(item)
      : notPlayablePaper
          ? ambiguousNonPlayable ? "Ambiguous card name" : "Not a playable paper card"
          : item.note,
  };
}

// For further rounds of inquiry in case Scryfall is being a pain about print history.
async function retryFailedPrintHistories(items, caseCheck, recentCaseSets, delayMs, passLabel, setMessage) {
  const retriedItems = [...items];
  const failedIndexes = retriedItems
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.status === "found" && item.printLookupFailed);

  for (const [retryIndex, { item, index }] of failedIndexes.entries()) {
    setMessage(`${passLabel}: Scryfall threw an error, retrying print history ${retryIndex + 1} of ${failedIndexes.length}...`);
    if (retryIndex > 0) await sleep(delayMs);
    const retriedItem = await enrichResolvedItem(
      { ...item, printLookupFailed: false },
      caseCheck,
      recentCaseSets,
    );
    retriedItems[index] = { ...retriedItem, printHistoryRetried: true };
  }

  return retriedItems;
}

// Resolves parsed names through exact batches, one-off exact retries, then fuzzy cleanup.
export async function resolveCardNames(items, setMessage, carefulMode) {
  const firstPass = items.filter((item) => item.status === "found" || item.status === "review");
  const lookupItems = items.filter((item) => item.status !== "found" && item.status !== "review");
  const exactBatches = chunk(lookupItems, carefulMode ? 1 : BATCH_SIZE);

  for (const [batchIndex, batch] of exactBatches.entries()) {
    firstPass.push(...await resolveExactBatch(batch, batchIndex + 1, setMessage));
    await sleep(carefulMode ? 500 : 150);
  }

  const fuzzyResolved = [];
  for (const item of firstPass) {
    if (item.status === "found" || item.status === "review") {
      fuzzyResolved.push(item);
      continue;
    }

    setMessage(`Trying fuzzy match for "${item.inputName}"...`);
    const fuzzyResult = await fetchNamedCardResult(item.inputName, "fuzzy");
    const card = fuzzyResult.ok ? fuzzyResult.data : null;
    const ambiguous = card && await isAmbiguousFuzzyMatch(item.inputName, card);
    fuzzyResolved.push(
      card && !ambiguous
        ? resolveItemWithCard(item, card)
        : {
          ...item,
          status: "review",
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
    await sleep(carefulMode ? 500 : 250);
  }

  return fuzzyResolved;
}

// Walks print histories in small parallel groups, then runs slower retry passes for failures.
export async function enrichPrintHistories(items, caseCheck, recentCaseSets, setMessage, carefulMode) {
  let withRarities = [];
  const concurrency = carefulMode ? 1 : PRINT_FACT_CONCURRENCY;
  const printGroups = chunk(items, concurrency);

  for (const [groupIndex, group] of printGroups.entries()) {
    const starting = groupIndex * concurrency + 1;
    const ending = Math.min(starting + group.length - 1, items.length);
    setMessage(`Working through Scryfall print history ${starting}-${ending} of ${items.length}...`);
    const enrichedGroup = await Promise.all(
      group.map((item) => enrichResolvedItem(item, caseCheck, recentCaseSets)),
    );
    withRarities.push(...enrichedGroup);
    await sleep(carefulMode ? 500 : 250);
  }

  withRarities = await retryFailedPrintHistories(
    withRarities,
    caseCheck,
    recentCaseSets,
    500,
    "Second pass",
    setMessage,
  );

  withRarities = await retryFailedPrintHistories(
    withRarities,
    caseCheck,
    recentCaseSets,
    2000,
    "Third pass",
    setMessage,
  );

  return withRarities;
}

export function reliabilityMessage(items) {
  const retryCount = items.filter((item) => item.printHistoryRetried).length;
  const fallbackCount = items.filter((item) => item.status === "found" && item.printLookupFailed).length;
  if (fallbackCount) return `${fallbackCount} card${fallbackCount === 1 ? "" : "s"} used fallback rarity.`;
  if (retryCount) return `Scryfall needed print-history retries for ${retryCount} card${retryCount === 1 ? "" : "s"}.`;
  return "";
}

export async function processPullListText(text: string, options: ProcessPullListOptions = {}) {
  const {
    useCheckboxes = true,
    caseCheck = false,
    carefulMode = false,
    processedAt = new Date().toISOString(),
    setMessage = () => {},
  } = options;
  const parsed = parsePullList(text);

  beginScryfallRun(null, carefulMode);

  try {
    let recentCaseSets = [];
    if (caseCheck) {
      setMessage("Checking recent set list for case rules...");
      recentCaseSets = await fetchRecentCaseSets();
    }

    const fuzzyResolved = await resolveCardNames(parsed.cards, setMessage, carefulMode);
    const withRarities = await enrichPrintHistories(fuzzyResolved, caseCheck, recentCaseSets, setMessage, carefulMode);
    const inferred = inferBoundaryCustomer(parsed.customer, withRarities, parsed.cardLineCount);

    return {
      parsed,
      customer: inferred.customer,
      items: inferred.items,
      processedAt,
      output: formatOutput(inferred.customer, inferred.items, useCheckboxes, processedAt),
      reliabilityNote: reliabilityMessage(inferred.items),
    };
  } finally {
    endScryfallRun();
  }
}


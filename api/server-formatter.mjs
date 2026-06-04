// src/formatter.ts
var SCRYFALL_COLLECTION_URL = "https://api.scryfall.com/cards/collection";
var SCRYFALL_NAMED_URL = "https://api.scryfall.com/cards/named";
var SCRYFALL_SEARCH_URL = "https://api.scryfall.com/cards/search";
var SCRYFALL_SETS_URL = "https://api.scryfall.com/sets";
var BATCH_SIZE = 50;
var PRINT_FACT_CONCURRENCY = 5;
var SCRYFALL_MIN_INTERVAL_MS = 120;
var CAREFUL_SCRYFALL_MIN_INTERVAL_MS = 500;
var CACHE_TTL_MS = 4 * 24 * 60 * 60 * 1e3;
var CACHE_PREFIX = "rrg-scryfall-cache:";
var BUFFER_MARKER = ".";
var STORE_EMAIL_PATTERN = /\binfo@redraccoongames\.com\b/i;
var EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
var PHONE_PATTERN = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/;
var scryfallRequestGate = Promise.resolve();
var lastScryfallRequestAt = 0;
var activeScryfallSignal = null;
var activeScryfallMinIntervalMs = SCRYFALL_MIN_INTERVAL_MS;
var SAMPLE_CUSTOMER_NAMES = [
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
  "Matt Cavotta"
];
var sampleCardList = `1 Chub Toad - G unc
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
function randomSampleCustomerName() {
  return SAMPLE_CUSTOMER_NAMES[Math.floor(Math.random() * SAMPLE_CUSTOMER_NAMES.length)];
}
function randomSamplePhoneNumber() {
  const areaCode = Math.random() < 0.5 ? "206" : "564";
  const lastFour = String(Math.floor(Math.random() * 1e4)).padStart(4, "0");
  return `${areaCode}-555-${lastFour}`;
}
function beginScryfallRun(signal, carefulMode = false) {
  activeScryfallSignal = signal;
  activeScryfallMinIntervalMs = carefulMode ? CAREFUL_SCRYFALL_MIN_INTERVAL_MS : SCRYFALL_MIN_INTERVAL_MS;
}
function endScryfallRun() {
  activeScryfallSignal = null;
  activeScryfallMinIntervalMs = SCRYFALL_MIN_INTERVAL_MS;
}
function createSampleList() {
  return `${randomSampleCustomerName()}
${randomSamplePhoneNumber()}

${sampleCardList}`;
}
var CARD_HINTS = /* @__PURE__ */ new Set([
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
  "white"
]);
var BASIC_LANDS_BY_COLOR = {
  black: "Swamp",
  blue: "Island",
  green: "Forest",
  red: "Mountain",
  white: "Plains"
};
var BASIC_LAND_NAMES = new Set(Object.values(BASIC_LANDS_BY_COLOR));
var BASIC_LAND_ORDER = ["Plains", "Island", "Swamp", "Mountain", "Forest"];
var CASE_RELEVANT_SET_TYPES = /* @__PURE__ */ new Set(["core", "commander", "draft_innovation", "expansion", "masters"]);
var TOKEN_KEYWORD_PATTERNS = [
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
  ["Plainswalk", /\bplainswalk\b/i]
];
var TOKEN_COLOR_PATTERNS = [
  ["White", /\bwhite\b/i],
  ["Blue", /\bblue\b/i],
  ["Black", /\bblack\b/i],
  ["Red", /\bred\b/i],
  ["Green", /\bgreen\b/i],
  ["Colorless", /\bcolorless\b/i]
];
var SPECIAL_REQUEST_PATTERNS = [
  { label: "FOIL", pattern: /\b(?:foil|foiled)\b/i },
  { label: "NONFOIL", pattern: /\b(?:non[-\s]?foil|nonfoil)\b/i },
  { label: "SHOWCASE", pattern: /\bshowcase\b/i },
  { label: "BORDERLESS", pattern: /\bborderless\b/i },
  { label: "EXTENDED ART", pattern: /\bextended\s+art\b/i },
  { label: "FULL ART", pattern: /\bfull\s+art\b/i },
  { label: "ETCHED", pattern: /\betched\b/i },
  { label: "RETRO FRAME", pattern: /\b(?:retro\s+frame|old\s+border)\b/i },
  { label: "ALT ART", pattern: /\b(?:alt(?:ernate)?\s+art|alternate\s+art)\b/i },
  { label: "PROMO", pattern: /\bpromo\b/i }
];
function normalizeName(value) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w/ ]+/g, "").replace(/\s+/g, " ").trim();
}
function compactName(value) {
  return normalizeName(value).replace(/\s+/g, "");
}
function titleCaseFallback(value) {
  const smallWords = /* @__PURE__ */ new Set(["a", "an", "and", "at", "by", "for", "in", "of", "or", "the", "to"]);
  return value.split(/\s+/).filter(Boolean).map((word, index) => {
    const lower = word.toLowerCase();
    if (index > 0 && smallWords.has(lower)) return lower;
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(" ");
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
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
function cacheKeyForRequest(url, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  return `${CACHE_PREFIX}${method}:${url}:${String(options.body || "")}`;
}
function readCachedResponse(url, options = {}) {
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
function writeCachedResponse(url, options = {}, result) {
  if (typeof localStorage === "undefined" || !result?.ok) return;
  try {
    localStorage.setItem(cacheKeyForRequest(url, options), JSON.stringify({
      savedAt: Date.now(),
      status: result.status,
      data: result.data
    }));
  } catch {
  }
}
function throwIfAborted() {
  if (activeScryfallSignal?.aborted) {
    throw new DOMException("Processing canceled.", "AbortError");
  }
}
function formatPhoneNumber(value) {
  const digits = value.replace(/\D/g, "");
  const tenDigits = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (tenDigits.length !== 10) return value.trim();
  return `${tenDigits.slice(0, 3)}-${tenDigits.slice(3, 6)}-${tenDigits.slice(6)}`;
}
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
  return value.replace(/[<>]/g, "").replace(/\s+/g, " ").trim().replace(/^["']|["']$/g, "").trim();
}
function stripFieldLabel(value) {
  return value.replace(/^(?:name|customer|phone|email|e-mail|contact):\s*/i, "").trim();
}
function splitNameAndContact(value, extraContact = "") {
  const cleanedValue = stripFieldLabel(value);
  const email = value.match(EMAIL_PATTERN)?.[0] || "";
  const phone = value.match(PHONE_PATTERN)?.[0] || "";
  const facebook = /\bfacebook\b|\bfb\b/i.test(value) ? "facebook" : "";
  const contact = mergeContactValues(phone, email, facebook, extraContact);
  const name = [phone, email].reduce(
    (current, part) => part ? current.replace(part, "") : current,
    cleanedValue
  ).replace(/\bfacebook\b|\bfb\b/i, "").replace(/\s+/g, " ").trim();
  return { name: cleanCustomerName(name), contact };
}
function extractContact(line) {
  const labeledNameMatch = line.match(/^(?:name|customer):\s*(.+)$/i);
  if (labeledNameMatch) {
    return { name: cleanCustomerName(labeledNameMatch[1]), contact: "" };
  }
  const labeledContactMatch = line.match(/^(?:phone|email|e-mail|contact):\s*(.+)$/i);
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
      contact: normalizeContactValue(bracketMatch[2])
    };
  }
  const parsed = splitNameAndContact(line);
  if (!parsed.contact) return { name: line.trim(), contact: "" };
  return parsed;
}
function isSeparatorLine(line) {
  return /^[-_=]{4,}$/.test(line.trim());
}
function isLikelyNoteLine(line) {
  const normalized = normalizeName(line);
  if (!normalized) return true;
  if (STORE_EMAIL_PATTERN.test(line)) return true;
  if (/\bdeck\s*list\b/i.test(line) || /decklist$/i.test(line)) return true;
  if (/^(prices?\s+are|i used\b|i don'?t\b|i do not\b|i placed\b)/i.test(line)) return true;
  if (/^(hello|hi|hey|thanks|thank you|just one of each|i will|i'm|im|these are|please|once again|mtg pull list from|mtg pull list for)\b/i.test(line)) {
    return true;
  }
  if (/[.!?]/.test(line) && normalized.split(" ").length > 4) return true;
  return false;
}
function hasContactOrHeader(line) {
  return EMAIL_PATTERN.test(line) || PHONE_PATTERN.test(line) || /^(?:name|customer|phone|email|e-mail|contact):\s*/i.test(line) || /\bpull\s+list\s+(from|for)\b/i.test(line) || /\bfacebook\b|\bfb\b/i.test(line);
}
function isFromHeaderLine(line) {
  return /^from:\s*/i.test(line);
}
function isIgnoredEmailMetadataLine(line) {
  return /^pull list email received$/i.test(line) || /^(subject|received):\s*/i.test(line);
}
function parseCustomerAndCards(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
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
  customer.contact = customer.contact || emailHeaderContact.contact;
  return { customer, cardLines };
}
function parseRarity(value) {
  const normalized = normalizeName(value);
  if (normalized === "m" || normalized === "mr" || normalized === "mythic" || normalized === "mythic rare") return "mythic";
  if (normalized === "r" || normalized === "rare") return "rare";
  if (normalized === "u" || normalized === "uc" || normalized === "unc" || normalized === "uncommon") return "uncommon";
  if (normalized === "c" || normalized === "com" || normalized === "common") return "common";
  return "";
}
function parseRarities(value) {
  return value.split(/[,/]+|\band\b/i).map((part) => parseRarity(part.trim())).filter(Boolean);
}
function parseMetadataRarities(value) {
  const matches = value.match(/\b(?:mythic rare|mythic|rare|uncommon|common|mr|unc|uc|com)\b/ig) || [];
  return matches.map((part) => parseRarity(part)).filter(Boolean);
}
function splitCommaFields(value) {
  const fields = [];
  let current = "";
  let inQuotes = false;
  for (const character of value) {
    if (character === '"') {
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
  return fields.filter(Boolean);
}
function looksLikeCsvMetadata(value) {
  const normalized = normalizeName(value);
  return Boolean(
    parseMetadataRarities(value).length || SPECIAL_REQUEST_PATTERNS.some(({ pattern }) => pattern.test(value)) || /^\$?\d+(?:\.\d{1,2})?$/.test(value.trim()) || /^(?:[A-Z0-9]{2,5}|[WUBRG]{1,5}|colorless|doesn'?t matter|does not matter)$/i.test(value.trim()) || normalized === "cheapest you have"
  );
}
function applyCommaMetadata(line, statedRarities, specialRequests) {
  const fields = splitCommaFields(line);
  if (fields.length < 2) return line;
  const metadata = fields.slice(1);
  const metadataScore = metadata.filter(looksLikeCsvMetadata).length;
  const isBasicLandNote = BASIC_LAND_NAMES.has(fields[0]);
  if (!isBasicLandNote && (fields.length < 3 || metadataScore < 2)) return line;
  metadata.forEach((field) => {
    statedRarities.push(...parseMetadataRarities(field));
    specialRequests.push(...extractSpecialRequests(field));
  });
  return fields[0].trim();
}
function rarityPattern() {
  return "(?:mythic rare|mythic|rare|uncommon|common|mr|unc|com|uc|m|r|u|c)";
}
function isQuantityOnlyLine(line) {
  return /^\d+\s*x?$/i.test(line.trim());
}
function isTableHeaderLine(line) {
  return ["qty", "quantity", "card name", "card", "rarity"].includes(normalizeName(line));
}
function isStandaloneRarityLine(line) {
  return Boolean(parseRarity(line));
}
function normalizeCopiedTableLines(lines) {
  const normalized = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (isTableHeaderLine(line)) continue;
    if (isQuantityOnlyLine(line) && lines[index + 1] && lines[index + 2] && !isTableHeaderLine(lines[index + 1]) && isStandaloneRarityLine(lines[index + 2])) {
      normalized.push(`${line} ${lines[index + 1]} ${lines[index + 2]}`);
      index += 2;
      continue;
    }
    if (isQuantityOnlyLine(line) || isStandaloneRarityLine(line)) continue;
    normalized.push(line);
  }
  return normalized;
}
function isDescriptor(part) {
  const normalized = normalizeName(part);
  if (parseRarities(normalized).length) return true;
  if (SPECIAL_REQUEST_PATTERNS.some(({ pattern }) => pattern.test(part))) return true;
  if (CARD_HINTS.has(normalized)) return true;
  if (/^[wubrg]$/i.test(part)) return true;
  if (/^(white|blue|black|red|green|colorless)(\/(white|blue|black|red|green|colorless))*$/i.test(part)) return true;
  return false;
}
function extractSpecialRequests(value) {
  return SPECIAL_REQUEST_PATTERNS.filter(({ pattern }) => pattern.test(value)).map(({ label }) => label);
}
function stripSpecialRequests(value) {
  return SPECIAL_REQUEST_PATTERNS.reduce(
    (current, { pattern }) => current.replace(pattern, ""),
    value
  );
}
function cleanCardName(value) {
  return value.replace(/[•*]/g, "").replace(/\([^)]*\)\s*\d*$/g, "").replace(/\[[^\]]+\]\s*$/g, "").replace(/\s+/g, " ").trim().replace(/^["']|["']$/g, "").trim();
}
function cleanLookupName(value) {
  return cleanCardName(stripSpecialRequests(value));
}
function isTokenRequestName(value) {
  return /\btoken\b/i.test(value);
}
function extractPowerToughness(value) {
  const match = value.match(/\b((?:\d+|x|\*)\s*\/\s*(?:\d+|x|\*))\b/i);
  return match ? match[1].replace(/\s+/g, "").toUpperCase() : "";
}
function extractTokenDetails(value) {
  const powerToughness = extractPowerToughness(value);
  const keywords = TOKEN_KEYWORD_PATTERNS.filter(([, pattern]) => pattern.test(value)).map(([label]) => label);
  return Array.from(new Set([powerToughness, ...keywords].filter(Boolean)));
}
function extractTokenColors(value) {
  const colors = TOKEN_COLOR_PATTERNS.filter(([, pattern]) => pattern.test(value)).map(([label]) => label);
  return Array.from(new Set(colors));
}
function cleanTokenName(value) {
  let cleaned = value.replace(/\b(?:\d+|x|\*)\s*\/\s*(?:\d+|x|\*)\b/ig, " ");
  TOKEN_KEYWORD_PATTERNS.forEach(([, pattern]) => {
    cleaned = cleaned.replace(pattern, " ");
  });
  TOKEN_COLOR_PATTERNS.forEach(([, pattern]) => {
    cleaned = cleaned.replace(pattern, " ");
  });
  return cleaned.replace(/\b(?:with|and|or|has|having)\b/ig, " ").replace(/\s*[,.;:-]\s*$/g, "").replace(/\s+/g, " ").trim();
}
function applyTokenColors(name, colors = []) {
  if (!colors.length) return name;
  const colorPrefix = colors.join("/");
  return normalizeName(name).startsWith(normalizeName(colorPrefix)) ? name : `${colorPrefix} ${name}`;
}
function mergeSpecialRequests(a = [], b = []) {
  return Array.from(/* @__PURE__ */ new Set([...a, ...b]));
}
function hasSpecialPrintRequest(item) {
  return (item.specialRequests || []).some((request) => request !== "NONFOIL");
}
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
function specialRequestNote(item) {
  return (item.specialRequests || []).map((request) => ` - ${request}`).join("");
}
function specialRequestReviewNote(item) {
  const requests = item.specialRequests || [];
  if (!requests.length) return "";
  if (requests.length === 1) return `${requests[0]} version not found`;
  return `${requests.join(" / ")} version not found`;
}
function requestedFlavorName(item, prints = []) {
  const candidates = [item.card, ...prints].filter(Boolean);
  const inputNormalized = normalizeName(item.inputName);
  const inputCompact = compactName(item.inputName);
  const flavorNames = candidates.flatMap((print) => [
    print.flavor_name,
    ...(print.card_faces || []).map((face) => face.flavor_name)
  ]).filter(Boolean);
  const match = flavorNames.find((flavorName) => normalizeName(flavorName) === inputNormalized || compactName(flavorName) === inputCompact);
  return match || "";
}
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
function parseCardLine(rawLine, index) {
  let line = rawLine.trim().replace(/^[-•]\s*/, "");
  if (!line || /^(\/\/|#)/.test(line)) return null;
  const quantityMatch = line.match(/^(\d+)\s*x?\s+(.+)$/i);
  let quantity = quantityMatch ? Number(quantityMatch[1]) : 1;
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
      lookupKey: normalizeName(landName)
    };
  }
  const specialRequests = extractSpecialRequests(line);
  const statedRarities = [];
  line = stripReviewParentheticals(line, statedRarities, specialRequests).trim();
  line = applyCommaMetadata(line, statedRarities, specialRequests).trim();
  const trailingQuantityMatch = line.match(/\b(?:x\s*(\d+)|(\d+)\s*x)\s*$/i);
  if (trailingQuantityMatch) {
    const trailingQuantity = Number(trailingQuantityMatch[1] || trailingQuantityMatch[2]);
    if (Number.isFinite(trailingQuantity) && trailingQuantity > 0) {
      quantity = trailingQuantity;
      line = line.slice(0, trailingQuantityMatch.index).trim();
    }
  }
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
    ...isToken ? {
      status: "found",
      isToken: true,
      tokenDetails,
      tokenColors,
      rarities: ["common"],
      nonSecretRarities: ["common"]
    } : {}
  };
}
function parsePullList(text) {
  const { customer, cardLines } = parseCustomerAndCards(text);
  const normalizedCardLines = normalizeCopiedTableLines(cardLines);
  const grouped = /* @__PURE__ */ new Map();
  normalizedCardLines.forEach((line, index) => {
    const item = parseCardLine(line, index);
    if (!item) return;
    const existing = grouped.get(item.lookupKey);
    if (existing) {
      existing.quantity += item.quantity;
      existing.originals.push(item.original);
      existing.statedRarities = Array.from(/* @__PURE__ */ new Set([...existing.statedRarities, ...item.statedRarities]));
      existing.specialRequests = mergeSpecialRequests(existing.specialRequests, item.specialRequests);
      existing.tokenDetails = Array.from(/* @__PURE__ */ new Set([...existing.tokenDetails || [], ...item.tokenDetails || []]));
      existing.tokenColors = Array.from(/* @__PURE__ */ new Set([...existing.tokenColors || [], ...item.tokenColors || []]));
      existing.presetStatus = existing.presetStatus || item.presetStatus;
      existing.note = existing.note || item.note;
      return;
    }
    grouped.set(item.lookupKey, { ...item, originals: [item.original] });
  });
  return { customer, cards: Array.from(grouped.values()), cardLineCount: normalizedCardLines.length };
}
function chunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
async function fetchJsonWithRetry(url, options = {}, attempts = 4) {
  throwIfAborted();
  const cached = readCachedResponse(url, options);
  if (cached) return cached;
  let lastError;
  let lastStatus = 0;
  const retryableStatuses = /* @__PURE__ */ new Set([408, 409, 425, 429, 500, 502, 503, 504]);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      throwIfAborted();
      await waitForScryfallSlot();
      throwIfAborted();
      const response = await fetch(url, {
        ...options,
        signal: options.signal || activeScryfallSignal || void 0
      });
      lastStatus = response.status;
      if (retryableStatuses.has(response.status) && attempt < attempts) {
        const retryAfter = Number(response.headers.get("Retry-After")) || 1;
        await sleep(Math.max(retryAfter * 1e3, 900 * attempt));
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
async function fetchCollection(items) {
  return fetchJsonWithRetry(SCRYFALL_COLLECTION_URL, {
    method: "POST",
    headers: {
      Accept: "application/json;q=0.9,*/*;q=0.8",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      identifiers: items.map((item) => ({ name: item.inputName }))
    })
  });
}
async function fetchNamedCardResult(name, mode = "fuzzy") {
  const params = new URLSearchParams({ [mode]: name });
  return fetchJsonWithRetry(`${SCRYFALL_NAMED_URL}?${params.toString()}`, {
    headers: { Accept: "application/json;q=0.9,*/*;q=0.8" }
  });
}
async function hasAmbiguousPlayableName(inputName) {
  const normalized = normalizeName(inputName);
  const words = normalized.split(" ").filter(Boolean);
  if (words.length !== 1 || normalized.length < 4) return false;
  const params = new URLSearchParams({
    q: `name:${inputName} game:paper -type:card -type:token -type:emblem`,
    unique: "cards"
  });
  const result = await fetchJsonWithRetry(`${SCRYFALL_SEARCH_URL}?${params.toString()}`, {
    headers: { Accept: "application/json;q=0.9,*/*;q=0.8" }
  }, 2);
  if (!result.ok) return false;
  return Number(result.data?.total_cards || 0) > 1;
}
async function isAmbiguousFuzzyMatch(inputName, card) {
  if (!card) return false;
  if (compactName(inputName) === compactName(card.name)) return false;
  return hasAmbiguousPlayableName(inputName);
}
function isPlayablePaperCard(card) {
  if (!card || card.digital) return false;
  if (!card.games?.includes("paper")) return false;
  if (card.set_type === "memorabilia" || card.set_type === "token") return false;
  if (/\b(Card|Emblem|Token)\b/i.test(card.type_line || "")) return false;
  return true;
}
function isSecretLairPrint(print) {
  return /^sl[dupc]?$/i.test(print?.set || "") || /\bsecret\s+lair\b/i.test(print?.set_name || "");
}
function isPlayerRewardPrint(print) {
  return /\bplayer\s+rewards?\b/i.test(print?.set_name || "") || /^mpr$/i.test(print?.set || "");
}
function isEligibleRarityPrint(print) {
  if (!print || print.digital) return false;
  if (isSecretLairPrint(print) || isPlayerRewardPrint(print)) return false;
  if (print.booster) return true;
  return print.set_type === "commander";
}
function priceValue(print) {
  return Number(print?.prices?.usd || 0);
}
function isCasePricePrint(print) {
  if (!print || print.digital) return false;
  if (isSecretLairPrint(print) || isPlayerRewardPrint(print)) return false;
  if (print.set_type === "promo" || print.set_type === "memorabilia" || print.set_type === "token") return false;
  return Boolean(print.prices?.usd);
}
function isLandCard(cardOrPrint) {
  return /\bLand\b/i.test(cardOrPrint?.type_line || "");
}
async function fetchRecentCaseSets() {
  const result = await fetchJsonWithRetry(SCRYFALL_SETS_URL, {
    headers: { Accept: "application/json;q=0.9,*/*;q=0.8" }
  });
  if (!result.ok) return [];
  const today = /* @__PURE__ */ new Date();
  today.setHours(23, 59, 59, 999);
  return (result.data.data || []).filter((set) => !set.digital).filter((set) => CASE_RELEVANT_SET_TYPES.has(set.set_type)).filter((set) => set.released_at && /* @__PURE__ */ new Date(`${set.released_at}T00:00:00`) <= today).sort((a, b) => new Date(b.released_at).getTime() - new Date(a.released_at).getTime()).slice(0, 5).map((set, index) => ({ code: set.code, index, name: set.name }));
}
function caseNoteForItem(item, recentSets) {
  const prints = item.prints || [];
  if (!prints.length) return "";
  const recentIndexByCode = new Map(recentSets.map((set) => [set.code, set.index]));
  const highRecentPrint = prints.find((print) => {
    const setIndex = recentIndexByCode.get(print.set);
    return setIndex !== void 0 && setIndex <= 1 && (print.rarity === "rare" || print.rarity === "mythic") && isEligibleRarityPrint(print);
  });
  if (highRecentPrint) return "CHECK CASE";
  const casePricePrints = prints.filter(isCasePricePrint);
  const midRecentPricePrint = casePricePrints.find((print) => {
    const setIndex = recentIndexByCode.get(print.set);
    return setIndex !== void 0 && setIndex >= 2 && setIndex <= 4 && priceValue(print) >= 5;
  });
  const highAnyPrint = casePricePrints.find((print) => priceValue(print) >= 50);
  const landCasePrint = casePricePrints.find((print) => isLandCard(print) && priceValue(print) >= 10);
  if (midRecentPricePrint || highAnyPrint || landCasePrint) return "CASE?";
  return "";
}
function hasPlayablePaperPrint(prints) {
  return (prints || []).some((print) => isPlayablePaperCard(print));
}
async function fetchPrintFacts(card) {
  if (!card?.prints_search_uri) {
    return {
      rarities: [card?.rarity].filter(Boolean),
      nonSecretRarities: [card?.rarity].filter(Boolean),
      hasFullArt: Boolean(card?.full_art),
      prints: [card].filter(Boolean),
      eligibleRarityChecked: false
    };
  }
  let nextUrl = card.prints_search_uri;
  const prints = [];
  while (nextUrl) {
    const result = await fetchJsonWithRetry(nextUrl, {
      headers: { Accept: "application/json;q=0.9,*/*;q=0.8" }
    });
    if (!result.ok) {
      return {
        rarities: [card.rarity].filter(Boolean),
        nonSecretRarities: [card.rarity].filter(Boolean),
        hasFullArt: Boolean(card.full_art),
        prints: [card].filter(Boolean),
        eligibleRarityChecked: false,
        printLookupFailed: true
      };
    }
    const data = result.data;
    prints.push(...data.data || []);
    nextUrl = data.has_more ? data.next_page : "";
    if (nextUrl) await sleep(75);
  }
  const usablePrints = prints.length ? prints : [card];
  const eligibleRarityPrints = usablePrints.filter(isEligibleRarityPrint);
  const rarityPrints = eligibleRarityPrints.length ? eligibleRarityPrints : usablePrints.filter((print) => !isSecretLairPrint(print) && !isPlayerRewardPrint(print) && print.set_type !== "promo");
  return {
    rarities: Array.from(new Set(usablePrints.map((print) => print.rarity).filter(Boolean))),
    nonSecretRarities: Array.from(new Set(rarityPrints.map((print) => print.rarity).filter(Boolean))),
    hasFullArt: usablePrints.some((print) => print.full_art),
    prints: usablePrints,
    eligibleRarityChecked: true
  };
}
function mergeResolvedCards(batch, result) {
  const byName = /* @__PURE__ */ new Map();
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
        correction: card.name !== item.inputName
      };
    }
    return { ...item, status: "missing" };
  });
}
function resolveItemWithCard(item, card) {
  return {
    ...item,
    card,
    status: "found",
    isBasicLand: BASIC_LAND_NAMES.has(card.name),
    correction: normalizeName(card.name) !== normalizeName(item.inputName)
  };
}
async function resolveExactBatch(batch, batchNumber, setMessage) {
  let lastResult = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    setMessage(attempt === 1 ? `Exact lookup batch ${batchNumber}...` : `Exact lookup batch ${batchNumber} retry ${attempt}...`);
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
        note: result.status && result.status !== 404 ? `Exact lookup failed (${result.status})` : ""
      });
    }
    await sleep(250);
  }
  return resolved;
}
function rarityBucket(item) {
  const eligiblePrintRarities = item.nonSecretRarities?.length ? item.nonSecretRarities : item.eligibleRarityChecked ? [] : [item.card?.rarity].filter(Boolean);
  const compatibleStatedRarities = (item.statedRarities || []).filter((rarity) => eligiblePrintRarities.includes(rarity));
  const printRarities = compatibleStatedRarities.length ? compatibleStatedRarities : eligiblePrintRarities;
  const rarities = new Set([
    ...printRarities
  ].filter(Boolean));
  const hasHigh = rarities.has("rare") || rarities.has("mythic");
  const hasLow = rarities.has("common") || rarities.has("uncommon");
  if (hasHigh && hasLow) return "both";
  if (hasHigh) return "high";
  return "low";
}
function displayName(item) {
  return item.card?.name || titleCaseFallback(item.inputName);
}
function alternateTitleNote(item) {
  return item.alternateTitle ? ` (${item.alternateTitle})` : "";
}
function tokenDetailsNote(item) {
  return item.tokenDetails?.length ? ` (${item.tokenDetails.join(", ")})` : "";
}
function sortByName(a, b) {
  return displayName(a).localeCompare(displayName(b), void 0, { sensitivity: "base" });
}
function sortBasicLands(a, b) {
  return BASIC_LAND_ORDER.indexOf(displayName(a)) - BASIC_LAND_ORDER.indexOf(displayName(b));
}
function formatCardLine(item, useCheckboxes) {
  const specialNote = specialRequestNote(item);
  const caseNote = item.caseNote ? ` - ${item.caseNote}` : "";
  const reviewNote = item.status !== "found" && item.note ? ` (${item.note})` : "";
  return `${useCheckboxes ? "[ ] " : ""}${item.quantity} ${displayName(item)}${alternateTitleNote(item)}${tokenDetailsNote(item)}${specialNote}${caseNote}${reviewNote}`;
}
function formatContactLine(contact) {
  if (!contact) return "";
  const normalized = mergeContactValues(contact);
  if (/^facebook$/i.test(normalized)) return "(Facebook)";
  return normalized;
}
function formatCustomerName(name) {
  return name.trim().split(/\s+/).map((word) => word.toLowerCase().replace(/(^|[-'])([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`)).join(" ");
}
function formatTimestamp(value) {
  const date = value ? new Date(value) : /* @__PURE__ */ new Date();
  return new Intl.DateTimeFormat(void 0, {
    timeZone: "America/Chicago",
    month: "numeric",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}
function isBoundaryNameCandidate(item, cardLineCount) {
  if (!item || item.status === "found") return false;
  if (item.quantity !== 1 || item.statedRarities?.length || item.specialRequests?.length) return false;
  if (item.index > 1 && item.index < cardLineCount - 2) return false;
  const words = item.inputName.trim().split(/\s+/);
  if (words.length < 2 || words.length > 5) return false;
  if (/\d|@|[!?]/.test(item.inputName)) return false;
  return words.every((word) => /^[A-Za-z.'-]+$/.test(word));
}
function isBoundaryNameFragment(item, expectedIndex) {
  if (!item || item.status === "found" || item.index !== expectedIndex) return false;
  if (item.quantity !== 1 || item.statedRarities?.length || item.specialRequests?.length) return false;
  if (/\d|@|[!?]/.test(item.inputName)) return false;
  return /^[A-Za-z.'-]+$/.test(item.inputName.trim());
}
function inferBoundaryCustomer(customer, items, cardLineCount) {
  if (customer.name) return { customer, items };
  const candidate = items.find((item) => isBoundaryNameCandidate(item, cardLineCount));
  if (candidate) {
    return {
      customer: { ...customer, name: candidate.inputName },
      items: items.filter((item) => item !== candidate)
    };
  }
  const firstName = items.find((item) => isBoundaryNameFragment(item, 0));
  const firstLast = items.find((item) => isBoundaryNameFragment(item, 1));
  if (firstName && firstLast) {
    return {
      customer: { ...customer, name: `${firstName.inputName} ${firstLast.inputName}` },
      items: items.filter((item) => item !== firstName && item !== firstLast)
    };
  }
  const lastName = items.find((item) => isBoundaryNameFragment(item, cardLineCount - 2));
  const lastLast = items.find((item) => isBoundaryNameFragment(item, cardLineCount - 1));
  if (lastName && lastLast) {
    return {
      customer: { ...customer, name: `${lastName.inputName} ${lastLast.inputName}` },
      items: items.filter((item) => item !== lastName && item !== lastLast)
    };
  }
  return { customer, items };
}
function formatOutput(customer, items, useCheckboxes, processedAt) {
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
function safeFileName(customer, processedAtValue) {
  const base = customer.name ? formatCustomerName(customer.name) : "pull-list";
  const date = processedAtValue ? new Date(processedAtValue) : /* @__PURE__ */ new Date();
  const datePart = [
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    String(date.getFullYear()).slice(-2)
  ].join("-");
  const namePart = base.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "pull-list";
  return `${namePart}-${datePart}.txt`;
}
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
      printLookupFailed: false
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
      alternateTitle: ""
    };
  }
  const facts = await fetchPrintFacts(item.card);
  const enrichedItem = { ...item, ...facts };
  const notPlayablePaper = !facts.printLookupFailed && !hasPlayablePaperPrint(facts.prints);
  const specialRequestMissing = hasSpecialPrintRequest(item) && !facts.printLookupFailed && !facts.prints?.some((print) => printMatchesSpecialRequests(print, item));
  const ambiguousNonPlayable = notPlayablePaper && await hasAmbiguousPlayableName(item.inputName);
  return {
    ...enrichedItem,
    status: specialRequestMissing || notPlayablePaper ? "review" : item.status,
    caseNote: caseCheck ? caseNoteForItem(enrichedItem, recentCaseSets) : "",
    alternateTitle: requestedFlavorName(item, facts.prints),
    note: specialRequestMissing ? specialRequestReviewNote(item) : notPlayablePaper ? ambiguousNonPlayable ? "Ambiguous card name" : "Not a playable paper card" : item.note
  };
}
async function retryFailedPrintHistories(items, caseCheck, recentCaseSets, delayMs, passLabel, setMessage) {
  const retriedItems = [...items];
  const failedIndexes = retriedItems.map((item, index) => ({ item, index })).filter(({ item }) => item.status === "found" && item.printLookupFailed);
  for (const [retryIndex, { item, index }] of failedIndexes.entries()) {
    setMessage(`${passLabel}: Scryfall threw an error, retrying print history ${retryIndex + 1} of ${failedIndexes.length}...`);
    if (retryIndex > 0) await sleep(delayMs);
    const retriedItem = await enrichResolvedItem(
      { ...item, printLookupFailed: false },
      caseCheck,
      recentCaseSets
    );
    retriedItems[index] = { ...retriedItem, printHistoryRetried: true };
  }
  return retriedItems;
}
async function resolveCardNames(items, setMessage, carefulMode) {
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
      card && !ambiguous ? resolveItemWithCard(item, card) : {
        ...item,
        status: "review",
        note: ambiguous ? "Ambiguous card name" : item.note ? item.note.includes("not a playable paper card") ? "Not a playable paper card" : fuzzyResult.status && fuzzyResult.status !== 404 ? `${item.note}; fuzzy lookup failed (${fuzzyResult.status})` : `${item.note}; no fuzzy Scryfall match` : fuzzyResult.status && fuzzyResult.status !== 404 ? `Fuzzy lookup failed (${fuzzyResult.status})` : "No Scryfall match"
      }
    );
    await sleep(carefulMode ? 500 : 250);
  }
  return fuzzyResolved;
}
async function enrichPrintHistories(items, caseCheck, recentCaseSets, setMessage, carefulMode) {
  let withRarities = [];
  const concurrency = carefulMode ? 1 : PRINT_FACT_CONCURRENCY;
  const printGroups = chunk(items, concurrency);
  for (const [groupIndex, group] of printGroups.entries()) {
    const starting = groupIndex * concurrency + 1;
    const ending = Math.min(starting + group.length - 1, items.length);
    setMessage(`Working through Scryfall print history ${starting}-${ending} of ${items.length}...`);
    const enrichedGroup = await Promise.all(
      group.map((item) => enrichResolvedItem(item, caseCheck, recentCaseSets))
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
    setMessage
  );
  withRarities = await retryFailedPrintHistories(
    withRarities,
    caseCheck,
    recentCaseSets,
    2e3,
    "Third pass",
    setMessage
  );
  return withRarities;
}
function reliabilityMessage(items) {
  const retryCount = items.filter((item) => item.printHistoryRetried).length;
  const fallbackCount = items.filter((item) => item.status === "found" && item.printLookupFailed).length;
  if (fallbackCount) return `${fallbackCount} card${fallbackCount === 1 ? "" : "s"} used fallback rarity.`;
  if (retryCount) return `Scryfall needed print-history retries for ${retryCount} card${retryCount === 1 ? "" : "s"}.`;
  return "";
}
async function processPullListText(text, options = {}) {
  const {
    useCheckboxes = true,
    caseCheck = false,
    carefulMode = false,
    processedAt = (/* @__PURE__ */ new Date()).toISOString(),
    setMessage = () => {
    }
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
      reliabilityNote: reliabilityMessage(inferred.items)
    };
  } finally {
    endScryfallRun();
  }
}
export {
  beginScryfallRun,
  createSampleList,
  endScryfallRun,
  enrichPrintHistories,
  fetchRecentCaseSets,
  formatOutput,
  inferBoundaryCustomer,
  parsePullList,
  processPullListText,
  reliabilityMessage,
  resolveCardNames,
  safeFileName
};

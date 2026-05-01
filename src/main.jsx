import React, { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Check,
  Clipboard,
  Copy,
  Download,
  Loader2,
  Printer,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import "./styles.css";
import rrgLogo from "../images/LOGO_PNG_HEADER.png";

const SCRYFALL_COLLECTION_URL = "https://api.scryfall.com/cards/collection";
const SCRYFALL_NAMED_URL = "https://api.scryfall.com/cards/named";
const SCRYFALL_SEARCH_URL = "https://api.scryfall.com/cards/search";
const SCRYFALL_SETS_URL = "https://api.scryfall.com/sets";
const BATCH_SIZE = 75;
const PRINT_FACT_CONCURRENCY = 5;
const STORE_EMAIL_PATTERN = /\binfo@redraccoongames\.com\b/i;

const sampleList = `Gavin Verhey
206-555-5265

1 Chub Toad - G unc
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

function normalizeName(value) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w/ ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactName(value) {
  return normalizeName(value).replace(/\s+/g, "");
}

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatPhoneNumber(value) {
  const digits = value.replace(/\D/g, "");
  const tenDigits = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (tenDigits.length !== 10) return value.trim();
  return `${tenDigits.slice(0, 3)}-${tenDigits.slice(3, 6)}-${tenDigits.slice(6)}`;
}

function normalizeContactValue(value) {
  const trimmed = value.trim();
  if (/(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/.test(trimmed)) {
    return formatPhoneNumber(trimmed);
  }
  return trimmed;
}

function extractContact(line) {
  const headerFromMatch = line.match(/\bpull\s+list\s+from\s+(.+?)(?:\s+on\s+facebook|\s+\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|$)/i);
  if (headerFromMatch) {
    return {
      name: headerFromMatch[1].trim(),
      contact: /\bfacebook\b/i.test(line) ? "facebook" : "",
    };
  }

  const headerForMatch = line.match(/\bpull\s+list\s+for\s+(.+)$/i);
  if (headerForMatch) {
    return {
      name: headerForMatch[1].trim(),
      contact: "",
    };
  }

  const bracketMatch = line.match(/^([^<]+)<([^>]+)>$/);
  if (bracketMatch) {
    return {
      name: bracketMatch[1].trim(),
      contact: normalizeContactValue(bracketMatch[2]),
    };
  }

  const email = line.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || "";
  const phone = line.match(/(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/)?.[0] || "";
  const facebook = /\bfacebook\b|\bfb\b/i.test(line) ? "facebook" : "";
  const contact = email || phone || facebook;

  if (!contact) return { name: line.trim(), contact: "" };

  return {
    name: line.replace(contact, "").replace(/\s+/g, " ").trim(),
    contact: normalizeContactValue(contact),
  };
}

function isSeparatorLine(line) {
  return /^[-_=]{4,}$/.test(line.trim());
}

function isLikelyNoteLine(line) {
  const normalized = normalizeName(line);
  if (!normalized) return true;
  if (STORE_EMAIL_PATTERN.test(line)) return true;
  if (/^(hello|hi|hey|thanks|thank you|just one of each|i will|i'm|im|these are|please|mtg pull list from|mtg pull list for)\b/i.test(line)) {
    return true;
  }
  return /[!?]$/.test(line) && normalized.split(" ").length > 4;
}

function hasContactOrHeader(line) {
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(line)
    || /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/.test(line)
    || /\bpull\s+list\s+(from|for)\b/i.test(line)
    || /\bfacebook\b|\bfb\b/i.test(line);
}

function parseCustomerAndCards(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const customer = { name: "", contact: "" };
  const cardLines = [];

  for (const line of lines) {
    if (isSeparatorLine(line) || STORE_EMAIL_PATTERN.test(line)) continue;

    if (hasContactOrHeader(line)) {
      const parsed = extractContact(line);
      customer.name = customer.name || parsed.name;
      customer.contact = customer.contact || parsed.contact;
      continue;
    }

    if (isLikelyNoteLine(line)) continue;
    cardLines.push(line);
  }

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
  return value
    .split(/[,/]+|\band\b/i)
    .map((part) => parseRarity(part.trim()))
    .filter(Boolean);
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
  return SPECIAL_REQUEST_PATTERNS
    .filter(({ pattern }) => pattern.test(value))
    .map(({ label }) => label);
}

function stripSpecialRequests(value) {
  return SPECIAL_REQUEST_PATTERNS.reduce(
    (current, { pattern }) => current.replace(pattern, ""),
    value,
  );
}

function cleanCardName(value) {
  return value
    .replace(/[•*]/g, "")
    .replace(/\([^)]*\)\s*\d*$/g, "")
    .replace(/\[[^\]]+\]\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanLookupName(value) {
  return cleanCardName(stripSpecialRequests(value));
}

function mergeSpecialRequests(a = [], b = []) {
  return Array.from(new Set([...a, ...b]));
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
    ...(print.card_faces || []).map((face) => face.flavor_name),
  ]).filter(Boolean);
  const match = flavorNames.find((flavorName) => (
    normalizeName(flavorName) === inputNormalized
      || compactName(flavorName) === inputCompact
  ));

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

  const trailingRarityMatch = line.match(/\s+(mythic rare|mythic|rare|uncommon|common|mr|unc|com|uc|m|r|u|c)$/i);
  if (trailingRarityMatch) {
    statedRarities.push(...parseRarities(trailingRarityMatch[1]));
    line = line.slice(0, trailingRarityMatch.index).trim();
  }

  const inputName = cleanLookupName(line);
  if (!inputName) return null;

  return {
    index,
    original: rawLine,
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    inputName,
    statedRarities: Array.from(new Set(statedRarities)),
    specialRequests: Array.from(new Set(specialRequests)),
    lookupKey: normalizeName(inputName),
  };
}

function parsePullList(text) {
  const { customer, cardLines } = parseCustomerAndCards(text);
  const normalizedCardLines = normalizeCopiedTableLines(cardLines);
  const grouped = new Map();

  normalizedCardLines.forEach((line, index) => {
    const item = parseCardLine(line, index);
    if (!item) return;

    const existing = grouped.get(item.lookupKey);
    if (existing) {
      existing.quantity += item.quantity;
      existing.originals.push(item.original);
      existing.statedRarities = Array.from(new Set([...existing.statedRarities, ...item.statedRarities]));
      existing.specialRequests = mergeSpecialRequests(existing.specialRequests, item.specialRequests);
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
  let lastError;
  let lastStatus = 0;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      lastStatus = response.status;

      if (response.status === 429 && attempt < attempts) {
        const retryAfter = Number(response.headers.get("Retry-After")) || 1;
        await sleep(Math.max(retryAfter * 1000, 1200 * attempt));
        continue;
      }

      if (!response.ok) {
        return { ok: false, status: response.status, data: null };
      }

      return { ok: true, status: response.status, data: await response.json() };
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(600 * attempt);
    }
  }

  return { ok: false, status: lastStatus, data: null, error: lastError };
}

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

async function fetchNamedCard(name, mode = "fuzzy") {
  const params = new URLSearchParams({ [mode]: name });
  const result = await fetchJsonWithRetry(`${SCRYFALL_NAMED_URL}?${params.toString()}`, {
    headers: { Accept: "application/json;q=0.9,*/*;q=0.8" },
  });

  return result.ok ? result.data : null;
}

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
  return /^sl[dupc]?$/i.test(print?.set || "")
    || /\bsecret\s+lair\b/i.test(print?.set_name || "");
}

function isPlayerRewardPrint(print) {
  return /\bplayer\s+rewards?\b/i.test(print?.set_name || "")
    || /^mpr$/i.test(print?.set || "");
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
    headers: { Accept: "application/json;q=0.9,*/*;q=0.8" },
  });

  if (!result.ok) return [];

  const today = new Date();
  today.setHours(23, 59, 59, 999);

  return (result.data.data || [])
    .filter((set) => !set.digital)
    .filter((set) => CASE_RELEVANT_SET_TYPES.has(set.set_type))
    .filter((set) => set.released_at && new Date(`${set.released_at}T00:00:00`) <= today)
    .sort((a, b) => new Date(b.released_at) - new Date(a.released_at))
    .slice(0, 5)
    .map((set, index) => ({ code: set.code, index, name: set.name }));
}

function caseNoteForItem(item, recentSets) {
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

function displayName(item) {
  return item.card?.name || titleCaseFallback(item.inputName);
}

function alternateTitleNote(item) {
  return item.alternateTitle ? ` (${item.alternateTitle})` : "";
}

function sortByName(a, b) {
  return displayName(a).localeCompare(displayName(b), undefined, { sensitivity: "base" });
}

function sortBasicLands(a, b) {
  return BASIC_LAND_ORDER.indexOf(displayName(a)) - BASIC_LAND_ORDER.indexOf(displayName(b));
}

function formatCardLine(item, useCheckboxes) {
  const specialNote = specialRequestNote(item);
  const caseNote = item.caseNote ? ` - ${item.caseNote}` : "";
  const reviewNote = item.status !== "found" && item.note ? ` (${item.note})` : "";
  return `${useCheckboxes ? "[ ] " : ""}${item.quantity} ${displayName(item)}${alternateTitleNote(item)}${specialNote}${caseNote}${reviewNote}`;
}

function formatContactLine(contact) {
  if (!contact) return "";
  const normalized = normalizeContactValue(contact);
  if (/^facebook$/i.test(normalized)) return "(Facebook)";
  return normalized;
}

function formatCustomerName(name) {
  return name
    .trim()
    .split(/\s+/)
    .map((word) => word
      .toLowerCase()
      .replace(/(^|[-'])([a-z])/g, (_, prefix, letter) => `${prefix}${letter.toUpperCase()}`))
    .join(" ");
}

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

function formatOutput(customer, items, useCheckboxes, processedAt) {
  const found = items.filter((item) => item.status === "found");
  const needsReview = items.filter((item) => item.status !== "found");
  const basics = found.filter((item) => item.isBasicLand).sort(sortBasicLands);
  const nonBasics = found.filter((item) => !item.isBasicLand);
  const high = nonBasics.filter((item) => rarityBucket(item) === "high").sort(sortByName);
  const both = nonBasics.filter((item) => rarityBucket(item) === "both").sort(sortByName);
  const low = nonBasics.filter((item) => rarityBucket(item) === "low").sort(sortByName);
  const lines = [];

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
    lines.push("=== Both Rarities ===");
    both.forEach((item) => lines.push(formatCardLine(item, useCheckboxes)));
  }

  if (low.length) {
    if (lines.at(-1) !== "") lines.push("");
    lines.push("=== Uncommon/Common ===");
    low.forEach((item) => lines.push(formatCardLine(item, useCheckboxes)));
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

  return lines.join("\n");
}

function safeFileName(customer) {
  const base = customer.name || "pull-list";
  return `${base.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "pull-list"}.txt`;
}

async function enrichResolvedItem(item, caseCheck, recentCaseSets) {
  if (item.status !== "found") return item;

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
  const notPlayablePaper = !hasPlayablePaperPrint(facts.prints);
  const specialRequestMissing = hasSpecialPrintRequest(item)
    && !facts.printLookupFailed
    && !facts.prints?.some((print) => printMatchesSpecialRequests(print, item));
  const ambiguousNonPlayable = notPlayablePaper && await hasAmbiguousPlayableName(item.inputName);

  return {
    ...enrichedItem,
    status: specialRequestMissing || facts.printLookupFailed || notPlayablePaper ? "review" : item.status,
    caseNote: caseCheck ? caseNoteForItem(enrichedItem, recentCaseSets) : "",
    alternateTitle: requestedFlavorName(item, facts.prints),
    note: specialRequestMissing
      ? specialRequestReviewNote(item)
      : facts.printLookupFailed
        ? "Print history lookup failed"
        : notPlayablePaper
          ? ambiguousNonPlayable ? "Ambiguous card name" : "Not a playable paper card"
          : item.note,
  };
}

function IconButton({ children, onClick, title, disabled = false, variant = "secondary" }) {
  return (
    <button className={`icon-button ${variant}`} onClick={onClick} title={title} disabled={disabled}>
      {children}
    </button>
  );
}

function App() {
  const [input, setInput] = useState(sampleList);
  const [resolvedItems, setResolvedItems] = useState([]);
  const [processedCustomer, setProcessedCustomer] = useState(null);
  const [processedAt, setProcessedAt] = useState(null);
  const [useCheckboxes, setUseCheckboxes] = useState(true);
  const [caseCheck, setCaseCheck] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [message, setMessage] = useState("Paste a customer list, then process.");

  const parsed = useMemo(() => parsePullList(input), [input]);
  const outputCustomer = processedCustomer || parsed.customer;
  const output = useMemo(
    () => (resolvedItems.length ? formatOutput(outputCustomer, resolvedItems, useCheckboxes, processedAt) : ""),
    [outputCustomer, resolvedItems, useCheckboxes, processedAt],
  );
  const totalQuantity = parsed.cards.reduce((sum, item) => sum + item.quantity, 0);
  const needsReview = resolvedItems.filter((item) => item.status !== "found").length;

  async function processList() {
    if (!parsed.cards.length) {
      setMessage("No card lines found yet.");
      return;
    }

    setIsProcessing(true);
    setMessage(`Checking ${parsed.cards.length} unique card names with Scryfall...`);

    try {
      let recentCaseSets = [];
      if (caseCheck) {
        setMessage("Checking recent set list for case rules...");
        recentCaseSets = await fetchRecentCaseSets();
      }

      const firstPass = [];
      const exactBatches = chunk(parsed.cards, BATCH_SIZE);
      for (const [batchIndex, batch] of exactBatches.entries()) {
        setMessage(`Exact lookup batch ${batchIndex + 1}...`);
        const result = await fetchCollection(batch);
        if (result.ok) {
          firstPass.push(...mergeResolvedCards(batch, result.data));
        } else {
          firstPass.push(...batch.map((item) => ({
            ...item,
            status: "missing",
            note: result.status ? `Exact batch lookup failed (${result.status})` : "Exact batch lookup failed",
          })));
        }
        await sleep(150);
      }

      const fuzzyResolved = [];
      for (const item of firstPass) {
        if (item.status === "found" || item.status === "review") {
          fuzzyResolved.push(item);
          continue;
        }

        setMessage(`Trying fuzzy match for "${item.inputName}"...`);
        const card = await fetchNamedCard(item.inputName, "fuzzy");
        const ambiguous = card && await isAmbiguousFuzzyMatch(item.inputName, card);
        fuzzyResolved.push(
          card && !ambiguous
            ? {
              ...item,
              card,
              status: "found",
              isBasicLand: BASIC_LAND_NAMES.has(card.name),
              correction: normalizeName(card.name) !== normalizeName(item.inputName),
            }
            : {
              ...item,
              status: "review",
              note: ambiguous
                ? "Ambiguous card name"
                : item.note
                  ? item.note.includes("not a playable paper card")
                    ? "Not a playable paper card"
                    : `${item.note}; no fuzzy Scryfall match`
                  : "No Scryfall match",
            },
        );
        await sleep(250);
      }

      const withRarities = [];
      const printGroups = chunk(fuzzyResolved, PRINT_FACT_CONCURRENCY);
      for (const [groupIndex, group] of printGroups.entries()) {
        const starting = groupIndex * PRINT_FACT_CONCURRENCY + 1;
        const ending = Math.min(starting + group.length - 1, fuzzyResolved.length);
        setMessage(`Working through Scryfall print history ${starting}-${ending} of ${fuzzyResolved.length}...`);
        const enrichedGroup = await Promise.all(
          group.map((item) => enrichResolvedItem(item, caseCheck, recentCaseSets)),
        );
        withRarities.push(...enrichedGroup);
        await sleep(250);
      }

      const inferred = inferBoundaryCustomer(parsed.customer, withRarities, parsed.cardLineCount);
      setProcessedCustomer(inferred.customer);
      setResolvedItems(inferred.items);
      setProcessedAt(new Date().toISOString());
      const reviewCount = inferred.items.filter((item) => item.status !== "found").length;
      setMessage(reviewCount ? `${reviewCount} line${reviewCount === 1 ? "" : "s"} need review.` : "List formatted.");
    } catch (error) {
      setMessage(error.message || "Something went wrong while processing.");
    } finally {
      setIsProcessing(false);
    }
  }

  async function copyOutput() {
    if (!output) return;
    await navigator.clipboard.writeText(output);
    setMessage("Output copied.");
  }

  function downloadOutput() {
    if (!output) return;
    const blob = new Blob([output], { type: "text/plain;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = safeFileName(outputCustomer);
    link.click();
    URL.revokeObjectURL(link.href);
    setMessage("Text file downloaded.");
  }

  function printOutput() {
    if (!output) return;

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      setMessage("Print window was blocked.");
      return;
    }

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>${safeFileName(outputCustomer)}</title>
          <style>
            body { font-family: Consolas, monospace; font-size: 11pt; line-height: 1.35; white-space: pre-wrap; }
          </style>
        </head>
        <body>${output.replace(/[&<>"']/g, (char) => ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#039;",
        }[char]))}</body>
      </html>
    `);
    printWindow.document.close();
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 100);
  }

  function handleInputChange(value) {
    setInput(value);
    setResolvedItems([]);
    setProcessedCustomer(null);
    setProcessedAt(null);
    setMessage("Input changed. Process again when ready.");
  }

  return (
    <main className="app-shell">
      <section className="formatter">
        <header className="app-header">
          <div className="logo-slot">
            <img src={rrgLogo} alt="Red Raccoon Games logo" />
          </div>
          <div>
            <div className="title-row">
              <h1>RRG Pull List Formatter</h1>
              <span>v0.2</span>
            </div>
          </div>
          <div className="logo-slot logo-slot-right" aria-hidden="true">
            <img src={rrgLogo} alt="" />
          </div>
        </header>

        <section className="input-section">
          <div className="section-heading">
            <h2>Input Text</h2>
            <div className="actions">
              <label className="checkbox-option help-option" title="Still working on this!">
                <input
                  type="checkbox"
                  checked={caseCheck}
                  onChange={(event) => {
                    setCaseCheck(event.target.checked);
                    setResolvedItems([]);
                    setProcessedCustomer(null);
                    setProcessedAt(null);
                    setMessage("Case check setting changed. Process again when ready.");
                  }}
                />
                Case Check
              </label>
              <span className="checkbox-option disabled-option" title="Coming Soon">
                <Sparkles size={16} />
                Smart Cleanup
              </span>
              <IconButton onClick={() => handleInputChange("")} title="Clear input">
                <Trash2 size={18} />
              </IconButton>
              <IconButton onClick={processList} title="Process list" disabled={isProcessing} variant="primary">
                {isProcessing ? <Loader2 size={18} className="spin" /> : <Search size={18} />}
                <span>Process</span>
              </IconButton>
            </div>
          </div>

          <textarea
            className="input-box"
            value={input}
            onChange={(event) => handleInputChange(event.target.value)}
            spellCheck="false"
            aria-label="Raw pull list text"
          />
        </section>

        <section className="output-section">
          <div className="section-heading">
            <div>
              <h2>Output Text</h2>
              <p>{parsed.cards.length} unique / {totalQuantity} total cards</p>
            </div>
            <div className="actions">
              <label className="checkbox-option">
                <input
                  type="checkbox"
                  checked={useCheckboxes}
                  onChange={(event) => setUseCheckboxes(event.target.checked)}
                />
                Checkboxes
              </label>
              <IconButton onClick={copyOutput} title="Copy output" disabled={!output}>
                <Copy size={18} />
              </IconButton>
              <IconButton onClick={downloadOutput} title="Download .txt" disabled={!output}>
                <Download size={18} />
              </IconButton>
              <IconButton onClick={printOutput} title="Print output" disabled={!output}>
                <Printer size={18} />
              </IconButton>
            </div>
          </div>

          <textarea
            className="output-box"
            value={output || "Processed output will appear here! :-)"}
            readOnly
            aria-label="Formatted output text"
            onFocus={(event) => event.target.select()}
          />
        </section>

        <footer className="status-bar" aria-live="polite">
          <strong>{message}</strong>
          <div className="status-counts">
            <span><Clipboard size={17} /> {parsed.cards.length} parsed</span>
            <span><Check size={17} /> {resolvedItems.length - needsReview} resolved</span>
          </div>
        </footer>

        <p className="work-note">Still working on this, let me know if you come across any weirdness! -Derek</p>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);

// src/pricing.ts
var FINISH_LABELS = {
  normal: "Nonfoil",
  foil: "Foil",
  etched: "Etched"
};
var TREATMENT_LABELS = {
  standard: "Standard",
  "full-art": "Full Art",
  showcase: "Showcase",
  borderless: "Borderless",
  "extended-art": "Extended Art",
  retro: "Retro Frame",
  special: "Special"
};
var TREATMENT_ABBREVIATIONS = {
  standard: "Std",
  "full-art": "Full Art",
  showcase: "Showcase",
  borderless: "Borderless",
  "extended-art": "Extended",
  retro: "Retro",
  special: "Special"
};
var LEGACY_MTGJSON_PRICE_SOURCES = [
  { key: "tcgplayer:retail", provider: "tcgplayer", listType: "retail", currency: "USD" },
  { key: "cardkingdom:retail", provider: "cardkingdom", listType: "retail", currency: "USD" }
];
function mtgjsonPriceSourceLabel(source) {
  const providerLabels = {
    cardkingdom: "Card Kingdom",
    cardmarket: "Cardmarket",
    cardsphere: "Cardsphere",
    manapool: "Mana Pool",
    tcgplayer: "TCGplayer"
  };
  const provider = providerLabels[source.provider] || source.provider.replace(/\b\w/g, (letter) => letter.toUpperCase());
  return `MTGJSON \xB7 ${provider} ${source.listType === "buylist" ? "Buylist" : "Retail"}${source.currency && source.currency !== "USD" ? ` (${source.currency})` : ""}`;
}
function priceCurrencySymbol(currency = "USD") {
  if (currency === "EUR") return "\u20AC";
  if (currency === "GBP") return "\xA3";
  return currency === "USD" ? "$" : `${currency} `;
}
function pricingNameKey(value) {
  return String(value || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w/ ]+/g, "").replace(/\s+/g, " ").trim();
}
function pricingShardKey(value) {
  const first = pricingNameKey(value).charAt(0);
  return /^[a-z0-9]$/.test(first) ? first : "_";
}
function cardFromCatalog(catalog, name) {
  return catalog[pricingNameKey(name)] || null;
}
function editionOptions(card) {
  if (!card) return [];
  const editions = /* @__PURE__ */ new Map();
  card.printings.forEach((printing) => {
    const existing = editions.get(printing.setCode);
    if (!existing || printing.releaseDate > existing.releaseDate) {
      editions.set(printing.setCode, {
        setCode: printing.setCode,
        setName: printing.setName,
        keyruneCode: printing.keyruneCode,
        releaseDate: printing.releaseDate
      });
    }
  });
  return Array.from(editions.values()).sort((a, b) => b.releaseDate.localeCompare(a.releaseDate) || a.setCode.localeCompare(b.setCode));
}
function preferredDefaultEdition(card) {
  const editions = editionOptions(card);
  return editions.find((edition) => edition.setCode.toUpperCase() !== "SLD" && !/secret\s+lair/i.test(edition.setName)) || editions[0] || null;
}
function treatmentOptions(card, setCode) {
  if (!card || !setCode) return ["standard"];
  const values = new Set(
    card.printings.filter((printing) => printing.setCode === setCode).flatMap((printing) => printing.treatments || ["standard"])
  );
  values.add("standard");
  return Array.from(values).sort((a, b) => {
    if (a === "standard") return -1;
    if (b === "standard") return 1;
    return (TREATMENT_LABELS[a] || a).localeCompare(TREATMENT_LABELS[b] || b);
  });
}
function finishOptions(card, setCode, treatment) {
  if (!card || !setCode) return ["normal", "foil", "etched"];
  const values = /* @__PURE__ */ new Set();
  card.printings.filter((printing) => printing.setCode === setCode).filter((printing) => printing.treatments.includes(treatment)).forEach((printing) => printing.finishes.forEach((finish) => values.add(finish)));
  if (!values.size) values.add("normal");
  return ["normal", "foil", "etched"].filter((finish) => values.has(finish));
}
function printingsForSelection(card, setCode, treatment, finish) {
  if (!card || !setCode) return [];
  return card.printings.filter((printing) => printing.setCode === setCode).filter((printing) => printing.treatments.includes(treatment)).filter((printing) => printing.finishes.includes(finish));
}
function tcgplayerProductIdForSelection(card, setCode, treatment, finish) {
  const productIds = Array.from(new Set(
    printingsForSelection(card, setCode, treatment, finish).map((printing) => finish === "etched" ? printing.tcgplayerEtchedProductId || printing.tcgplayerProductId : printing.tcgplayerProductId).filter(Boolean)
  ));
  return productIds.length === 1 ? productIds[0] : "";
}
function listedMedianPriceForFinish(points, finish) {
  const point = points.find((candidate) => {
    const printingType = String(candidate.printingType || "").toLowerCase();
    if (printingType.includes("etched")) return finish === "etched";
    if (finish === "foil") return printingType.includes("foil");
    if (finish === "normal" && printingType === "storefront") return true;
    return finish === "normal" && (printingType.includes("normal") || printingType.includes("nonfoil"));
  });
  const value = finish === "foil" ? point?.marketPrice : point?.listedMedianPrice;
  return typeof value === "number" && Number.isFinite(value) ? Math.round((value + Number.EPSILON) * 100) / 100 : null;
}
function priceForSelection(card, setCode, treatment, finish, priceSource = "tcgplayer:retail") {
  if (!setCode) {
    return {
      status: "select-printing",
      price: null,
      source: "",
      message: "Choose a printing before pricing this card."
    };
  }
  if (!card) {
    return {
      status: "unavailable",
      price: null,
      source: "",
      message: "No MTGJSON printing data matched this card. Enter the details and price manually."
    };
  }
  const candidates = printingsForSelection(card, setCode, treatment, finish);
  const priced = candidates.map((printing) => {
    const indexedPrice = printing.priceListings?.[finish]?.[priceSource];
    if (indexedPrice) return indexedPrice;
    const legacyPrice = printing.prices[finish];
    const legacySource = legacyPrice?.source === "tcgplayer" ? "tcgplayer:retail" : legacyPrice?.source === "cardkingdom" ? "cardkingdom:retail" : legacyPrice?.source;
    return legacySource === priceSource ? legacyPrice : null;
  }).filter((price) => Boolean(price && Number.isFinite(price.value)));
  if (!candidates.length || !priced.length) {
    return {
      status: "unavailable",
      price: null,
      source: "",
      message: "No price is available for that printing, treatment, and finish. Enter a price manually."
    };
  }
  const distinctPrices = Array.from(new Set(priced.map((price) => price.value.toFixed(2))));
  if (distinctPrices.length > 1) {
    return {
      status: "ambiguous",
      price: null,
      source: "",
      message: "Multiple matching collector variants have different prices. Enter the exact price manually."
    };
  }
  const selected = priced[0];
  const [provider, listType] = priceSource.split(":");
  const sourceOption = {
    key: priceSource,
    provider,
    listType: listType === "buylist" ? "buylist" : "retail",
    currency: selected.currency || "USD"
  };
  return {
    status: "ready",
    price: selected.value,
    source: priceSource,
    message: mtgjsonPriceSourceLabel(sourceOption)
  };
}
function parsePrice(value) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  const cleaned = String(value ?? "").trim().replace(/^\$/, "");
  if (!/^\d+(?:\.\d{0,2})?$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}
function formatPrice(value) {
  return value === null || !Number.isFinite(value) ? "" : value.toFixed(2);
}
function minimumPriceForSelection(isBasicLand, treatment, finish) {
  return isBasicLand && treatment === "standard" && finish === "normal" ? 0.05 : 0.25;
}
function applyMinimumPrice(price, isBasicLand, treatment, finish) {
  if (price === null) return null;
  return Math.max(price, minimumPriceForSelection(isBasicLand, treatment, finish));
}
function pricingQuantityMaximum(requestedQuantity, allocatedQuantity) {
  return Math.max(0, Math.floor(requestedQuantity) - Math.floor(allocatedQuantity));
}
function remainingRequestedQuantity(requestedQuantity, foundQuantities) {
  const foundQuantity = foundQuantities.reduce((sum, quantity) => sum + Math.max(0, Math.floor(Number(quantity) || 0)), 0);
  return Math.max(0, Math.floor(Number(requestedQuantity) || 0) - foundQuantity);
}
function priceWithListedMedianFallback(listedMedian, mtgjson) {
  if (listedMedian.status === "ready" && listedMedian.price !== null) return listedMedian;
  if (["loading", "select-printing"].includes(listedMedian.status)) return listedMedian;
  if (mtgjson.status !== "ready" || mtgjson.price === null) return listedMedian;
  return {
    ...mtgjson,
    message: `Using MTGJSON fallback (${mtgjson.message}) because ${listedMedian.message}`
  };
}
function tcgplayerCardSearchUrl(cardName) {
  return `https://www.tcgplayer.com/search/magic/product?productLineName=magic&q=${encodeURIComponent(cardName.trim())}&view=grid`;
}
function receiptTreatment(treatment, finish) {
  const treatmentLabel = TREATMENT_ABBREVIATIONS[treatment] || TREATMENT_LABELS[treatment] || treatment || "Std";
  if (finish === "foil") return `${treatmentLabel} Foil`;
  if (finish === "etched") return `${treatmentLabel} Etched`;
  return treatmentLabel;
}
export {
  FINISH_LABELS,
  LEGACY_MTGJSON_PRICE_SOURCES,
  TREATMENT_ABBREVIATIONS,
  TREATMENT_LABELS,
  applyMinimumPrice,
  cardFromCatalog,
  editionOptions,
  finishOptions,
  formatPrice,
  listedMedianPriceForFinish,
  minimumPriceForSelection,
  mtgjsonPriceSourceLabel,
  parsePrice,
  preferredDefaultEdition,
  priceCurrencySymbol,
  priceForSelection,
  priceWithListedMedianFallback,
  pricingNameKey,
  pricingQuantityMaximum,
  pricingShardKey,
  printingsForSelection,
  receiptTreatment,
  remainingRequestedQuantity,
  tcgplayerCardSearchUrl,
  tcgplayerProductIdForSelection,
  treatmentOptions
};

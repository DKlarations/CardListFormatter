export type PricingFinish = "normal" | "foil" | "etched";

export type PricingValue = {
  value: number;
  source: "tcgplayer" | "cardkingdom";
};

export type PricingPrinting = {
  uuid: string;
  tcgplayerProductId?: string;
  tcgplayerEtchedProductId?: string;
  setCode: string;
  setName: string;
  keyruneCode: string;
  releaseDate: string;
  number: string;
  rarity: string;
  treatments: string[];
  finishes: PricingFinish[];
  prices: Partial<Record<PricingFinish, PricingValue>>;
};

export type PricingCard = {
  name: string;
  printings: PricingPrinting[];
};

export type PricingCatalog = Record<string, PricingCard>;

export type PricingSelection = {
  status: "ready" | "loading" | "select-printing" | "unavailable" | "ambiguous";
  price: number | null;
  source: "tcgplayer" | "cardkingdom" | "tcgplayer-listed-median" | "";
  message: string;
};

export type TcgplayerPricePoint = {
  printingType: string;
  listedMedianPrice: number | null;
  marketPrice?: number | null;
};

export const FINISH_LABELS: Record<PricingFinish, string> = {
  normal: "Nonfoil",
  foil: "Foil",
  etched: "Etched",
};

export const TREATMENT_LABELS: Record<string, string> = {
  standard: "Standard",
  "full-art": "Full Art",
  showcase: "Showcase",
  borderless: "Borderless",
  "extended-art": "Extended Art",
  retro: "Retro Frame",
  special: "Special",
};

export const TREATMENT_ABBREVIATIONS: Record<string, string> = {
  standard: "Std",
  "full-art": "Full Art",
  showcase: "Showcase",
  borderless: "Borderless",
  "extended-art": "Extended",
  retro: "Retro",
  special: "Special",
};

export function pricingNameKey(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w/ ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function pricingShardKey(value: string) {
  const first = pricingNameKey(value).charAt(0);
  return /^[a-z0-9]$/.test(first) ? first : "_";
}

export function cardFromCatalog(catalog: PricingCatalog, name: string) {
  return catalog[pricingNameKey(name)] || null;
}

export function editionOptions(card: PricingCard | null) {
  if (!card) return [];

  const editions = new Map<string, {
    setCode: string;
    setName: string;
    keyruneCode: string;
    releaseDate: string;
  }>();

  card.printings.forEach((printing) => {
    const existing = editions.get(printing.setCode);
    if (!existing || printing.releaseDate > existing.releaseDate) {
      editions.set(printing.setCode, {
        setCode: printing.setCode,
        setName: printing.setName,
        keyruneCode: printing.keyruneCode,
        releaseDate: printing.releaseDate,
      });
    }
  });

  return Array.from(editions.values()).sort((a, b) => (
    b.releaseDate.localeCompare(a.releaseDate)
      || a.setCode.localeCompare(b.setCode)
  ));
}

export function treatmentOptions(card: PricingCard | null, setCode: string) {
  if (!card || !setCode) return ["standard"];
  const values = new Set(
    card.printings
      .filter((printing) => printing.setCode === setCode)
      .flatMap((printing) => printing.treatments || ["standard"]),
  );
  values.add("standard");
  return Array.from(values).sort((a, b) => {
    if (a === "standard") return -1;
    if (b === "standard") return 1;
    return (TREATMENT_LABELS[a] || a).localeCompare(TREATMENT_LABELS[b] || b);
  });
}

export function finishOptions(card: PricingCard | null, setCode: string, treatment: string) {
  if (!card || !setCode) return ["normal", "foil", "etched"] as PricingFinish[];
  const values = new Set<PricingFinish>();
  card.printings
    .filter((printing) => printing.setCode === setCode)
    .filter((printing) => printing.treatments.includes(treatment))
    .forEach((printing) => printing.finishes.forEach((finish) => values.add(finish)));
  if (!values.size) values.add("normal");
  return (["normal", "foil", "etched"] as PricingFinish[]).filter((finish) => values.has(finish));
}

export function printingsForSelection(
  card: PricingCard | null,
  setCode: string,
  treatment: string,
  finish: PricingFinish,
) {
  if (!card || !setCode) return [];
  return card.printings
    .filter((printing) => printing.setCode === setCode)
    .filter((printing) => printing.treatments.includes(treatment))
    .filter((printing) => printing.finishes.includes(finish));
}

export function tcgplayerProductIdForSelection(
  card: PricingCard | null,
  setCode: string,
  treatment: string,
  finish: PricingFinish,
) {
  const productIds = Array.from(new Set(
    printingsForSelection(card, setCode, treatment, finish)
      .map((printing) => (
        finish === "etched"
          ? printing.tcgplayerEtchedProductId || printing.tcgplayerProductId
          : printing.tcgplayerProductId
      ))
      .filter(Boolean),
  ));
  return productIds.length === 1 ? productIds[0] : "";
}

export function listedMedianPriceForFinish(points: TcgplayerPricePoint[], finish: PricingFinish) {
  const point = points.find((candidate) => {
    const printingType = String(candidate.printingType || "").toLowerCase();
    if (printingType.includes("etched")) return finish === "etched";
    if (finish === "foil") return printingType.includes("foil");
    if (finish === "normal" && printingType === "storefront") return true;
    return finish === "normal" && (printingType.includes("normal") || printingType.includes("nonfoil"));
  });
  // TCGplayer's Near Mint comparison table displays the foil market price.
  // Nonfoil continues to use the storefront Listed Median selected by this mode.
  const value = finish === "foil" ? point?.marketPrice : point?.listedMedianPrice;
  return typeof value === "number" && Number.isFinite(value)
    ? Math.round((value + Number.EPSILON) * 100) / 100
    : null;
}

export function priceForSelection(
  card: PricingCard | null,
  setCode: string,
  treatment: string,
  finish: PricingFinish,
): PricingSelection {
  if (!setCode) {
    return {
      status: "select-printing",
      price: null,
      source: "",
      message: "Choose a printing before pricing this card.",
    };
  }
  if (!card) {
    return {
      status: "unavailable",
      price: null,
      source: "",
      message: "No MTGJSON printing data matched this card. Enter the details and price manually.",
    };
  }

  const candidates = printingsForSelection(card, setCode, treatment, finish);
  const priced = candidates
    .map((printing) => printing.prices[finish])
    .filter((price): price is PricingValue => Boolean(price && Number.isFinite(price.value)));

  if (!candidates.length || !priced.length) {
    return {
      status: "unavailable",
      price: null,
      source: "",
      message: "No price is available for that printing, treatment, and finish. Enter a price manually.",
    };
  }

  const distinctPrices = Array.from(new Set(priced.map((price) => price.value.toFixed(2))));
  if (distinctPrices.length > 1) {
    return {
      status: "ambiguous",
      price: null,
      source: "",
      message: "Multiple matching collector variants have different prices. Enter the exact price manually.",
    };
  }

  const selected = priced.find((price) => price.source === "tcgplayer") || priced[0];
  return {
    status: "ready",
    price: selected.value,
    source: selected.source,
    message: selected.source === "tcgplayer" ? "TCGplayer retail" : "Card Kingdom retail fallback",
  };
}

export function parsePrice(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  const cleaned = String(value ?? "").trim().replace(/^\$/, "");
  if (!/^\d+(?:\.\d{0,2})?$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function formatPrice(value: number | null) {
  return value === null || !Number.isFinite(value) ? "" : value.toFixed(2);
}

export function minimumPriceForSelection(
  isBasicLand: boolean,
  treatment: string,
  finish: PricingFinish,
) {
  return isBasicLand && treatment === "standard" && finish === "normal" ? 0.05 : 0.25;
}

export function applyMinimumPrice(
  price: number | null,
  isBasicLand: boolean,
  treatment: string,
  finish: PricingFinish,
) {
  if (price === null) return null;
  return Math.max(price, minimumPriceForSelection(isBasicLand, treatment, finish));
}

export function pricingQuantityMaximum(
  requestedQuantity: number,
  allocatedQuantity: number,
) {
  return Math.max(0, Math.floor(requestedQuantity) - Math.floor(allocatedQuantity));
}

export function priceWithListedMedianFallback(
  listedMedian: PricingSelection,
  mtgjson: PricingSelection,
): PricingSelection {
  if (listedMedian.status === "ready" && listedMedian.price !== null) return listedMedian;
  if (["loading", "select-printing"].includes(listedMedian.status)) return listedMedian;
  if (mtgjson.status !== "ready" || mtgjson.price === null) return listedMedian;
  return {
    ...mtgjson,
    message: `Using MTGJSON fallback (${mtgjson.message}) because ${listedMedian.message}`,
  };
}

export function tcgplayerCardSearchUrl(cardName: string) {
  return `https://www.tcgplayer.com/search/magic/product?productLineName=magic&q=${encodeURIComponent(cardName.trim())}&view=grid`;
}

export function receiptTreatment(treatment: string, finish: PricingFinish) {
  const treatmentLabel = TREATMENT_ABBREVIATIONS[treatment] || TREATMENT_LABELS[treatment] || treatment || "Std";
  if (finish === "foil") return `${treatmentLabel} Foil`;
  if (finish === "etched") return `${treatmentLabel} Etched`;
  return treatmentLabel;
}

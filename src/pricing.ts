import { normalizePricingAssistantRow } from "./pricing-session";
export { normalizePricingAssistantRow } from "./pricing-session";

export type PricingFinish = "normal" | "foil" | "etched";
export type FoilTreatment = "standard" | "surge";

export type PricingValue = {
  value: number;
  source: string;
  currency?: string;
};

export type MtgjsonPriceSourceOption = {
  key: string;
  provider: string;
  listType: "retail" | "buylist";
  currency: string;
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
  flavorName?: string;
  artist?: string;
  treatments: string[];
  /** Provider foil technology; deliberately separate from visual treatments. */
  foilTreatment?: FoilTreatment;
  finishes: PricingFinish[];
  prices: Partial<Record<PricingFinish, PricingValue>>;
  priceListings?: Partial<Record<PricingFinish, Record<string, PricingValue>>>;
};

export type PricingCard = {
  name: string;
  printings: PricingPrinting[];
};

export type PricingCatalog = Record<string, PricingCard>;

/** Serializable Pricing Assistant work; market data is rehydrated separately. */
export type PricingAssistantRowState = {
  id: string;
  groupId: string;
  sourceIndex: number;
  requestedQuantity: number;
  isBasicLand: boolean;
  quantity: number;
  found: boolean;
  resolved: boolean;
  /** Customer/staff-facing title. */
  displayName: string;
  /** Canonical name used to retrieve the catalog and price data. */
  canonicalName: string;
  /** Legacy v2 share-link field; normalize it on restore rather than reusing it. */
  cardName?: string;
  manuallyCreated?: boolean;
  requestedFlavorName?: string;
  requestedSetCode?: string;
  requestedFinish?: PricingFinish;
  requestedFoilTreatment?: FoilTreatment;
  requestedTreatment?: string;
  /** A staff-selected set overrides formatter/default printing preferences. */
  setSelectionSource?: "default" | "manual";
  setCode: string;
  selectedPrintingUuid?: string;
  finish: PricingFinish;
  treatment: string;
  foilTreatment?: FoilTreatment;
  priceOverride: string | null;
};

export type FormatterPricingItem = {
  index?: number;
  quantity?: number;
  inputName?: string;
  status?: string;
  isBasicLand?: boolean;
  alternateTitle?: string;
  requestedDisplayName?: string;
  requestedPrinting?: RequestedPrintingPreference;
  card?: { name?: string };
  mtgjsonCard?: { name?: string };
};

export type RequestedPrintingPreference = {
  setCode?: string;
  treatment?: string;
  finish?: PricingFinish;
  foilTreatment?: FoilTreatment;
  /** A customer-facing reskin/flavor title that can identify an exact printing. */
  flavorName?: string;
};

export type PricingFinishChoice = {
  key: string;
  label: string;
  finish: PricingFinish;
  foilTreatment: FoilTreatment;
};

export type PricingVariantOption = {
  uuid: string;
  label: string;
};

export type PricingPhysicalSelection = {
  setCode: string;
  finish: PricingFinish;
  foilTreatment: FoilTreatment;
  treatment: string;
  selectedPrintingUuid: string;
};

export type PricingSelection = {
  status: "ready" | "loading" | "select-printing" | "unavailable" | "ambiguous";
  price: number | null;
  source: string;
  message: string;
};

export type PricingRowWarningState = "none" | "loading" | "unavailable" | "ambiguous";

export type TcgplayerPricePoint = {
  printingType: string;
  listedMedianPrice: number | null;
  marketPrice?: number | null;
};

export const FINISH_LABELS: Record<PricingFinish, string> = {
  normal: "Non-Foil",
  foil: "Foil",
  etched: "Etched",
};

export const PRICING_INDEX_PHYSICAL_DIMENSIONS_VERSION = 6;

export function pricingIndexSupportsPhysicalDimensions(version: unknown) {
  return Number(version) >= PRICING_INDEX_PHYSICAL_DIMENSIONS_VERSION;
}

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

export const LEGACY_MTGJSON_PRICE_SOURCES: MtgjsonPriceSourceOption[] = [
  { key: "tcgplayer:retail", provider: "tcgplayer", listType: "retail", currency: "USD" },
  { key: "cardkingdom:retail", provider: "cardkingdom", listType: "retail", currency: "USD" },
];

export function selectableMtgjsonPriceSources(sources: MtgjsonPriceSourceOption[]) {
  return sources.filter((source) => source.key !== "cardkingdom:buylist");
}

export function mtgjsonPriceSourceLabel(source: MtgjsonPriceSourceOption) {
  const providerLabels: Record<string, string> = {
    cardkingdom: "Card Kingdom",
    cardmarket: "Cardmarket",
    cardsphere: "Cardsphere",
    manapool: "Mana Pool",
    tcgplayer: "TCGplayer",
  };
  const provider = providerLabels[source.provider] || source.provider.replace(/\b\w/g, (letter) => letter.toUpperCase());
  return `MTGJSON · ${provider} ${source.listType === "buylist" ? "Buylist" : "Retail"}${source.currency && source.currency !== "USD" ? ` (${source.currency})` : ""}`;
}

export function priceCurrencySymbol(currency = "USD") {
  if (currency === "EUR") return "€";
  if (currency === "GBP") return "£";
  return currency === "USD" ? "$" : `${currency} `;
}

export function convertCurrencyPrice(value: number | null, rate: number | null) {
  if (value === null || rate === null || !Number.isFinite(value) || !Number.isFinite(rate) || rate <= 0) return null;
  return Math.round(value * rate * 100) / 100;
}

export function priceVarianceRatio(primaryPrice: number | null, comparisonPrice: number | null) {
  if (
    primaryPrice === null
      || comparisonPrice === null
      || !Number.isFinite(primaryPrice)
      || !Number.isFinite(comparisonPrice)
      || comparisonPrice <= 0
  ) return null;
  return (primaryPrice - comparisonPrice) / comparisonPrice;
}

export function requiresPriceVarianceReview(
  listedMedianPrice: number | null,
  comparisonPrice: number | null,
  varianceThreshold = 0.5,
  minimumCardValue = 4,
) {
  const ratio = priceVarianceRatio(listedMedianPrice, comparisonPrice);
  return listedMedianPrice !== null
    && listedMedianPrice >= minimumCardValue
    && ratio !== null
    && Math.abs(ratio) >= varianceThreshold;
}

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

/** Reads v3 surge-in-treatment records as the v4 orthogonal representation. */
export function visualTreatmentsForPrinting(printing: PricingPrinting) {
  const visual = (printing.treatments || []).filter((treatment) => treatment !== "surge");
  return visual.length ? visual : ["standard"];
}

export function foilTreatmentForPrinting(printing: PricingPrinting): FoilTreatment {
  return printing.foilTreatment || ((printing.treatments || []).includes("surge") ? "surge" : "standard");
}

/** The single gate used by Finish, Treatment, Art, price, and product selection. */
export function printingMatchesFinishChoice(
  printing: PricingPrinting,
  finish: PricingFinish,
  foilTreatment: FoilTreatment = "standard",
) {
  const printingFoilTreatment = foilTreatmentForPrinting(printing);
  if (printingFoilTreatment === "surge") {
    return finish === "foil"
      && foilTreatment === "surge"
      && printing.finishes.includes("foil");
  }
  if (finish === "foil") {
    return foilTreatment === "standard" && printing.finishes.includes("foil");
  }
  return printing.finishes.includes(finish);
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

function localDateKey(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

export function preferredDefaultEdition(
  card: PricingCard | null,
  referenceDate: Date | string = new Date(),
) {
  const editions = editionOptions(card);
  const today = typeof referenceDate === "string"
    ? referenceDate.slice(0, 10)
    : localDateKey(referenceDate);
  const releasedEditions = editions.filter((edition) => (
    /^\d{4}-\d{2}-\d{2}$/.test(edition.releaseDate)
      && edition.releaseDate <= today
  ));
  return releasedEditions.find((edition) => (
    edition.setCode.toUpperCase() !== "SLD"
      && !/secret\s+lair/i.test(edition.setName)
  )) || releasedEditions[0] || null;
}

export function treatmentOptions(card: PricingCard | null, setCode: string) {
  if (!card || !setCode) return ["standard"];
  const values = new Set(
    card.printings
      .filter((printing) => printing.setCode === setCode)
      .flatMap(visualTreatmentsForPrinting),
  );
  if (!values.size) values.add("standard");
  return Array.from(values).sort((a, b) => {
    if (a === "standard") return -1;
    if (b === "standard") return 1;
    return (TREATMENT_LABELS[a] || a).localeCompare(TREATMENT_LABELS[b] || b);
  });
}

function sortTreatmentValues(values: Iterable<string>) {
  return Array.from(new Set(values)).sort((a, b) => {
    if (a === "standard") return -1;
    if (b === "standard") return 1;
    return (TREATMENT_LABELS[a] || a).localeCompare(TREATMENT_LABELS[b] || b);
  });
}

export function compatibleTreatmentOptions(
  card: PricingCard | null,
  setCode: string,
  finish: PricingFinish,
  foilTreatment: FoilTreatment = "standard",
) {
  if (!card || !setCode) return [];
  const values = new Set(
    card.printings
      .filter((printing) => printing.setCode === setCode)
      .filter((printing) => printingMatchesFinishChoice(printing, finish, foilTreatment))
      .flatMap(visualTreatmentsForPrinting),
  );
  return sortTreatmentValues(values);
}

/** Keeps visual treatment valid after a staff-facing finish change. */
export function treatmentForFinishChoice(
  card: PricingCard | null,
  setCode: string,
  currentTreatment: string,
  finish: PricingFinish,
  foilTreatment: FoilTreatment = "standard",
) {
  const compatible = compatibleTreatmentOptions(card, setCode, finish, foilTreatment);
  if (compatible.includes(currentTreatment)) return currentTreatment;
  return compatible.includes("standard") ? "standard" : compatible[0] || currentTreatment;
}

export function preferredDefaultTreatment(card: PricingCard | null, setCode: string) {
  const treatments = treatmentOptions(card, setCode);
  return treatments.includes("standard") ? "standard" : treatments[0] || "standard";
}

export function finishOptions(card: PricingCard | null, setCode: string, treatment: string) {
  if (!card || !setCode) return ["normal", "foil", "etched"] as PricingFinish[];
  const values = new Set<PricingFinish>();
  card.printings
    .filter((printing) => printing.setCode === setCode)
    .filter((printing) => visualTreatmentsForPrinting(printing).includes(treatment))
    .forEach((printing) => printing.finishes.forEach((finish) => values.add(finish)));
  if (!values.size) values.add("normal");
  return (["normal", "foil", "etched"] as PricingFinish[]).filter((finish) => values.has(finish));
}

export function finishChoices(card: PricingCard | null, setCode: string, _treatment = ""): PricingFinishChoice[] {
  if (!card || !setCode) return [];
  const records = card.printings
    .filter((printing) => printing.setCode === setCode);
  const choices: PricingFinishChoice[] = [];
  if (records.some((printing) => printingMatchesFinishChoice(printing, "normal"))) {
    choices.push({ key: "nonfoil", label: "Non-Foil", finish: "normal", foilTreatment: "standard" });
  }
  if (records.some((printing) => printingMatchesFinishChoice(printing, "foil", "standard"))) {
    choices.push({ key: "foil", label: "Foil", finish: "foil", foilTreatment: "standard" });
  }
  if (records.some((printing) => printingMatchesFinishChoice(printing, "foil", "surge"))) {
    choices.push({ key: "surge", label: "Surge", finish: "foil", foilTreatment: "surge" });
  }
  if (records.some((printing) => printingMatchesFinishChoice(printing, "etched"))) {
    choices.push({ key: "etched", label: "Etched", finish: "etched", foilTreatment: "standard" });
  }
  return choices;
}

export function finishChoiceKey(finish: PricingFinish, foilTreatment: FoilTreatment = "standard") {
  if (finish === "foil") return foilTreatment === "surge" ? "surge" : "foil";
  return finish === "normal" ? "nonfoil" : "etched";
}

/** Chooses only valid catalog values, preserving an explicit customer preference first. */
export function preferredPrintingSelection(
  card: PricingCard | null,
  requested: RequestedPrintingPreference = {},
  referenceDate: Date | string = new Date(),
) {
  const editions = editionOptions(card);
  const flavorPrinting = requested.flavorName
    ? card?.printings.find((printing) => (
      pricingNameKey(printing.flavorName || "") === pricingNameKey(requested.flavorName || "")
    ))
    : undefined;
  const setCode = editions.some((edition) => edition.setCode === requested.setCode)
    ? requested.setCode || ""
    : flavorPrinting?.setCode || preferredDefaultEdition(card, referenceDate)?.setCode || "";
  if (!setCode) return null;
  const choices = finishChoices(card, setCode);
  const flavorChoice = flavorPrinting
    ? choices.find((choice) => printingMatchesFinishChoice(
      flavorPrinting,
      choice.finish,
      choice.foilTreatment,
    ))
    : undefined;
  const requestedChoice = choices.find((choice) => (
    choice.finish === requested.finish
      && choice.foilTreatment === (requested.foilTreatment || "standard")
      && (!requested.treatment || compatibleTreatmentOptions(
        card,
        setCode,
        choice.finish,
        choice.foilTreatment,
      ).includes(requested.treatment))
  ));
  const requestedTreatmentChoice = requested.treatment
    ? choices.find((choice) => compatibleTreatmentOptions(
      card,
      setCode,
      choice.finish,
      choice.foilTreatment,
    ).includes(requested.treatment || ""))
    : undefined;
  const finishChoice = requestedChoice
    || requestedTreatmentChoice
    || flavorChoice
    || choices.find((choice) => choice.finish === "normal")
    || choices[0];
  if (!finishChoice) return null;
  const treatments = compatibleTreatmentOptions(card, setCode, finishChoice.finish, finishChoice.foilTreatment);
  const flavorTreatment = flavorPrinting
    ? visualTreatmentsForPrinting(flavorPrinting).find((candidate) => treatments.includes(candidate))
    : undefined;
  const treatment = requested.treatment && treatments.includes(requested.treatment)
    ? requested.treatment
    : flavorTreatment || (treatments.includes("standard") ? "standard" : treatments[0]);
  if (!treatment) return null;
  return {
    setCode,
    treatment,
    finish: finishChoice.finish,
    foilTreatment: finishChoice.foilTreatment,
  };
}

export function matchingPrintings(
  card: PricingCard | null,
  setCode: string,
  treatment: string,
  finish: PricingFinish,
  selectedPrintingUuid = "",
  foilTreatment: FoilTreatment = "standard",
) {
  if (!card || !setCode) return [];
  return card.printings
    .filter((printing) => printing.setCode === setCode)
    .filter((printing) => visualTreatmentsForPrinting(printing).includes(treatment))
    .filter((printing) => printingMatchesFinishChoice(printing, finish, foilTreatment))
    .filter((printing) => !selectedPrintingUuid || printing.uuid === selectedPrintingUuid);
}

export const printingsForSelection = matchingPrintings;

export function exactPrintingUuidForSelection(
  card: PricingCard | null,
  setCode: string,
  treatment: string,
  finish: PricingFinish,
  currentUuid = "",
  requestedFlavorName = "",
  foilTreatment: FoilTreatment = "standard",
) {
  const candidates = matchingPrintings(card, setCode, treatment, finish, "", foilTreatment);
  if (candidates.some((printing) => printing.uuid === currentUuid)) return currentUuid;
  const flavorMatch = requestedFlavorName && candidates.find((printing) => (
    pricingNameKey(printing.flavorName || "") === pricingNameKey(requestedFlavorName)
  ));
  if (flavorMatch) return flavorMatch.uuid;
  const variants = pricingVariantOptions(card, setCode, treatment, finish, foilTreatment);
  return variants.length === 1 ? variants[0].uuid : "";
}

export function pricingVariantOptions(
  card: PricingCard | null,
  setCode: string,
  treatment: string,
  finish: PricingFinish,
  foilTreatment: FoilTreatment = "standard",
): PricingVariantOption[] {
  const groups = new Map<string, PricingPrinting[]>();
  matchingPrintings(card, setCode, treatment, finish, "", foilTreatment).forEach((printing) => {
    const key = [printing.number || "", pricingNameKey(printing.flavorName || ""), pricingNameKey(printing.artist || "")].join("|");
    groups.set(key, [...(groups.get(key) || []), printing]);
  });
  return Array.from(groups.values()).map((group) => {
    const printing = [...group].sort((a, b) => a.uuid.localeCompare(b.uuid))[0];
    const details = [
      printing.number ? `#${printing.number}` : "",
      printing.flavorName || "",
      printing.artist || "",
    ].filter(Boolean);
    return {
      uuid: printing.uuid,
      label: details.length ? details.join(" — ") : "Distinct printing",
    };
  });
}

export function shouldShowPricingVariant(found: boolean, options: PricingVariantOption[]) {
  return found && options.length > 1;
}

/**
 * Resolves the staff-facing physical dimensions in their UI order. The selected
 * UUID is retained only when it still belongs to Set -> Finish -> Treatment;
 * otherwise a lone remaining human variant is selected deterministically.
 */
export function normalizePricingPhysicalSelection(
  card: PricingCard | null,
  selection: Partial<PricingPhysicalSelection>,
  requestedFlavorName = "",
): PricingPhysicalSelection {
  const setCode = selection.setCode || "";
  const choices = finishChoices(card, setCode);
  const currentChoice = choices.find((choice) => (
    choice.finish === selection.finish
      && choice.foilTreatment === (selection.foilTreatment || "standard")
  ));
  const choice = currentChoice || choices[0];
  const finish = choice?.finish || selection.finish || "normal";
  const foilTreatment = choice?.foilTreatment || (finish === "foil" ? selection.foilTreatment || "standard" : "standard");
  const treatment = choice
    ? treatmentForFinishChoice(card, setCode, selection.treatment || "standard", finish, foilTreatment)
    : selection.treatment || "standard";
  return {
    setCode,
    finish,
    foilTreatment,
    treatment,
    selectedPrintingUuid: choice
      ? exactPrintingUuidForSelection(
        card,
        setCode,
        treatment,
        finish,
        selection.selectedPrintingUuid || "",
        requestedFlavorName,
        foilTreatment,
      )
      : "",
  };
}

/**
 * Applies a staff-selected set as a new physical-printing root. Customer
 * flavor/reskin intent is an initial preference, never a constraint here.
 */
export function selectManualPricingSet(
  sourceRow: PricingAssistantRowState,
  card: PricingCard | null,
  selectedSetCode: string,
): PricingAssistantRowState {
  const row = normalizePricingAssistantRow(sourceRow);
  const setCode = selectedSetCode.toUpperCase();
  const hasSet = editionOptions(card).some((edition) => edition.setCode === setCode);
  if (!row.resolved || !hasSet) return row;

  const choices = finishChoices(card, setCode);
  const finishChoice = choices.find((choice) => choice.finish === "normal") || choices[0];
  if (!finishChoice) return {
    ...row,
    setCode,
    setSelectionSource: "manual",
    selectedPrintingUuid: "",
  };

  const treatments = compatibleTreatmentOptions(
    card,
    setCode,
    finishChoice.finish,
    finishChoice.foilTreatment,
  );
  const treatment = treatments.includes("standard") ? "standard" : treatments[0] || "standard";
  return {
    ...row,
    setSelectionSource: "manual",
    ...normalizePricingPhysicalSelection(card, {
      setCode,
      finish: finishChoice.finish,
      foilTreatment: finishChoice.foilTreatment,
      treatment,
      // The previous set's exact art/product identity cannot cross sets.
      selectedPrintingUuid: "",
    }),
  };
}

/**
 * Defensive legacy/stale-state path: an explicitly chosen exact printing is
 * authoritative for its finish technology and visual treatment. This never
 * returns or mutates card identity fields.
 */
export function pricingSelectionForPrintingUuid(
  card: PricingCard | null,
  current: PricingPhysicalSelection,
  selectedPrintingUuid: string,
  requestedFlavorName = "",
): PricingPhysicalSelection {
  if (!selectedPrintingUuid) {
    return normalizePricingPhysicalSelection(card, { ...current, selectedPrintingUuid: "" }, requestedFlavorName);
  }
  const printing = card?.printings.find((candidate) => (
    candidate.uuid === selectedPrintingUuid && candidate.setCode === current.setCode
  ));
  if (!printing) {
    return normalizePricingPhysicalSelection(card, { ...current, selectedPrintingUuid: "" }, requestedFlavorName);
  }

  let finish = current.finish;
  let foilTreatment = current.foilTreatment;
  const exactFoilTreatment = foilTreatmentForPrinting(printing);
  if (printing.finishes.includes("foil") && exactFoilTreatment === "surge") {
    finish = "foil";
    foilTreatment = "surge";
  } else if (!printing.finishes.includes(finish)
    || (finish === "foil" && foilTreatment !== exactFoilTreatment)) {
    if (printing.finishes.includes("foil")) {
      finish = "foil";
      foilTreatment = exactFoilTreatment;
    } else if (printing.finishes.includes("normal")) {
      finish = "normal";
      foilTreatment = "standard";
    } else {
      finish = printing.finishes.includes("etched") ? "etched" : current.finish;
      foilTreatment = "standard";
    }
  } else if (finish !== "foil") {
    foilTreatment = "standard";
  }

  const exactTreatments = visualTreatmentsForPrinting(printing);
  const treatment = exactTreatments.includes(current.treatment)
    ? current.treatment
    : exactTreatments.includes("standard") ? "standard" : exactTreatments[0] || current.treatment;
  return normalizePricingPhysicalSelection(card, {
    setCode: current.setCode,
    finish,
    foilTreatment,
    treatment,
    selectedPrintingUuid,
  }, requestedFlavorName);
}

export function pricingDisplayName(displayName: string, canonicalName: string) {
  return pricingNameKey(displayName) === pricingNameKey(canonicalName)
    ? displayName
    : `${displayName} (${canonicalName})`;
}

/** Builds a brand-new pricing session from resolved formatter data. */
export function createPricingRowsFromFormatterItems(items: FormatterPricingItem[]): PricingAssistantRowState[] {
  return items.map((item, order) => {
    const inputName = item.inputName || String(order);
    const sourceIndex = item.index ?? order;
    const groupId = `card-${sourceIndex}-${pricingNameKey(inputName).replace(/[^a-z0-9]/g, "-")}`;
    const requestedQuantity = Math.max(1, Number(item.quantity) || 1);
    const canonicalName = item.card?.name
      || item.mtgjsonCard?.name
      || item.requestedDisplayName
      || item.alternateTitle
      || inputName;
    const displayName = item.alternateTitle || item.requestedDisplayName || canonicalName;
    return normalizePricingAssistantRow({
      id: `${groupId}-original`,
      groupId,
      sourceIndex,
      requestedQuantity,
      isBasicLand: Boolean(item.isBasicLand),
      quantity: requestedQuantity,
      found: false,
      resolved: item.status === "found",
      displayName,
      canonicalName,
      requestedFlavorName: item.alternateTitle || item.requestedDisplayName || "",
      requestedSetCode: item.requestedPrinting?.setCode || "",
      requestedFinish: item.requestedPrinting?.finish,
      requestedFoilTreatment: item.requestedPrinting?.foilTreatment,
      requestedTreatment: item.requestedPrinting?.treatment || "",
      setCode: "",
      selectedPrintingUuid: "",
      finish: "normal",
      treatment: "standard",
      foilTreatment: "standard",
      priceOverride: null,
    });
  });
}

/** Refreshes formatter-owned identity without erasing in-progress staff pricing work. */
export function reconcilePricingRowsWithFormatterItems(
  currentRows: PricingAssistantRowState[],
  items: FormatterPricingItem[],
) {
  const freshRows = createPricingRowsFromFormatterItems(items);
  const manualRows = currentRows.filter((row) => row.manuallyCreated);
  const formatterRows = currentRows.filter((row) => !row.manuallyCreated);
  const identityFields = (fresh: PricingAssistantRowState) => ({
    groupId: fresh.groupId,
    sourceIndex: fresh.sourceIndex,
    requestedQuantity: fresh.requestedQuantity,
    isBasicLand: fresh.isBasicLand,
    resolved: fresh.resolved,
    displayName: fresh.displayName,
    canonicalName: fresh.canonicalName,
    requestedFlavorName: fresh.requestedFlavorName,
    requestedSetCode: fresh.requestedSetCode,
    requestedFinish: fresh.requestedFinish,
    requestedFoilTreatment: fresh.requestedFoilTreatment,
    requestedTreatment: fresh.requestedTreatment,
  });
  const reconciled = freshRows.flatMap((fresh) => {
    const existing = formatterRows.filter((row) => row.sourceIndex === fresh.sourceIndex);
    return existing.length
      ? existing.map((row) => ({ ...row, ...identityFields(fresh) }))
      : [fresh];
  });
  return [...reconciled, ...manualRows];
}

export function pricingPhysicalSelectionIsValid(
  row: Pick<PricingAssistantRowState, "setCode" | "treatment" | "finish" | "foilTreatment" | "selectedPrintingUuid">,
  card: PricingCard | null,
) {
  return matchingPrintings(
    card,
    row.setCode,
    row.treatment,
    row.finish,
    row.selectedPrintingUuid || "",
    row.foilTreatment || "standard",
  ).length > 0;
}

/**
 * Applies customer intent, valid staff choices, and deterministic physical
 * defaults in Set -> Finish -> Treatment -> Art/UUID order.
 */
export function initializePricingRowSelection(
  sourceRow: PricingAssistantRowState,
  card: PricingCard | null,
  referenceDate: Date | string = new Date(),
): PricingAssistantRowState {
  const row = normalizePricingAssistantRow(sourceRow);
  if (!row.resolved || !card) return row;

  const editions = editionOptions(card);
  if (!editions.length) return row;
  const hasSet = (setCode = "") => editions.some((edition) => edition.setCode === setCode.toUpperCase());
  const hasManualSetSelection = row.setSelectionSource === "manual" && hasSet(row.setCode);
  const useInitialPreferences = !hasManualSetSelection;
  const requestedSetCode = row.requestedSetCode.toUpperCase();
  const flavorPrinting = useInitialPreferences && row.requestedFlavorName
    ? card.printings.find((printing) => (
      pricingNameKey(printing.flavorName || "") === pricingNameKey(row.requestedFlavorName)
    ))
    : undefined;
  const setCode = hasManualSetSelection
    ? row.setCode.toUpperCase()
    : hasSet(requestedSetCode)
    ? requestedSetCode
    : flavorPrinting?.setCode
      || (hasSet(row.setCode) ? row.setCode.toUpperCase() : preferredDefaultEdition(card, referenceDate)?.setCode || "");
  if (!setCode) return row;

  const choices = finishChoices(card, setCode);
  if (!choices.length) return row;
  const existingDimensionsValid = matchingPrintings(
    card,
    row.setCode,
    row.treatment,
    row.finish,
    "",
    row.foilTreatment || "standard",
  ).length > 0;
  const requestedChoice = useInitialPreferences && row.requestedFinish
    ? choices.find((choice) => (
      choice.finish === row.requestedFinish
        && choice.foilTreatment === (row.requestedFoilTreatment || "standard")
        && (!row.requestedTreatment || compatibleTreatmentOptions(
          card,
          setCode,
          choice.finish,
          choice.foilTreatment,
        ).includes(row.requestedTreatment))
    ))
    : undefined;
  const requestedTreatmentChoice = useInitialPreferences && row.requestedTreatment
    ? choices.find((choice) => compatibleTreatmentOptions(
      card,
      setCode,
      choice.finish,
      choice.foilTreatment,
    ).includes(row.requestedTreatment))
    : undefined;
  const flavorChoice = useInitialPreferences && flavorPrinting?.setCode === setCode
    ? choices.find((choice) => printingMatchesFinishChoice(
      flavorPrinting,
      choice.finish,
      choice.foilTreatment,
    ))
    : undefined;
  const existingChoice = existingDimensionsValid && row.setCode === setCode
    ? choices.find((choice) => (
      choice.finish === row.finish
        && choice.foilTreatment === (row.foilTreatment || "standard")
    ))
    : undefined;
  const finishChoice = requestedChoice
    || requestedTreatmentChoice
    || flavorChoice
    || existingChoice
    || choices.find((choice) => choice.finish === "normal")
    || choices[0];

  const treatments = compatibleTreatmentOptions(
    card,
    setCode,
    finishChoice.finish,
    finishChoice.foilTreatment,
  );
  if (!treatments.length) return row;
  const flavorTreatment = useInitialPreferences && flavorPrinting?.setCode === setCode
    ? visualTreatmentsForPrinting(flavorPrinting).find((treatment) => treatments.includes(treatment))
    : undefined;
  const treatment = useInitialPreferences && row.requestedTreatment && treatments.includes(row.requestedTreatment)
    ? row.requestedTreatment
    : flavorTreatment
      || (existingDimensionsValid && row.setCode === setCode && treatments.includes(row.treatment)
        ? row.treatment
        : treatments.includes("standard") ? "standard" : treatments[0]);
  const preferFlavorUuid = Boolean(
    useInitialPreferences
      && flavorPrinting
      && flavorPrinting.setCode === setCode
      && printingMatchesFinishChoice(flavorPrinting, finishChoice.finish, finishChoice.foilTreatment)
      && visualTreatmentsForPrinting(flavorPrinting).includes(treatment),
  );

  return {
    ...row,
    ...normalizePricingPhysicalSelection(card, {
      setCode,
      finish: finishChoice.finish,
      foilTreatment: finishChoice.foilTreatment,
      treatment,
      selectedPrintingUuid: preferFlavorUuid ? "" : row.selectedPrintingUuid || "",
    }, useInitialPreferences ? row.requestedFlavorName : ""),
  };
}

/** The single state transition used when staff mark a row Found. */
export function initializeFoundPricingSelection(
  row: PricingAssistantRowState,
  card: PricingCard | null,
  referenceDate: Date | string = new Date(),
): PricingAssistantRowState {
  return {
    ...initializePricingRowSelection(row, card, referenceDate),
    found: true,
  };
}

/** Keeps catalog hydration/loading distinct from a genuinely unresolved price. */
export function pricingRowWarningState({
  resolved,
  found,
  catalogState,
  hydrating,
  automaticStatus,
  priceValid,
}: {
  resolved: boolean;
  found: boolean;
  catalogState: "idle" | "loading" | "ready" | "error";
  hydrating: boolean;
  automaticStatus: PricingSelection["status"];
  priceValid: boolean;
}): PricingRowWarningState {
  if (!resolved || catalogState === "error") return "unavailable";
  if (!found) return "none";
  if (hydrating || catalogState === "idle" || catalogState === "loading" || automaticStatus === "loading") return "loading";
  if (priceValid) return "none";
  return automaticStatus === "ambiguous" ? "ambiguous" : "unavailable";
}

export function createManualPricingRow(
  id: string,
  groupId: string,
  displayName: string,
  canonicalName: string,
  requestedFlavorName = "",
): PricingAssistantRowState {
  return normalizePricingAssistantRow({
    id,
    groupId,
    sourceIndex: Number.MAX_SAFE_INTEGER,
    requestedQuantity: 1,
    isBasicLand: false,
    quantity: 1,
    found: false,
    resolved: true,
    displayName,
    canonicalName,
    manuallyCreated: true,
    requestedFlavorName,
    setCode: "",
    selectedPrintingUuid: "",
    finish: "normal",
    treatment: "standard",
    foilTreatment: "standard",
    priceOverride: null,
  });
}

export function tcgplayerProductIdsForSelection(
  card: PricingCard | null,
  setCode: string,
  treatment: string,
  finish: PricingFinish,
  selectedPrintingUuid = "",
  foilTreatment: FoilTreatment = "standard",
) {
  return Array.from(new Set(
    printingsForSelection(card, setCode, treatment, finish, selectedPrintingUuid, foilTreatment)
      .map((printing) => (
        finish === "etched"
          ? printing.tcgplayerEtchedProductId || printing.tcgplayerProductId
          : printing.tcgplayerProductId
      ))
      .filter(Boolean),
  ));
}

export function tcgplayerProductIdForSelection(
  card: PricingCard | null,
  setCode: string,
  treatment: string,
  finish: PricingFinish,
  selectedPrintingUuid = "",
  foilTreatment: FoilTreatment = "standard",
) {
  const productIds = tcgplayerProductIdsForSelection(card, setCode, treatment, finish, selectedPrintingUuid, foilTreatment);
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
  priceSource = "tcgplayer:retail",
  selectedPrintingUuid = "",
  foilTreatment: FoilTreatment = "standard",
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

  const candidates = printingsForSelection(card, setCode, treatment, finish, selectedPrintingUuid, foilTreatment);
  const priced = candidates
    .map((printing) => {
      const indexedPrice = printing.priceListings?.[finish]?.[priceSource];
      if (indexedPrice) return indexedPrice;
      const legacyPrice = printing.prices[finish];
      const legacySource = legacyPrice?.source === "tcgplayer"
        ? "tcgplayer:retail"
        : legacyPrice?.source === "cardkingdom"
          ? "cardkingdom:retail"
          : legacyPrice?.source;
      return legacySource === priceSource ? legacyPrice : null;
    })
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

  const selected = priced[0];
  const [provider, listType] = priceSource.split(":");
  const sourceOption = {
    key: priceSource,
    provider,
    listType: listType === "buylist" ? "buylist" as const : "retail" as const,
    currency: selected.currency || "USD",
  };
  return {
    status: "ready",
    price: selected.value,
    source: priceSource,
    message: mtgjsonPriceSourceLabel(sourceOption),
  };
}

export function parsePrice(value: string | number | null | undefined) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  const cleaned = String(value ?? "").trim().replace(/^\$/, "");
  if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(cleaned)) return null;
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

export function remainingRequestedQuantity(requestedQuantity: number, foundQuantities: number[]) {
  const foundQuantity = foundQuantities.reduce((sum, quantity) => (
    sum + Math.max(0, Math.floor(Number(quantity) || 0))
  ), 0);
  return Math.max(0, Math.floor(Number(requestedQuantity) || 0) - foundQuantity);
}

export function canPrintPricingReceipt(pricedRowCount: number, unpricedFoundCount: number) {
  return pricedRowCount > 0 && unpricedFoundCount === 0;
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

export function setSearchTerm(setCode = "", setName = "") {
  const code = setCode.trim();
  if (code.toUpperCase() === "PLST") return "List";
  return code || setName.trim();
}

export function tcgplayerCardSearchUrl(cardName: string, setCode = "", setName = "") {
  const query = [cardName.trim(), setSearchTerm(setCode, setName)].filter(Boolean).join(" ");
  return `https://www.tcgplayer.com/search/magic/product?productLineName=magic&q=${encodeURIComponent(query)}&view=grid`;
}

export function receiptTreatment(treatment: string, finish: PricingFinish, foilTreatment: FoilTreatment = "standard") {
  const treatmentLabel = TREATMENT_ABBREVIATIONS[treatment] || TREATMENT_LABELS[treatment] || treatment || "Std";
  if (finish === "foil") return `${treatmentLabel}${foilTreatment === "surge" ? " Surge Foil" : " Foil"}`;
  if (finish === "etched") return `${treatmentLabel} Etched`;
  return treatmentLabel;
}

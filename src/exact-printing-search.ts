import {
  FINISH_LABELS,
  TREATMENT_LABELS,
  matchingPrintings,
  normalizePricingPhysicalSelection,
  printingMatchesFinishChoice,
  visualTreatmentsForPrinting,
  type FoilTreatment,
  type PricingAssistantRowState,
  type PricingCard,
  type PricingFinish,
  type PricingPhysicalSelection,
  type PricingPrinting,
} from "./pricing.js";

export type ExactPrintingSearchOption = {
  key: string;
  uuid: string;
  setCode: string;
  setName: string;
  keyruneCode: string;
  collectorNumber: string;
  releaseDate: string;
  releaseYear: string;
  artist: string;
  flavorName: string;
  treatment: string;
  treatmentLabel: string;
  finish: PricingFinish;
  foilTreatment: FoilTreatment;
  finishLabel: string;
};

export type ExactPrintingSearchResult = {
  options: ExactPrintingSearchOption[];
  total: number;
  truncated: boolean;
};

const naturalCollator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

export function normalizeExactPrintingSearchText(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeCollectorNumber(value: string) {
  const normalized = normalizeExactPrintingSearchText(value).replace(/\s+/g, "");
  if (!/^\d+$/.test(normalized)) return normalized;
  return normalized.replace(/^0+(?=\d)/, "");
}

function finishOptionsForPrinting(printing: PricingPrinting) {
  const choices: Array<{ finish: PricingFinish; foilTreatment: FoilTreatment; label: string }> = [];
  if (printingMatchesFinishChoice(printing, "normal")) {
    choices.push({ finish: "normal", foilTreatment: "standard", label: FINISH_LABELS.normal });
  }
  if (printingMatchesFinishChoice(printing, "foil", "standard")) {
    choices.push({ finish: "foil", foilTreatment: "standard", label: FINISH_LABELS.foil });
  }
  if (printingMatchesFinishChoice(printing, "foil", "surge")) {
    choices.push({ finish: "foil", foilTreatment: "surge", label: "Surge" });
  }
  if (printingMatchesFinishChoice(printing, "etched")) {
    choices.push({ finish: "etched", foilTreatment: "standard", label: FINISH_LABELS.etched });
  }
  return choices;
}

function optionFromPrinting(
  printing: PricingPrinting,
  treatment: string,
  finish: PricingFinish,
  foilTreatment: FoilTreatment,
  finishLabel: string,
): ExactPrintingSearchOption {
  return {
    key: [printing.uuid, finish, foilTreatment, treatment].join("|"),
    uuid: printing.uuid,
    setCode: printing.setCode,
    setName: printing.setName,
    keyruneCode: printing.keyruneCode,
    collectorNumber: printing.number || "",
    releaseDate: printing.releaseDate || "",
    releaseYear: (printing.releaseDate || "").slice(0, 4),
    artist: printing.artist || "",
    flavorName: printing.flavorName || "",
    treatment,
    treatmentLabel: TREATMENT_LABELS[treatment] || treatment || TREATMENT_LABELS.standard,
    finish,
    foilTreatment,
    finishLabel,
  };
}

export function exactPrintingSearchOptions(card: PricingCard | null) {
  if (!card) return [];
  const unique = new Map<string, ExactPrintingSearchOption>();
  card.printings.forEach((printing) => {
    const treatments = Array.from(new Set(visualTreatmentsForPrinting(printing)));
    finishOptionsForPrinting(printing).forEach((choice) => {
      treatments.forEach((treatment) => {
        const option = optionFromPrinting(
          printing,
          treatment,
          choice.finish,
          choice.foilTreatment,
          choice.label,
        );
        if (!unique.has(option.key)) unique.set(option.key, option);
      });
    });
  });
  return Array.from(unique.values());
}

function searchWords(option: ExactPrintingSearchOption) {
  const normalizedCollector = normalizeCollectorNumber(option.collectorNumber);
  const finishAliases = option.foilTreatment === "surge"
    ? ["surge", "foil", "technology"]
    : option.finish === "normal" ? ["nonfoil", "normal"] : [normalizeExactPrintingSearchText(option.finishLabel)];
  const searchable = [
    option.setName,
    option.setCode,
    option.keyruneCode,
    option.artist,
    option.flavorName,
    option.releaseYear,
    option.releaseDate,
    option.treatment,
    option.treatmentLabel,
    option.foilTreatment,
  ].filter(Boolean).map(normalizeExactPrintingSearchText);
  return new Set([
    ...searchable.flatMap((value) => value.split(" ")).filter(Boolean),
    ...finishAliases,
    ...(normalizedCollector ? ["collector", normalizedCollector] : []),
    ...(option.releaseDate ? [normalizeExactPrintingSearchText(option.releaseDate).replace(/\s+/g, "")] : []),
  ]);
}

function queryTokensForSearch(query: string) {
  let normalized = normalizeExactPrintingSearchText(query).replace(/\bnon foil\b/g, "nonfoil");
  const compactValues = String(query || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .match(/[a-z0-9]+(?:[-/][a-z0-9]+)+/g) || [];
  compactValues.forEach((value) => {
    if (!/\d/.test(value)) return;
    const expanded = normalizeExactPrintingSearchText(value);
    normalized = normalized.replace(expanded, normalizeCollectorNumber(value));
  });
  return normalized.split(" ").filter(Boolean);
}

function optionMatchesQuery(option: ExactPrintingSearchOption, queryTokens: string[]) {
  const words = searchWords(option);
  return queryTokens.every((token) => {
    if (/^\d+$/.test(token)) return words.has(token);
    return Array.from(words).some((word) => word === token || word.startsWith(token));
  });
}

function collectorQueries(query: string) {
  const normalized = normalizeExactPrintingSearchText(query);
  const explicit = normalized.match(/(?:^| )collector(?: number)? ([a-z0-9]+)/)?.[1]
    || String(query || "").match(/#\s*([a-z0-9][a-z0-9/-]*)/i)?.[1]
    || "";
  if (explicit) return new Set([normalizeCollectorNumber(explicit)]);
  return new Set(queryTokensForSearch(query)
    .filter((token) => /\d/.test(token))
    .filter((token) => !/^\d{4}$/.test(token) || Number(token) < 1900 || Number(token) > 2099)
    .map(normalizeCollectorNumber));
}

function compareNewest(a: ExactPrintingSearchOption, b: ExactPrintingSearchOption) {
  return b.releaseDate.localeCompare(a.releaseDate)
    || a.setCode.localeCompare(b.setCode)
    || naturalCollator.compare(a.collectorNumber, b.collectorNumber)
    || a.finishLabel.localeCompare(b.finishLabel)
    || a.treatmentLabel.localeCompare(b.treatmentLabel)
    || a.key.localeCompare(b.key);
}

function compareMatches(query: string) {
  const normalizedQuery = normalizeExactPrintingSearchText(query);
  const collectorQueryValues = collectorQueries(query);
  const tokens = queryTokensForSearch(query);
  return (a: ExactPrintingSearchOption, b: ExactPrintingSearchOption) => {
    const score = (option: ExactPrintingSearchOption) => {
      const setCode = normalizeExactPrintingSearchText(option.setCode);
      const collector = normalizeCollectorNumber(option.collectorNumber);
      const setName = normalizeExactPrintingSearchText(option.setName);
      const words = searchWords(option);
      const prefixOnlyCount = tokens.filter((token) => (
        !words.has(token) && Array.from(words).some((word) => word.startsWith(token))
      )).length;
      return [
        normalizedQuery === setCode ? 0 : 1,
        collectorQueryValues.has(collector) ? 0 : 1,
        setName === normalizedQuery ? 0 : setName.startsWith(normalizedQuery) ? 1 : 2,
        prefixOnlyCount,
      ];
    };
    const aScore = score(a);
    const bScore = score(b);
    for (let index = 0; index < aScore.length; index += 1) {
      if (aScore[index] !== bScore[index]) return aScore[index] - bScore[index];
    }
    return compareNewest(a, b);
  };
}

export function searchExactPrintingOptions(
  options: ExactPrintingSearchOption[],
  query: string,
  limit = 100,
  blankLimit = 20,
): ExactPrintingSearchResult {
  const normalizedQuery = normalizeExactPrintingSearchText(query);
  const safeLimit = Math.max(0, Math.floor(normalizedQuery ? limit : blankLimit));
  const matching = normalizedQuery
    ? options
      .filter((option) => optionMatchesQuery(option, queryTokensForSearch(query)))
      .sort(compareMatches(query))
    : [...options].sort(compareNewest);
  return {
    options: matching.slice(0, safeLimit),
    total: matching.length,
    truncated: matching.length > safeLimit,
  };
}

export function exactPrintingOptionIsSelected(
  option: ExactPrintingSearchOption,
  selection: Partial<PricingPhysicalSelection>,
) {
  return option.uuid === selection.selectedPrintingUuid
    && option.setCode === selection.setCode
    && option.finish === selection.finish
    && option.foilTreatment === (selection.foilTreatment || "standard")
    && option.treatment === selection.treatment;
}

export function selectExactPrintingOption(
  sourceRow: PricingAssistantRowState,
  card: PricingCard | null,
  option: ExactPrintingSearchOption,
): PricingAssistantRowState {
  return {
    ...sourceRow,
    setSelectionSource: "manual",
    ...normalizePricingPhysicalSelection(card, {
      setCode: option.setCode,
      finish: option.finish,
      foilTreatment: option.foilTreatment,
      treatment: option.treatment,
      selectedPrintingUuid: option.uuid,
    }),
  };
}

export function exactPrintingForSelection(
  card: PricingCard | null,
  selection: Partial<PricingPhysicalSelection>,
) {
  if (!selection.selectedPrintingUuid) return null;
  return matchingPrintings(
    card,
    selection.setCode || "",
    selection.treatment || "standard",
    selection.finish || "normal",
    selection.selectedPrintingUuid,
    selection.foilTreatment || "standard",
  ).find((printing) => printing.uuid === selection.selectedPrintingUuid) || null;
}

export function collapsedPrintingLabel(
  card: PricingCard | null,
  selection: Partial<PricingPhysicalSelection>,
) {
  const setCode = selection.setCode || "";
  const printing = exactPrintingForSelection(card, selection);
  return printing?.number ? `${setCode} · #${printing.number}` : setCode;
}

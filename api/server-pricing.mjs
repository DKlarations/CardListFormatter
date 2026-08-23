// src/pricing-session.ts
function normalizePricingAssistantRow(row) {
  const canonicalName = row.canonicalName || row.cardName || row.displayName || "";
  const legacySurge = row.treatment === "surge" && row.finish === "foil";
  return {
    id: row.id || "",
    groupId: row.groupId || "",
    sourceIndex: Number(row.sourceIndex) || 0,
    requestedQuantity: Math.max(1, Number(row.requestedQuantity) || 1),
    isBasicLand: Boolean(row.isBasicLand),
    quantity: Math.max(0, Number(row.quantity) || 0),
    found: Boolean(row.found),
    resolved: Boolean(row.resolved),
    displayName: row.displayName || row.cardName || canonicalName,
    canonicalName,
    manuallyCreated: Boolean(row.manuallyCreated),
    requestedFlavorName: row.requestedFlavorName || "",
    requestedSetCode: row.requestedSetCode || "",
    requestedFinish: row.requestedFinish,
    requestedFoilTreatment: row.requestedFoilTreatment,
    requestedTreatment: row.requestedTreatment || "",
    setSelectionSource: row.setSelectionSource === "manual" ? "manual" : "default",
    setCode: row.setCode || "",
    selectedPrintingUuid: row.selectedPrintingUuid || "",
    finish: row.finish || "normal",
    treatment: legacySurge ? "standard" : row.treatment || "standard",
    foilTreatment: legacySurge ? "surge" : row.foilTreatment || "standard",
    priceOverride: row.priceOverride ?? null
  };
}

// src/pricing.ts
var FINISH_LABELS = {
  normal: "Non-Foil",
  foil: "Foil",
  etched: "Etched"
};
var PRICING_INDEX_PHYSICAL_DIMENSIONS_VERSION = 6;
function pricingIndexSupportsPhysicalDimensions(version) {
  return Number(version) >= PRICING_INDEX_PHYSICAL_DIMENSIONS_VERSION;
}
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
function selectableMtgjsonPriceSources(sources) {
  return sources.filter((source) => source.key !== "cardkingdom:buylist");
}
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
function convertCurrencyPrice(value, rate) {
  if (value === null || rate === null || !Number.isFinite(value) || !Number.isFinite(rate) || rate <= 0) return null;
  return Math.round(value * rate * 100) / 100;
}
function priceVarianceRatio(primaryPrice, comparisonPrice) {
  if (primaryPrice === null || comparisonPrice === null || !Number.isFinite(primaryPrice) || !Number.isFinite(comparisonPrice) || comparisonPrice <= 0) return null;
  return (primaryPrice - comparisonPrice) / comparisonPrice;
}
function requiresPriceVarianceReview(listedMedianPrice, comparisonPrice, varianceThreshold = 0.5, minimumCardValue = 4) {
  const ratio = priceVarianceRatio(listedMedianPrice, comparisonPrice);
  return listedMedianPrice !== null && listedMedianPrice >= minimumCardValue && ratio !== null && Math.abs(ratio) >= varianceThreshold;
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
function visualTreatmentsForPrinting(printing) {
  const visual = (printing.treatments || []).filter((treatment) => treatment !== "surge");
  return visual.length ? visual : ["standard"];
}
function foilTreatmentForPrinting(printing) {
  return printing.foilTreatment || ((printing.treatments || []).includes("surge") ? "surge" : "standard");
}
function printingMatchesFinishChoice(printing, finish, foilTreatment = "standard") {
  const printingFoilTreatment = foilTreatmentForPrinting(printing);
  if (printingFoilTreatment === "surge") {
    return finish === "foil" && foilTreatment === "surge" && printing.finishes.includes("foil");
  }
  if (finish === "foil") {
    return foilTreatment === "standard" && printing.finishes.includes("foil");
  }
  return printing.finishes.includes(finish);
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
function localDateKey(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("-");
}
function preferredDefaultEdition(card, referenceDate = /* @__PURE__ */ new Date()) {
  const editions = editionOptions(card);
  const today = typeof referenceDate === "string" ? referenceDate.slice(0, 10) : localDateKey(referenceDate);
  const releasedEditions = editions.filter((edition) => /^\d{4}-\d{2}-\d{2}$/.test(edition.releaseDate) && edition.releaseDate <= today);
  return releasedEditions.find((edition) => edition.setCode.toUpperCase() !== "SLD" && !/secret\s+lair/i.test(edition.setName)) || releasedEditions[0] || null;
}
function treatmentOptions(card, setCode) {
  if (!card || !setCode) return ["standard"];
  const values = new Set(
    card.printings.filter((printing) => printing.setCode === setCode).flatMap(visualTreatmentsForPrinting)
  );
  if (!values.size) values.add("standard");
  return Array.from(values).sort((a, b) => {
    if (a === "standard") return -1;
    if (b === "standard") return 1;
    return (TREATMENT_LABELS[a] || a).localeCompare(TREATMENT_LABELS[b] || b);
  });
}
function sortTreatmentValues(values) {
  return Array.from(new Set(values)).sort((a, b) => {
    if (a === "standard") return -1;
    if (b === "standard") return 1;
    return (TREATMENT_LABELS[a] || a).localeCompare(TREATMENT_LABELS[b] || b);
  });
}
function compatibleTreatmentOptions(card, setCode, finish, foilTreatment = "standard") {
  if (!card || !setCode) return [];
  const values = new Set(
    card.printings.filter((printing) => printing.setCode === setCode).filter((printing) => printingMatchesFinishChoice(printing, finish, foilTreatment)).flatMap(visualTreatmentsForPrinting)
  );
  return sortTreatmentValues(values);
}
function treatmentForFinishChoice(card, setCode, currentTreatment, finish, foilTreatment = "standard") {
  const compatible = compatibleTreatmentOptions(card, setCode, finish, foilTreatment);
  if (compatible.includes(currentTreatment)) return currentTreatment;
  return compatible.includes("standard") ? "standard" : compatible[0] || currentTreatment;
}
function preferredDefaultTreatment(card, setCode) {
  const treatments = treatmentOptions(card, setCode);
  return treatments.includes("standard") ? "standard" : treatments[0] || "standard";
}
function finishOptions(card, setCode, treatment) {
  if (!card || !setCode) return ["normal", "foil", "etched"];
  const values = /* @__PURE__ */ new Set();
  card.printings.filter((printing) => printing.setCode === setCode).filter((printing) => visualTreatmentsForPrinting(printing).includes(treatment)).forEach((printing) => printing.finishes.forEach((finish) => values.add(finish)));
  if (!values.size) values.add("normal");
  return ["normal", "foil", "etched"].filter((finish) => values.has(finish));
}
function finishChoices(card, setCode, _treatment = "") {
  if (!card || !setCode) return [];
  const records = card.printings.filter((printing) => printing.setCode === setCode);
  const choices = [];
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
function finishChoiceKey(finish, foilTreatment = "standard") {
  if (finish === "foil") return foilTreatment === "surge" ? "surge" : "foil";
  return finish === "normal" ? "nonfoil" : "etched";
}
function preferredPrintingSelection(card, requested = {}, referenceDate = /* @__PURE__ */ new Date()) {
  const editions = editionOptions(card);
  const flavorPrinting = requested.flavorName ? card?.printings.find((printing) => pricingNameKey(printing.flavorName || "") === pricingNameKey(requested.flavorName || "")) : void 0;
  const setCode = editions.some((edition) => edition.setCode === requested.setCode) ? requested.setCode || "" : flavorPrinting?.setCode || preferredDefaultEdition(card, referenceDate)?.setCode || "";
  if (!setCode) return null;
  const choices = finishChoices(card, setCode);
  const flavorChoice = flavorPrinting ? choices.find((choice) => printingMatchesFinishChoice(
    flavorPrinting,
    choice.finish,
    choice.foilTreatment
  )) : void 0;
  const requestedChoice = choices.find((choice) => choice.finish === requested.finish && choice.foilTreatment === (requested.foilTreatment || "standard") && (!requested.treatment || compatibleTreatmentOptions(
    card,
    setCode,
    choice.finish,
    choice.foilTreatment
  ).includes(requested.treatment)));
  const requestedTreatmentChoice = requested.treatment ? choices.find((choice) => compatibleTreatmentOptions(
    card,
    setCode,
    choice.finish,
    choice.foilTreatment
  ).includes(requested.treatment || "")) : void 0;
  const finishChoice = requestedChoice || requestedTreatmentChoice || flavorChoice || choices.find((choice) => choice.finish === "normal") || choices[0];
  if (!finishChoice) return null;
  const treatments = compatibleTreatmentOptions(card, setCode, finishChoice.finish, finishChoice.foilTreatment);
  const flavorTreatment = flavorPrinting ? visualTreatmentsForPrinting(flavorPrinting).find((candidate) => treatments.includes(candidate)) : void 0;
  const treatment = requested.treatment && treatments.includes(requested.treatment) ? requested.treatment : flavorTreatment || (treatments.includes("standard") ? "standard" : treatments[0]);
  if (!treatment) return null;
  return {
    setCode,
    treatment,
    finish: finishChoice.finish,
    foilTreatment: finishChoice.foilTreatment
  };
}
function matchingPrintings(card, setCode, treatment, finish, selectedPrintingUuid = "", foilTreatment = "standard") {
  if (!card || !setCode) return [];
  return card.printings.filter((printing) => printing.setCode === setCode).filter((printing) => visualTreatmentsForPrinting(printing).includes(treatment)).filter((printing) => printingMatchesFinishChoice(printing, finish, foilTreatment)).filter((printing) => !selectedPrintingUuid || printing.uuid === selectedPrintingUuid);
}
var printingsForSelection = matchingPrintings;
function exactPrintingUuidForSelection(card, setCode, treatment, finish, currentUuid = "", requestedFlavorName = "", foilTreatment = "standard") {
  const candidates = matchingPrintings(card, setCode, treatment, finish, "", foilTreatment);
  if (candidates.some((printing) => printing.uuid === currentUuid)) return currentUuid;
  const flavorMatch = requestedFlavorName && candidates.find((printing) => pricingNameKey(printing.flavorName || "") === pricingNameKey(requestedFlavorName));
  if (flavorMatch) return flavorMatch.uuid;
  const variants = pricingVariantOptions(card, setCode, treatment, finish, foilTreatment);
  return variants.length === 1 ? variants[0].uuid : "";
}
function pricingVariantOptions(card, setCode, treatment, finish, foilTreatment = "standard") {
  const groups = /* @__PURE__ */ new Map();
  matchingPrintings(card, setCode, treatment, finish, "", foilTreatment).forEach((printing) => {
    const key = [printing.number || "", pricingNameKey(printing.flavorName || ""), pricingNameKey(printing.artist || "")].join("|");
    groups.set(key, [...groups.get(key) || [], printing]);
  });
  return Array.from(groups.values()).map((group) => {
    const printing = [...group].sort((a, b) => a.uuid.localeCompare(b.uuid))[0];
    const details = [
      printing.number ? `#${printing.number}` : "",
      printing.flavorName || "",
      printing.artist || ""
    ].filter(Boolean);
    return {
      uuid: printing.uuid,
      label: details.length ? details.join(" \u2014 ") : "Distinct printing"
    };
  });
}
function shouldShowPricingVariant(found, options) {
  return found && options.length > 1;
}
function normalizePricingPhysicalSelection(card, selection, requestedFlavorName = "") {
  const setCode = selection.setCode || "";
  const choices = finishChoices(card, setCode);
  const currentChoice = choices.find((choice2) => choice2.finish === selection.finish && choice2.foilTreatment === (selection.foilTreatment || "standard"));
  const choice = currentChoice || choices[0];
  const finish = choice?.finish || selection.finish || "normal";
  const foilTreatment = choice?.foilTreatment || (finish === "foil" ? selection.foilTreatment || "standard" : "standard");
  const treatment = choice ? treatmentForFinishChoice(card, setCode, selection.treatment || "standard", finish, foilTreatment) : selection.treatment || "standard";
  return {
    setCode,
    finish,
    foilTreatment,
    treatment,
    selectedPrintingUuid: choice ? exactPrintingUuidForSelection(
      card,
      setCode,
      treatment,
      finish,
      selection.selectedPrintingUuid || "",
      requestedFlavorName,
      foilTreatment
    ) : ""
  };
}
function selectManualPricingSet(sourceRow, card, selectedSetCode) {
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
    selectedPrintingUuid: ""
  };
  const treatments = compatibleTreatmentOptions(
    card,
    setCode,
    finishChoice.finish,
    finishChoice.foilTreatment
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
      selectedPrintingUuid: ""
    })
  };
}
function pricingSelectionForPrintingUuid(card, current, selectedPrintingUuid, requestedFlavorName = "") {
  if (!selectedPrintingUuid) {
    return normalizePricingPhysicalSelection(card, { ...current, selectedPrintingUuid: "" }, requestedFlavorName);
  }
  const printing = card?.printings.find((candidate) => candidate.uuid === selectedPrintingUuid && candidate.setCode === current.setCode);
  if (!printing) {
    return normalizePricingPhysicalSelection(card, { ...current, selectedPrintingUuid: "" }, requestedFlavorName);
  }
  let finish = current.finish;
  let foilTreatment = current.foilTreatment;
  const exactFoilTreatment = foilTreatmentForPrinting(printing);
  if (printing.finishes.includes("foil") && exactFoilTreatment === "surge") {
    finish = "foil";
    foilTreatment = "surge";
  } else if (!printing.finishes.includes(finish) || finish === "foil" && foilTreatment !== exactFoilTreatment) {
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
  const treatment = exactTreatments.includes(current.treatment) ? current.treatment : exactTreatments.includes("standard") ? "standard" : exactTreatments[0] || current.treatment;
  return normalizePricingPhysicalSelection(card, {
    setCode: current.setCode,
    finish,
    foilTreatment,
    treatment,
    selectedPrintingUuid
  }, requestedFlavorName);
}
function pricingDisplayName(displayName, canonicalName) {
  return pricingNameKey(displayName) === pricingNameKey(canonicalName) ? displayName : `${displayName} (${canonicalName})`;
}
function createPricingRowsFromFormatterItems(items) {
  return items.map((item, order) => {
    const inputName = item.inputName || String(order);
    const sourceIndex = item.index ?? order;
    const groupId = `card-${sourceIndex}-${pricingNameKey(inputName).replace(/[^a-z0-9]/g, "-")}`;
    const requestedQuantity = Math.max(1, Number(item.quantity) || 1);
    const canonicalName = item.card?.name || item.mtgjsonCard?.name || item.requestedDisplayName || item.alternateTitle || inputName;
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
      priceOverride: null
    });
  });
}
function reconcilePricingRowsWithFormatterItems(currentRows, items) {
  const freshRows = createPricingRowsFromFormatterItems(items);
  const manualRows = currentRows.filter((row) => row.manuallyCreated);
  const formatterRows = currentRows.filter((row) => !row.manuallyCreated);
  const identityFields = (fresh) => ({
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
    requestedTreatment: fresh.requestedTreatment
  });
  const reconciled = freshRows.flatMap((fresh) => {
    const existing = formatterRows.filter((row) => row.sourceIndex === fresh.sourceIndex);
    return existing.length ? existing.map((row) => ({ ...row, ...identityFields(fresh) })) : [fresh];
  });
  return [...reconciled, ...manualRows];
}
function pricingPhysicalSelectionIsValid(row, card) {
  return matchingPrintings(
    card,
    row.setCode,
    row.treatment,
    row.finish,
    row.selectedPrintingUuid || "",
    row.foilTreatment || "standard"
  ).length > 0;
}
function initializePricingRowSelection(sourceRow, card, referenceDate = /* @__PURE__ */ new Date()) {
  const row = normalizePricingAssistantRow(sourceRow);
  if (!row.resolved || !card) return row;
  const editions = editionOptions(card);
  if (!editions.length) return row;
  const hasSet = (setCode2 = "") => editions.some((edition) => edition.setCode === setCode2.toUpperCase());
  const hasManualSetSelection = row.setSelectionSource === "manual" && hasSet(row.setCode);
  const useInitialPreferences = !hasManualSetSelection;
  const requestedSetCode = row.requestedSetCode.toUpperCase();
  const flavorPrinting = useInitialPreferences && row.requestedFlavorName ? card.printings.find((printing) => pricingNameKey(printing.flavorName || "") === pricingNameKey(row.requestedFlavorName)) : void 0;
  const setCode = hasManualSetSelection ? row.setCode.toUpperCase() : hasSet(requestedSetCode) ? requestedSetCode : flavorPrinting?.setCode || (hasSet(row.setCode) ? row.setCode.toUpperCase() : preferredDefaultEdition(card, referenceDate)?.setCode || "");
  if (!setCode) return row;
  const choices = finishChoices(card, setCode);
  if (!choices.length) return row;
  const existingDimensionsValid = matchingPrintings(
    card,
    row.setCode,
    row.treatment,
    row.finish,
    "",
    row.foilTreatment || "standard"
  ).length > 0;
  const requestedChoice = useInitialPreferences && row.requestedFinish ? choices.find((choice) => choice.finish === row.requestedFinish && choice.foilTreatment === (row.requestedFoilTreatment || "standard") && (!row.requestedTreatment || compatibleTreatmentOptions(
    card,
    setCode,
    choice.finish,
    choice.foilTreatment
  ).includes(row.requestedTreatment))) : void 0;
  const requestedTreatmentChoice = useInitialPreferences && row.requestedTreatment ? choices.find((choice) => compatibleTreatmentOptions(
    card,
    setCode,
    choice.finish,
    choice.foilTreatment
  ).includes(row.requestedTreatment)) : void 0;
  const flavorChoice = useInitialPreferences && flavorPrinting?.setCode === setCode ? choices.find((choice) => printingMatchesFinishChoice(
    flavorPrinting,
    choice.finish,
    choice.foilTreatment
  )) : void 0;
  const existingChoice = existingDimensionsValid && row.setCode === setCode ? choices.find((choice) => choice.finish === row.finish && choice.foilTreatment === (row.foilTreatment || "standard")) : void 0;
  const finishChoice = requestedChoice || requestedTreatmentChoice || flavorChoice || existingChoice || choices.find((choice) => choice.finish === "normal") || choices[0];
  const treatments = compatibleTreatmentOptions(
    card,
    setCode,
    finishChoice.finish,
    finishChoice.foilTreatment
  );
  if (!treatments.length) return row;
  const flavorTreatment = useInitialPreferences && flavorPrinting?.setCode === setCode ? visualTreatmentsForPrinting(flavorPrinting).find((treatment2) => treatments.includes(treatment2)) : void 0;
  const treatment = useInitialPreferences && row.requestedTreatment && treatments.includes(row.requestedTreatment) ? row.requestedTreatment : flavorTreatment || (existingDimensionsValid && row.setCode === setCode && treatments.includes(row.treatment) ? row.treatment : treatments.includes("standard") ? "standard" : treatments[0]);
  const preferFlavorUuid = Boolean(
    useInitialPreferences && flavorPrinting && flavorPrinting.setCode === setCode && printingMatchesFinishChoice(flavorPrinting, finishChoice.finish, finishChoice.foilTreatment) && visualTreatmentsForPrinting(flavorPrinting).includes(treatment)
  );
  return {
    ...row,
    ...normalizePricingPhysicalSelection(card, {
      setCode,
      finish: finishChoice.finish,
      foilTreatment: finishChoice.foilTreatment,
      treatment,
      selectedPrintingUuid: preferFlavorUuid ? "" : row.selectedPrintingUuid || ""
    }, useInitialPreferences ? row.requestedFlavorName : "")
  };
}
function initializeFoundPricingSelection(row, card, referenceDate = /* @__PURE__ */ new Date()) {
  return {
    ...initializePricingRowSelection(row, card, referenceDate),
    found: true
  };
}
function pricingRowWarningState({
  resolved,
  found,
  catalogState,
  hydrating,
  automaticStatus,
  priceValid
}) {
  if (!resolved || catalogState === "error") return "unavailable";
  if (!found) return "none";
  if (hydrating || catalogState === "idle" || catalogState === "loading" || automaticStatus === "loading") return "loading";
  if (priceValid) return "none";
  return automaticStatus === "ambiguous" ? "ambiguous" : "unavailable";
}
function createManualPricingRow(id, groupId, displayName, canonicalName, requestedFlavorName = "") {
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
    priceOverride: null
  });
}
function tcgplayerProductIdsForSelection(card, setCode, treatment, finish, selectedPrintingUuid = "", foilTreatment = "standard") {
  return Array.from(new Set(
    printingsForSelection(card, setCode, treatment, finish, selectedPrintingUuid, foilTreatment).map((printing) => finish === "etched" ? printing.tcgplayerEtchedProductId || printing.tcgplayerProductId : printing.tcgplayerProductId).filter(Boolean)
  ));
}
function tcgplayerProductIdForSelection(card, setCode, treatment, finish, selectedPrintingUuid = "", foilTreatment = "standard") {
  const productIds = tcgplayerProductIdsForSelection(card, setCode, treatment, finish, selectedPrintingUuid, foilTreatment);
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
function priceForSelection(card, setCode, treatment, finish, priceSource = "tcgplayer:retail", selectedPrintingUuid = "", foilTreatment = "standard") {
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
  const candidates = printingsForSelection(card, setCode, treatment, finish, selectedPrintingUuid, foilTreatment);
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
  if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(cleaned)) return null;
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
function canPrintPricingReceipt(pricedRowCount, unpricedFoundCount) {
  return pricedRowCount > 0 && unpricedFoundCount === 0;
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
function setSearchTerm(setCode = "", setName = "") {
  const code = setCode.trim();
  if (code.toUpperCase() === "PLST") return "List";
  return code || setName.trim();
}
function tcgplayerCardSearchUrl(cardName, setCode = "", setName = "") {
  const query = [cardName.trim(), setSearchTerm(setCode, setName)].filter(Boolean).join(" ");
  return `https://www.tcgplayer.com/search/magic/product?productLineName=magic&q=${encodeURIComponent(query)}&view=grid`;
}
function receiptTreatment(treatment, finish, foilTreatment = "standard") {
  const treatmentLabel = TREATMENT_ABBREVIATIONS[treatment] || TREATMENT_LABELS[treatment] || treatment || "Std";
  if (finish === "foil") return `${treatmentLabel}${foilTreatment === "surge" ? " Surge Foil" : " Foil"}`;
  if (finish === "etched") return `${treatmentLabel} Etched`;
  return treatmentLabel;
}
export {
  FINISH_LABELS,
  LEGACY_MTGJSON_PRICE_SOURCES,
  PRICING_INDEX_PHYSICAL_DIMENSIONS_VERSION,
  TREATMENT_ABBREVIATIONS,
  TREATMENT_LABELS,
  applyMinimumPrice,
  canPrintPricingReceipt,
  cardFromCatalog,
  compatibleTreatmentOptions,
  convertCurrencyPrice,
  createManualPricingRow,
  createPricingRowsFromFormatterItems,
  editionOptions,
  exactPrintingUuidForSelection,
  finishChoiceKey,
  finishChoices,
  finishOptions,
  foilTreatmentForPrinting,
  formatPrice,
  initializeFoundPricingSelection,
  initializePricingRowSelection,
  listedMedianPriceForFinish,
  matchingPrintings,
  minimumPriceForSelection,
  mtgjsonPriceSourceLabel,
  normalizePricingAssistantRow,
  normalizePricingPhysicalSelection,
  parsePrice,
  preferredDefaultEdition,
  preferredDefaultTreatment,
  preferredPrintingSelection,
  priceCurrencySymbol,
  priceForSelection,
  priceVarianceRatio,
  priceWithListedMedianFallback,
  pricingDisplayName,
  pricingIndexSupportsPhysicalDimensions,
  pricingNameKey,
  pricingPhysicalSelectionIsValid,
  pricingQuantityMaximum,
  pricingRowWarningState,
  pricingSelectionForPrintingUuid,
  pricingShardKey,
  pricingVariantOptions,
  printingMatchesFinishChoice,
  printingsForSelection,
  receiptTreatment,
  reconcilePricingRowsWithFormatterItems,
  remainingRequestedQuantity,
  requiresPriceVarianceReview,
  selectManualPricingSet,
  selectableMtgjsonPriceSources,
  setSearchTerm,
  shouldShowPricingVariant,
  tcgplayerCardSearchUrl,
  tcgplayerProductIdForSelection,
  tcgplayerProductIdsForSelection,
  treatmentForFinishChoice,
  treatmentOptions,
  visualTreatmentsForPrinting
};

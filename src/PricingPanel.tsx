import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronDown,
  CornerDownLeft,
  ExternalLink,
  Loader2,
  Printer,
  RefreshCw,
  RotateCcw,
  Settings,
  Trash2,
} from "lucide-react";
import "keyrune/css/keyrune.css";
import { outputDisplayName, sortItemsForOutput } from "./formatter";
import {
  applyMinimumPrice,
  cardFromCatalog,
  convertCurrencyPrice,
  editionOptions,
  FINISH_LABELS,
  finishOptions,
  formatPrice,
  LEGACY_MTGJSON_PRICE_SOURCES,
  listedMedianPriceForFinish,
  minimumPriceForSelection,
  mtgjsonPriceSourceLabel,
  parsePrice,
  preferredDefaultEdition,
  priceCurrencySymbol,
  priceVarianceRatio,
  priceWithListedMedianFallback,
  priceForSelection,
  pricingNameKey,
  pricingQuantityMaximum,
  pricingShardKey,
  remainingRequestedQuantity,
  receiptTreatment,
  requiresPriceVarianceReview,
  selectableMtgjsonPriceSources,
  TREATMENT_LABELS,
  tcgplayerCardSearchUrl,
  tcgplayerProductIdForSelection,
  treatmentOptions,
  type MtgjsonPriceSourceOption,
  type PricingCatalog,
  type PricingFinish,
} from "./pricing";

type PricingRow = {
  id: string;
  groupId: string;
  sourceIndex: number;
  requestedQuantity: number;
  isBasicLand: boolean;
  quantity: number;
  found: boolean;
  resolved: boolean;
  cardName: string;
  setCode: string;
  finish: PricingFinish;
  treatment: string;
  priceOverride: string | null;
};

type PricingPanelProps = {
  visible: boolean;
  items: any[];
  customer: { name?: string; contact?: string };
  processedAt: string | null;
  apiOrigin: string;
  logoUrl: string;
  onMessage: (message: string) => void;
};

type PricingManifest = {
  generatedAt?: string;
  priceSources?: MtgjsonPriceSourceOption[];
  shards?: Record<string, { url?: string } | string>;
};

type ListedMedianPoint = {
  printingType: string;
  listedMedianPrice: number | null;
  marketPrice?: number | null;
};

type ListedMedianEntry = {
  status: "loading" | "ready" | "error";
  points: ListedMedianPoint[];
};

type EurUsdRate = {
  status: "idle" | "loading" | "ready" | "error";
  rate: number | null;
  date: string;
};

type PrintingMenuPosition = {
  rowId: string;
  top: number;
  left: number;
  width: number;
  maxHeight: number;
};

function rowId(groupId: string) {
  return `${groupId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function createPricingRows(items: any[]): PricingRow[] {
  return sortItemsForOutput(items).map((item, order) => {
    const groupId = `card-${item.index ?? order}-${pricingNameKey(item.inputName || String(order)).replace(/[^a-z0-9]/g, "-")}`;
    const requestedQuantity = Math.max(1, Number(item.quantity) || 1);
    const isBasicLand = Boolean(item.isBasicLand);
    return {
      id: `${groupId}-original`,
      groupId,
      sourceIndex: item.index ?? order,
      requestedQuantity,
      isBasicLand,
      quantity: pricingQuantityMaximum(requestedQuantity, 0),
      found: false,
      resolved: item.status === "found",
      cardName: outputDisplayName(item),
      setCode: "",
      finish: "normal",
      treatment: "standard",
      priceOverride: null,
    };
  });
}

function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  }[character] || character));
}

function printedTimestamp(value: string | null) {
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

function manifestShardUrl(manifest: PricingManifest, key: string) {
  const entry = manifest.shards?.[key];
  return typeof entry === "string" ? entry : entry?.url || "";
}

async function fetchStorefrontMedianPoints(productIds: string[]) {
  if (!productIds.length) return {} as Record<string, ListedMedianPoint[]>;
  const isLocalPreview = ["localhost", "127.0.0.1"].includes(window.location.hostname);
  if (isLocalPreview) {
    const entries = await Promise.all(productIds.map(async (productId) => {
      const [detailsResponse, pricePointsResponse] = await Promise.all([
        fetch(`/tcgplayer-details-api/v1/product/${encodeURIComponent(productId)}/details`, {
          cache: "no-store",
          headers: { Accept: "application/json" },
        }),
        fetch(`/tcgplayer-pricepoints-api/v2/product/${encodeURIComponent(productId)}/pricepoints`, {
          cache: "no-store",
          headers: { Accept: "application/json" },
        }),
      ]);
      if (!detailsResponse.ok) throw new Error(`TCGplayer returned ${detailsResponse.status} for product ${productId}.`);
      const details = await detailsResponse.json();
      const pricePointsPayload = pricePointsResponse.ok ? await pricePointsResponse.json() : {};
      const rawComparisonPoints = Array.isArray(pricePointsPayload)
        ? pricePointsPayload
        : Array.isArray(pricePointsPayload?.value) ? pricePointsPayload.value : [];
      const comparisonPoints = rawComparisonPoints
        .filter((point: unknown) => point && typeof point === "object") as ListedMedianPoint[];
      return [productId, [
        {
          printingType: "Storefront",
          listedMedianPrice: typeof details.medianPrice === "number" ? details.medianPrice : null,
        },
        ...comparisonPoints,
      ]] as [string, ListedMedianPoint[]];
    }));
    return Object.fromEntries(entries) as Record<string, ListedMedianPoint[]>;
  }

  const response = await fetch(`/api/tcgplayer-listed-median?productIds=${encodeURIComponent(productIds.join(","))}`, {
    headers: { Accept: "application/json" },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "TCGplayer Listed Median pricing failed.");
  return payload.prices || {};
}

function fallbackTreatments(print: any) {
  const effects = new Set([
    ...(Array.isArray(print.frame_effects) ? print.frame_effects : []),
    ...(Array.isArray(print.promo_types) ? print.promo_types : []),
  ].map((value) => String(value).toLowerCase().replace(/[^a-z]/g, "")));
  const treatments = [];
  if (print.full_art || effects.has("fullart")) treatments.push("full-art");
  if (effects.has("showcase")) treatments.push("showcase");
  if (print.border_color === "borderless" || effects.has("borderless")) treatments.push("borderless");
  if (effects.has("extendedart")) treatments.push("extended-art");
  if (effects.has("retroframe") || effects.has("oldframe")) treatments.push("retro");
  return treatments.length ? treatments : ["standard"];
}

function fallbackCatalogFromItems(items: any[]): PricingCatalog {
  const catalog: PricingCatalog = {};
  items.filter((item) => item.status === "found").forEach((item) => {
    const name = outputDisplayName(item);
    const key = pricingNameKey(name);
    const printings = (Array.isArray(item.prints) ? item.prints : [])
      .filter((print) => !print.digital)
      .filter((print) => !print.lang || print.lang === "en")
      .filter((print) => !Array.isArray(print.games) || print.games.includes("paper"))
      .map((print) => {
        const rawFinishes = Array.isArray(print.finishes) ? print.finishes : [];
        const finishes = Array.from(new Set([
          ...(print.nonfoil ? ["normal"] : []),
          ...(print.foil ? ["foil"] : []),
          ...rawFinishes.map((finish) => finish === "nonfoil" ? "normal" : finish),
        ].filter((finish): finish is PricingFinish => ["normal", "foil", "etched"].includes(finish))));
        return {
          uuid: String(print.id || `${print.set}-${print.collector_number}`),
          tcgplayerProductId: String(print.tcgplayer_id || ""),
          tcgplayerEtchedProductId: String(print.tcgplayer_etched_id || ""),
          setCode: String(print.set || "").toUpperCase(),
          setName: String(print.set_name || print.set || ""),
          keyruneCode: String(print.set || "").toLowerCase(),
          releaseDate: String(print.released_at || ""),
          number: String(print.collector_number || ""),
          rarity: String(print.rarity || ""),
          treatments: fallbackTreatments(print),
          finishes: finishes.length ? finishes : ["normal" as PricingFinish],
          prices: {},
        };
      })
      .filter((printing) => printing.setCode);
    if (printings.length) catalog[key] = { name, printings };
  });
  return catalog;
}

function rowsWithDefaultPrintings(rows: PricingRow[], catalog: PricingCatalog) {
  return rows.map((row) => {
    if (!row.resolved) return row;
    const card = cardFromCatalog(catalog, row.cardName);
    const editions = editionOptions(card);
    if (!editions.length || editions.some((edition) => edition.setCode === row.setCode)) return row;
    const setCode = preferredDefaultEdition(card)?.setCode || "";
    if (!setCode) return row;
    const finishes = finishOptions(card, setCode, "standard");
    const finish = finishes.includes("normal") ? "normal" : finishes[0];
    return { ...row, setCode, treatment: "standard", finish };
  });
}

export default function PricingPanel({
  visible,
  items,
  customer,
  processedAt,
  apiOrigin,
  logoUrl,
  onMessage,
}: PricingPanelProps) {
  const [rows, setRows] = useState<PricingRow[]>([]);
  const [catalog, setCatalog] = useState<PricingCatalog>({});
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [loadMessage, setLoadMessage] = useState("Pricing data loads after a list is processed.");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hydratingRows, setHydratingRows] = useState<Set<string>>(new Set());
  const [pricingSource, setPricingSource] = useState("tcgplayer-listed-median");
  const [mtgjsonPriceSources, setMtgjsonPriceSources] = useState<MtgjsonPriceSourceOption[]>(LEGACY_MTGJSON_PRICE_SOURCES);
  const [includeNotFound, setIncludeNotFound] = useState(true);
  const [receiptSettingsOpen, setReceiptSettingsOpen] = useState(false);
  const [eurUsdRate, setEurUsdRate] = useState<EurUsdRate>({ status: "idle", rate: null, date: "" });
  const [openPrintingRowId, setOpenPrintingRowId] = useState<string | null>(null);
  const [printingMenuPosition, setPrintingMenuPosition] = useState<PrintingMenuPosition | null>(null);
  const [listedMedianByProduct, setListedMedianByProduct] = useState<Record<string, ListedMedianEntry>>({});
  const manifestRef = useRef<PricingManifest | null>(null);
  const catalogRef = useRef<PricingCatalog>({});
  const loadedShardsRef = useRef(new Set<string>());
  const usingLiveFallbackRef = useRef(false);
  const requestedMedianIdsRef = useRef(new Set<string>());
  const initializedAtRef = useRef<string | null>(null);
  const receiptSettingsRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!receiptSettingsOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (!receiptSettingsRef.current?.contains(event.target as Node)) setReceiptSettingsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setReceiptSettingsOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [receiptSettingsOpen]);

  useEffect(() => {
    if (!processedAt || !items.length) {
      if (!items.length) setRows([]);
      initializedAtRef.current = null;
      return;
    }
    if (initializedAtRef.current === processedAt) return;
    initializedAtRef.current = processedAt;
    setRows(createPricingRows(items));
  }, [items, processedAt]);

  const cardNames = useMemo(
    () => Array.from(new Set(rows.filter((row) => row.resolved).map((row) => row.cardName))),
    [rows],
  );
  const cardNameSignature = cardNames.join("|");

  async function loadPricingData(force = false) {
    if (!cardNames.length) {
      setLoadState("ready");
      setLoadMessage("Unresolved cards can be entered manually.");
      return;
    }

    setLoadState("loading");
    setLoadMessage("Loading MTGJSON pricing printings...");
    try {
      if (force) {
        manifestRef.current = null;
        loadedShardsRef.current.clear();
        catalogRef.current = {};
        requestedMedianIdsRef.current.clear();
        setListedMedianByProduct({});
        setMtgjsonPriceSources(LEGACY_MTGJSON_PRICE_SOURCES);
        setCatalog({});
      }
      if (!manifestRef.current) {
        const response = await fetch(`${apiOrigin}/api/mtgjson-pricing-index`, {
          headers: { Accept: "application/json" },
        });
        const manifest = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(manifest.error || "Pricing index is unavailable.");
        manifestRef.current = manifest;
        if (Array.isArray(manifest.priceSources) && manifest.priceSources.length) {
          setMtgjsonPriceSources(selectableMtgjsonPriceSources(manifest.priceSources));
        }
      }

      const shardKeys = Array.from(new Set(cardNames.map(pricingShardKey)))
        .filter((key) => !loadedShardsRef.current.has(key));
      const shards = await Promise.all(shardKeys.map(async (key) => {
        const url = manifestShardUrl(manifestRef.current!, key);
        if (!url) return { key, cards: {} };
        const separator = url.includes("?") ? "&" : "?";
        const response = await fetch(`${url}${separator}v=${encodeURIComponent(manifestRef.current?.generatedAt || "latest")}`);
        if (!response.ok) throw new Error(`Pricing shard ${key.toUpperCase()} failed to load.`);
        const shard = await response.json();
        return { key, cards: shard.cards || {} };
      }));

      const nextCatalog = { ...catalogRef.current };
      shards.forEach(({ key, cards }) => {
        Object.assign(nextCatalog, cards);
        loadedShardsRef.current.add(key);
      });
      catalogRef.current = nextCatalog;
      setCatalog(nextCatalog);
      setRows((current) => rowsWithDefaultPrintings(current, nextCatalog));
      usingLiveFallbackRef.current = false;
      setLoadState("ready");
      setLoadMessage(pricingSource === "tcgplayer-listed-median"
        ? "Using TCGplayer Listed Median for nonfoil and Near Mint comparison pricing for foil; yellow warnings mark foil and fallback prices."
        : "Using the selected MTGJSON price listing.");
    } catch (error) {
      const fallbackCatalog = fallbackCatalogFromItems(items);
      if (Object.keys(fallbackCatalog).length) {
        catalogRef.current = fallbackCatalog;
        setCatalog(fallbackCatalog);
        setRows((current) => rowsWithDefaultPrintings(current, fallbackCatalog));
        usingLiveFallbackRef.current = true;
        setLoadState("ready");
        setLoadMessage(pricingSource === "tcgplayer-listed-median"
          ? "Using TCGplayer Listed Median for nonfoil and Near Mint comparison pricing for foil; yellow warnings mark foil and fallback prices."
          : "Printing history is ready. MTGJSON prices load automatically when a card is marked Found.");
      } else {
        setLoadState("error");
        setLoadMessage(error instanceof Error ? error.message : "Pricing data failed to load.");
      }
    }
  }

  useEffect(() => {
    if (!visible || !rows.length) return;
    loadPricingData();
  }, [visible, cardNameSignature, processedAt]);

  useEffect(() => {
    if (pricingSource !== "cardmarket:retail" || eurUsdRate.status !== "idle") return;
    setEurUsdRate({ status: "loading", rate: null, date: "" });
    void fetch("https://api.frankfurter.dev/v2/rate/EUR/USD", {
      headers: { Accept: "application/json" },
    }).then(async (response) => {
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !Number.isFinite(Number(payload.rate)) || Number(payload.rate) <= 0) {
        throw new Error("EUR to USD conversion is unavailable.");
      }
      setEurUsdRate({
        status: "ready",
        rate: Number(payload.rate),
        date: String(payload.date || ""),
      });
    }).catch(() => {
      setEurUsdRate({ status: "error", rate: null, date: "" });
    });
  }, [pricingSource, eurUsdRate.status]);

  useEffect(() => {
    if (!openPrintingRowId) return;
    const closePrintingMenu = () => {
      setOpenPrintingRowId(null);
      setPrintingMenuPosition(null);
    };
    const closeOutside = (event: PointerEvent) => {
      const picker = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-printing-row]");
      if (picker?.dataset.printingRow !== openPrintingRowId) closePrintingMenu();
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePrintingMenu();
    };
    const closeOnOutsideScroll = (event: Event) => {
      const menu = (event.target as HTMLElement | null)?.closest?.<HTMLElement>("[data-printing-menu]");
      if (menu?.dataset.printingMenu === openPrintingRowId) return;
      closePrintingMenu();
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    document.addEventListener("scroll", closeOnOutsideScroll, true);
    window.addEventListener("resize", closePrintingMenu);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
      document.removeEventListener("scroll", closeOnOutsideScroll, true);
      window.removeEventListener("resize", closePrintingMenu);
    };
  }, [openPrintingRowId]);

  useEffect(() => {
    setOpenPrintingRowId(null);
    setPrintingMenuPosition(null);
  }, [processedAt, visible]);

  useEffect(() => {
    if (pricingSource !== "tcgplayer-listed-median") return;
    const productIds = Array.from(new Set(rows
      .filter((row) => row.found && row.quantity > 0)
      .map((row) => tcgplayerProductIdForSelection(
        cardFromCatalog(catalog, row.cardName),
        row.setCode,
        row.treatment,
        row.finish,
      ))
      .filter(Boolean)))
      .filter((productId) => !requestedMedianIdsRef.current.has(productId));
    if (!productIds.length) return;

    productIds.forEach((productId) => requestedMedianIdsRef.current.add(productId));
    setListedMedianByProduct((current) => ({
      ...current,
      ...Object.fromEntries(productIds.map((productId) => [productId, { status: "loading", points: [] }])),
    }));

    void fetchStorefrontMedianPoints(productIds).then((prices) => {
      setListedMedianByProduct((current) => ({
        ...current,
        ...Object.fromEntries(productIds.map((productId) => [productId, {
          status: "ready",
          points: Array.isArray(prices[productId]) ? prices[productId] : [],
        }])),
      }));
    }).catch((error) => {
      productIds.forEach((productId) => requestedMedianIdsRef.current.delete(productId));
      setListedMedianByProduct((current) => ({
        ...current,
        ...Object.fromEntries(productIds.map((productId) => [productId, { status: "error", points: [] }])),
      }));
      const reason = error instanceof Error ? error.message : "TCGplayer Listed Median pricing failed.";
      setLoadMessage(`${reason} Yellow warnings mark prices using the MTGJSON fallback.`);
    });
  }, [pricingSource, rows, catalog]);

  function updateRow(id: string, update: Partial<PricingRow> | ((row: PricingRow) => Partial<PricingRow>)) {
    setRows((current) => current.map((row) => (
      row.id === id ? { ...row, ...(typeof update === "function" ? update(row) : update) } : row
    )));
  }

  async function hydrateLivePrice(row: PricingRow, setCode = row.setCode) {
    if (!usingLiveFallbackRef.current || !setCode || hydratingRows.has(row.id)) return;
    setHydratingRows((current) => new Set(current).add(row.id));
    setLoadMessage(`Loading ${setCode.toUpperCase()} pricing from MTGJSON...`);
    try {
      const { loadLiveMtgjsonPrintings } = await import("./mtgjson-live-pricing");
      const livePrintings = await loadLiveMtgjsonPrintings(row.cardName, setCode);
      if (!livePrintings.length) throw new Error(`MTGJSON did not match ${row.cardName} in ${setCode.toUpperCase()}.`);

      const cardKey = pricingNameKey(row.cardName);
      const currentCard = catalogRef.current[cardKey] || { name: row.cardName, printings: [] };
      const normalizedSetCode = setCode.toUpperCase();
      const nextCatalog = {
        ...catalogRef.current,
        [cardKey]: {
          ...currentCard,
          printings: [
            ...currentCard.printings.filter((printing) => printing.setCode !== normalizedSetCode),
            ...livePrintings,
          ],
        },
      };
      catalogRef.current = nextCatalog;
      setCatalog(nextCatalog);
      setLoadMessage(pricingSource === "tcgplayer-listed-median"
        ? "Using TCGplayer Listed Median for nonfoil and Near Mint comparison pricing for foil; yellow warnings mark foil and fallback prices."
        : "Live MTGJSON pricing loaded: TCGplayer retail, with Card Kingdom retail fallback.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "MTGJSON pricing failed to load.";
      setLoadMessage(`${message} This row can still be priced manually.`);
    } finally {
      setHydratingRows((current) => {
        const next = new Set(current);
        next.delete(row.id);
        return next;
      });
    }
  }

  function quantityMaximum(row: PricingRow) {
    const otherQuantity = rows
      .filter((candidate) => candidate.groupId === row.groupId && candidate.id !== row.id)
      .reduce((sum, candidate) => sum + candidate.quantity, 0);
    return pricingQuantityMaximum(row.requestedQuantity, otherQuantity);
  }

  function duplicateRow(source: PricingRow) {
    setRows((current) => {
      const groupRows = current.filter((row) => row.groupId === source.groupId);
      const currentTotal = groupRows.reduce((sum, row) => sum + row.quantity, 0);
      let duplicateQuantity = pricingQuantityMaximum(
        source.requestedQuantity,
        currentTotal,
      );
      let next = current;
      if (!duplicateQuantity && source.quantity > 1) {
        duplicateQuantity = 1;
        next = current.map((row) => row.id === source.id ? { ...row, quantity: row.quantity - 1 } : row);
      }
      const duplicate = {
        ...source,
        id: rowId(source.groupId),
        quantity: duplicateQuantity,
        found: true,
      };
      const sourcePosition = next.findIndex((row) => row.id === source.id);
      return [...next.slice(0, sourcePosition + 1), duplicate, ...next.slice(sourcePosition + 1)];
    });
  }

  function removeRow(id: string) {
    setRows((current) => current.filter((row) => row.id !== id));
  }

  function listedMedianPricing(row: PricingRow) {
    if (!row.setCode) {
      return { status: "select-printing" as const, price: null, source: "" as const, message: "Choose a printing before pricing this card." };
    }
    const card = cardFromCatalog(catalog, row.cardName);
    const productId = tcgplayerProductIdForSelection(card, row.setCode, row.treatment, row.finish);
    if (!productId) {
      return { status: "unavailable" as const, price: null, source: "" as const, message: "No exact TCGplayer product matched this selection. Use the TCGplayer link when available or enter a price manually." };
    }
    const entry = listedMedianByProduct[productId];
    if (!entry || entry.status === "loading") {
      return { status: "loading" as const, price: null, source: "" as const, message: `Loading TCGplayer pricing for product #${productId}...` };
    }
    if (entry.status === "error") {
      return { status: "unavailable" as const, price: null, source: "" as const, message: `TCGplayer pricing could not be loaded for product #${productId}.` };
    }
    const listedMedianPrice = listedMedianPriceForFinish(entry.points, row.finish);
    if (listedMedianPrice === null) {
      return {
        status: "unavailable" as const,
        price: null,
        source: "" as const,
        message: row.finish === "foil"
          ? `TCGplayer has no Near Mint foil comparison price for product #${productId}.`
          : `TCGplayer has no storefront Listed Median for product #${productId}.`,
      };
    }
    return {
      status: "ready" as const,
      price: listedMedianPrice,
      source: "tcgplayer-listed-median" as const,
      message: row.finish === "foil"
        ? `TCGplayer Near Mint foil comparison price · product #${productId}.`
        : `TCGplayer storefront Listed Median · product #${productId}`,
    };
  }

  const selectedMtgjsonSource = mtgjsonPriceSources.find((source) => source.key === pricingSource);
  const selectedCurrency = pricingSource === "tcgplayer-listed-median" || pricingSource === "cardmarket:retail"
    ? "USD"
    : selectedMtgjsonSource?.currency || "USD";
  const currencySymbol = priceCurrencySymbol(selectedCurrency);

  function effectivePricing(row: PricingRow) {
    const card = cardFromCatalog(catalog, row.cardName);
    const selectedSource = pricingSource === "tcgplayer-listed-median" ? "tcgplayer:retail" : pricingSource;
    let mtgjsonPricing = priceForSelection(card, row.setCode, row.treatment, row.finish, selectedSource);
    if (pricingSource === "tcgplayer-listed-median" && mtgjsonPricing.status === "unavailable") {
      const cardKingdomFallback = priceForSelection(card, row.setCode, row.treatment, row.finish, "cardkingdom:retail");
      if (cardKingdomFallback.status === "ready") mtgjsonPricing = cardKingdomFallback;
    }
    const listedMedian = pricingSource === "tcgplayer-listed-median" && row.found
      ? listedMedianPricing(row)
      : null;
    let automatic = listedMedian
      ? priceWithListedMedianFallback(listedMedian, mtgjsonPricing)
      : mtgjsonPricing;
    if (pricingSource === "cardmarket:retail") {
      if (eurUsdRate.status === "ready") {
        automatic = {
          ...automatic,
          price: convertCurrencyPrice(automatic.price, eurUsdRate.rate),
          message: `${automatic.message} · converted from EUR to USD at ${eurUsdRate.rate}${eurUsdRate.date ? ` (${eurUsdRate.date})` : ""}.`,
        };
      } else {
        automatic = {
          status: eurUsdRate.status === "error" ? "unavailable" : "loading",
          price: null,
          source: "cardmarket:retail",
          message: eurUsdRate.status === "error"
            ? "The EUR to USD conversion rate could not be loaded. Enter a price manually or choose another source."
            : "Loading the EUR to USD conversion rate...",
        };
      }
    }
    const varianceRatio = listedMedian?.status === "ready"
      ? priceVarianceRatio(listedMedian.price, mtgjsonPricing.status === "ready" ? mtgjsonPricing.price : null)
      : null;
    const override = row.priceOverride === null ? null : parsePrice(row.priceOverride);
    const automaticPrice = applyMinimumPrice(
      automatic.price,
      row.isBasicLand,
      row.treatment,
      row.finish,
    );
    const overridePrice = applyMinimumPrice(
      override,
      row.isBasicLand,
      row.treatment,
      row.finish,
    );
    return {
      card,
      automatic: automaticPrice === automatic.price ? automatic : {
        ...automatic,
        price: automaticPrice,
        message: `${automatic.message}; raised to the ${currencySymbol}${minimumPriceForSelection(row.isBasicLand, row.treatment, row.finish).toFixed(2)} minimum.`,
      },
      price: row.priceOverride === null ? automaticPrice : overridePrice,
      source: row.priceOverride === null ? automatic.source : "manual",
      isManual: row.priceOverride !== null,
      varianceRatio,
      comparisonPrice: mtgjsonPricing.status === "ready" ? mtgjsonPricing.price : null,
      listedMedianPrice: listedMedian?.status === "ready" ? listedMedian.price : null,
    };
  }

  const groups = useMemo(() => {
    const grouped = new Map<string, PricingRow[]>();
    rows.forEach((row) => grouped.set(row.groupId, [...(grouped.get(row.groupId) || []), row]));
    return Array.from(grouped.values());
  }, [rows]);

  const requestedCount = groups.reduce((sum, group) => sum + (group[0]?.requestedQuantity || 0), 0);
  const checkedRows = rows.filter((row) => row.found && row.quantity > 0);
  const foundRows = checkedRows.filter((row) => effectivePricing(row).price !== null);
  const foundCount = checkedRows.reduce((sum, row) => sum + row.quantity, 0);
  const unpricedFoundCount = checkedRows.length - foundRows.length;
  const totalPrice = foundRows.reduce((sum, row) => sum + row.quantity * (effectivePricing(row).price || 0), 0);
  const notFoundCards = groups.map((group) => {
    const requestedQuantity = group[0]?.requestedQuantity || 0;
    return {
      cardName: group[0]?.cardName || "Unknown card",
      quantity: remainingRequestedQuantity(
        requestedQuantity,
        group.filter((row) => row.found).map((row) => row.quantity),
      ),
    };
  }).filter((item) => item.quantity > 0);
  const notFoundCount = notFoundCards.reduce((sum, item) => sum + item.quantity, 0);
  const canPrintReceipt = !unpricedFoundCount
    && (foundRows.length > 0 || (includeNotFound && notFoundCards.length > 0));

  async function refreshPricingIndex() {
    if (isRefreshing) return;
    const secret = window.prompt("Enter the MTGJSON refresh secret.");
    if (!secret?.trim()) return;
    setIsRefreshing(true);
    onMessage("Refreshing the separate MTGJSON pricing index...");
    try {
      const response = await fetch(`${apiOrigin}/api/refresh-mtgjson-pricing-index`, {
        headers: { Authorization: `Bearer ${secret.trim()}`, Accept: "application/json" },
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || "Pricing refresh failed.");
      await loadPricingData(true);
      onMessage(`Pricing refreshed: ${Number(result.counts?.printings || 0).toLocaleString()} printings.`);
    } catch (error) {
      onMessage(error instanceof Error ? error.message : "Pricing refresh failed.");
    } finally {
      setIsRefreshing(false);
    }
  }

  async function printPricingReceipt() {
    if (!canPrintReceipt) {
      onMessage(unpricedFoundCount
        ? "Finish pricing every found row before printing."
        : "Check at least one priced card or include the cards that were not found.");
      return;
    }
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      onMessage("Print window was blocked.");
      return;
    }

    const receiptRows = foundRows.map((row) => {
      const pricing = effectivePricing(row);
      const unitPrice = pricing.price || 0;
      const lineTotal = row.quantity * unitPrice;
      return `
        <div class="card-row">
          <div class="card-main">
            <strong>${row.quantity}</strong>
            <span class="card-name">${escapeHtml(row.cardName)}</span>
          </div>
          <div class="card-meta">
            <span class="set-code">${escapeHtml(row.setCode.toUpperCase())}</span>
            <span class="treatment">${escapeHtml(receiptTreatment(row.treatment, row.finish))}</span>
            <span class="unit-price">${row.quantity > 1 ? `${escapeHtml(currencySymbol)}${unitPrice.toFixed(2)} ea.` : ""}</span>
            <span class="line-total">${escapeHtml(currencySymbol)}${lineTotal.toFixed(2)}</span>
          </div>
        </div>`;
    }).join("");
    const notFoundRows = includeNotFound ? notFoundCards.map((item) => `
      <div class="missing-row"><strong>${item.quantity}</strong><span>${escapeHtml(item.cardName)}</span></div>
    `).join("") : "";
    const receiptLogoUrl = new URL(logoUrl, window.location.origin).href;

    printWindow.document.open();
    printWindow.document.write(`<!doctype html>
      <html><head><title>RRG Priced Pull List</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Luckiest+Guy&display=swap" rel="stylesheet"><style>
        @page { size: 80mm auto; margin: 2mm; }
        * { box-sizing: border-box; }
        body { width: 76mm; margin: 0 auto; color: #111; background: #fff; font-family: Arial, Helvetica, sans-serif; font-size: 9pt; }
        .brand { padding: .75mm 0 2mm; border-bottom: 1px solid #111; text-align: center; }
        .brand img { display: block; width: 28mm; height: 28mm; margin: 0 auto .75mm; object-fit: contain; }
        .brand h1 { margin: 0; font-family: "Luckiest Guy", Arial, Helvetica, sans-serif; font-size: 17pt; font-weight: 400; letter-spacing: .4px; text-transform: uppercase; }
        .customer { padding: 1.5mm 0; border-bottom: 1px dashed #777; line-height: 1.25; }
        .customer strong { display: block; font-size: 10pt; }
        .printed { color: #555; font-size: 7.5pt; }
        .card-row { padding: 1.4mm 0; border-bottom: 1px dashed #aaa; break-inside: avoid; }
        .card-main { display: grid; grid-template-columns: 5mm minmax(0, 1fr); align-items: start; gap: .8mm; font-size: 9.5pt; line-height: 1.15; }
        .card-main strong { color: #b4202a; font-size: 10.5pt; }
        .card-main .card-name { min-width: 0; }
        .card-meta { display: grid; grid-template-columns: 19mm minmax(0, 1fr) 15mm 16mm; gap: .8mm; width: calc(100% - 5.8mm); margin: .45mm 0 0 5.8mm; font-family: Consolas, monospace; font-size: 8pt; font-weight: 700; line-height: 1.1; }
        .card-meta .treatment { white-space: nowrap; text-align: left; }
        .card-meta .unit-price { white-space: nowrap; text-align: right; font-style: italic; }
        .card-meta .line-total { white-space: nowrap; text-align: right; }
        .totals { margin-top: 2mm; padding: 2mm; border: 1.25px solid #111; border-top: 1mm solid #111; }
        .found { font-size: 8.5pt; font-weight: 700; }
        .total { display: flex; justify-content: space-between; margin-top: .8mm; font-size: 13pt; font-weight: 900; }
        .not-found { margin-top: 2mm; padding-top: 1.2mm; border-top: 1px solid #111; break-inside: avoid; }
        .not-found h2 { display: flex; justify-content: space-between; margin: 0 0 .5mm; font-size: 9pt; }
        .not-found h2 span { font-size: 7.5pt; font-weight: 700; }
        .missing-row { display: grid; grid-template-columns: 5mm minmax(0, 1fr); gap: .8mm; padding: .55mm 0; border-bottom: 1px dotted #bbb; font-size: 8.5pt; line-height: 1.1; }
        .missing-row strong { color: #b4202a; }
        .thanks { margin-top: 2mm; color: #555; font-size: 7.5pt; font-style: italic; text-align: center; }
        @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
      </style></head><body>
        <header class="brand"><img src="${receiptLogoUrl}" alt=""><h1>Priced Pull List</h1></header>
        <section class="customer">
          <strong>${escapeHtml(customer.name || "Customer")}</strong>
          ${customer.contact ? `<div>${escapeHtml(customer.contact)}</div>` : ""}
          <div class="printed">Priced ${escapeHtml(printedTimestamp(processedAt))}</div>
        </section>
        <main>${receiptRows}</main>
        <footer class="totals"><div class="found">${foundCount}/${requestedCount} cards found</div><div class="total"><span>TOTAL</span><span>${escapeHtml(currencySymbol)}${totalPrice.toFixed(2)}</span></div></footer>
        ${notFoundRows ? `<section class="not-found"><h2><span>NOT FOUND</span><span>${notFoundCount} card${notFoundCount === 1 ? "" : "s"}</span></h2>${notFoundRows}</section>` : ""}
        <p class="thanks">Thanks for shopping local!</p>
      </body></html>`);
    printWindow.document.close();
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 400);
  }

  if (!visible) return null;

  return (
    <section className="pricing-section">
      <div className="section-heading pricing-heading">
        <div>
          <h2>Pricing Assistant <span className="experimental-pill">THIS IS STILL EXPERIMENTAL</span></h2>
        </div>
        <div className="actions">
          <select
            className="pricing-source-selector"
            value={pricingSource}
            onChange={(event) => {
              const source = event.target.value;
              setPricingSource(source);
              if (source === "cardmarket:retail" && eurUsdRate.status === "error") {
                setEurUsdRate({ status: "idle", rate: null, date: "" });
              }
            }}
            aria-label="Automatic pricing source"
            title="Choose the automatic price used for found cards"
          >
            <option value="tcgplayer-listed-median">TCGPlayer Listed Median</option>
            {selectableMtgjsonPriceSources(mtgjsonPriceSources).map((source) => (
              <option value={source.key} key={source.key}>{mtgjsonPriceSourceLabel(source)}</option>
            ))}
          </select>
          <button className="icon-button" type="button" onClick={() => loadPricingData(true)} disabled={loadState === "loading" || !rows.length} title="Reload pricing data">
            {loadState === "loading" ? <Loader2 size={17} className="spin" /> : <RefreshCw size={17} />}
          </button>
          <button className="icon-button" type="button" onClick={refreshPricingIndex} disabled={isRefreshing} title="Rebuild the MTGJSON pricing index">
            {isRefreshing ? <Loader2 size={17} className="spin" /> : <span className="pricing-refresh-label">MTGJSON</span>}
          </button>
          <div className="receipt-settings" ref={receiptSettingsRef}>
            <button
              className={`icon-button ${receiptSettingsOpen ? "is-active" : ""}`}
              type="button"
              onClick={() => setReceiptSettingsOpen((open) => !open)}
              title="Receipt print settings"
              aria-label="Receipt print settings"
              aria-haspopup="dialog"
              aria-expanded={receiptSettingsOpen}
            >
              <Settings size={17} />
            </button>
            {receiptSettingsOpen && (
              <div className="receipt-settings-panel" role="dialog" aria-label="Receipt print settings">
                <label className="receipt-not-found-toggle" title="Include requested cards that were not found beneath the receipt total">
                  <input type="checkbox" checked={includeNotFound} onChange={(event) => setIncludeNotFound(event.target.checked)} />
                  <span>Print Not Found</span>
                </label>
              </div>
            )}
          </div>
          <button className="icon-button primary" type="button" onClick={printPricingReceipt} disabled={!canPrintReceipt} title={unpricedFoundCount ? "Finish pricing every found row before printing" : "Print branded pricing receipt"}>
            <Printer size={18} /><span>Print Pricing</span>
          </button>
        </div>
      </div>

      {!rows.length ? (
        <div className="pricing-empty">
          <strong>Process the pull list to begin pricing.</strong>
          <span>The pricing rows follow the formatter’s final rarity and alphabetical order.</span>
        </div>
      ) : (
        <>
          <div className="pricing-column-labels" aria-hidden="true">
            <span>Found</span><span>Qty</span><span>Card</span><span>Printing</span><span>Finish</span><span>Treatment</span><span>Condition</span><span>{pricingSource === "tcgplayer-listed-median" ? "Each (TCG)" : "Each"}</span><span>Actions</span>
          </div>
          <div className="pricing-groups">
            {groups.map((group) => (
              <div className={`pricing-group ${group.length > 1 ? "is-split" : ""}`} key={group[0].groupId}>
                {group.map((row, rowIndex) => {
                  const pricing = effectivePricing(row);
                  const editions = editionOptions(pricing.card);
                  const selectedEdition = editions.find((edition) => edition.setCode === row.setCode);
                  const treatments = treatmentOptions(pricing.card, row.setCode);
                  const finishes = finishOptions(pricing.card, row.setCode, row.treatment);
                  const priceValue = row.found
                    ? (row.priceOverride === null ? formatPrice(pricing.automatic.price) : row.priceOverride)
                    : "";
                  const priceIsValid = pricing.price !== null;
                  const isHydrating = hydratingRows.has(row.id);
                  const isPriceLoading = row.found && (isHydrating || pricing.automatic.status === "loading");
                  const canMarkFound = row.resolved
                    && loadState === "ready"
                    && (editions.length > 0 || row.isBasicLand);
                  const controlsEnabled = row.found && canMarkFound;
                  const needsWarning = !row.resolved
                    || loadState === "error"
                    || (row.found && !priceIsValid && !isPriceLoading);
                  const usingMtgjsonFallback = pricingSource === "tcgplayer-listed-median"
                    && row.found
                    && row.priceOverride === null
                    && pricing.automatic.status === "ready"
                    && pricing.automatic.source !== "tcgplayer-listed-median";
                  const foilNeedsDoubleCheck = row.found && row.finish === "foil";
                  const showYellowWarning = usingMtgjsonFallback || foilNeedsDoubleCheck;
                  const yellowWarningMessage = foilNeedsDoubleCheck
                    ? `${pricing.automatic.message || "Foil comparison price selected."} Double-check this foil price before printing.`
                    : pricing.automatic.message;
                  const warningMessage = !row.resolved
                    ? "This card needs review before it can be priced."
                    : loadState === "error"
                      ? loadMessage
                      : isPriceLoading
                        ? pricing.automatic.message || "Loading this printing's current price."
                        : pricing.automatic.message || "This found card still needs a price.";
                  const groupCanRemove = group.length > 1;
                  const maxQuantity = quantityMaximum(row);
                  const tcgplayerProductId = tcgplayerProductIdForSelection(
                    pricing.card,
                    row.setCode,
                    row.treatment,
                    row.finish,
                  );
                  const tcgplayerUrl = tcgplayerProductId
                    ? `https://www.tcgplayer.com/product/${encodeURIComponent(tcgplayerProductId)}`
                    : "";
                  const tcgplayerSearchUrl = tcgplayerCardSearchUrl(row.cardName);
                  const needsVarianceReview = pricingSource === "tcgplayer-listed-median"
                    && !pricing.isManual
                    && requiresPriceVarianceReview(pricing.listedMedianPrice, pricing.comparisonPrice);
                  const variancePercent = pricing.varianceRatio === null
                    ? 0
                    : Math.round(pricing.varianceRatio * 100);
                  const varianceMessage = needsVarianceReview
                    ? `Manual price check: TCGplayer Listed Median ${currencySymbol}${pricing.listedMedianPrice?.toFixed(2)} is ${Math.abs(variancePercent)}% ${variancePercent > 0 ? "higher" : "lower"} than MTGJSON ${currencySymbol}${pricing.comparisonPrice?.toFixed(2)}.`
                    : "";

                  return (
                    <div className={`pricing-row ${!row.found ? "is-awaiting-found" : ""} ${needsVarianceReview ? "is-price-review" : ""}`} key={row.id}>
                      <div className="pricing-found-cell">
                        <input
                          type="checkbox"
                          checked={row.found}
                          disabled={!canMarkFound}
                          onChange={(event) => {
                            const found = event.target.checked;
                            updateRow(row.id, { found });
                            if (found) void hydrateLivePrice(row);
                          }}
                          aria-label={`Found ${row.cardName}`}
                          title={canMarkFound ? "I found this card; enable its pricing controls" : warningMessage}
                        />
                      </div>
                      <select
                        className="pricing-quantity"
                        value={row.quantity}
                        disabled={!controlsEnabled}
                        onChange={(event) => {
                          const quantity = Number(event.target.value);
                          updateRow(row.id, { quantity, found: quantity ? row.found : false });
                        }}
                        aria-label={`Quantity found for ${row.cardName}`}
                      >
                        {Array.from({ length: maxQuantity + 1 }, (_, quantity) => <option value={quantity} key={quantity}>{quantity}</option>)}
                      </select>

                      <div className="pricing-card-name">
                        {group.length > 1 && <span className="pricing-connector" aria-hidden="true">{rowIndex ? "↳" : "●"}</span>}
                        <strong>{row.cardName}</strong>
                        {showYellowWarning && (
                          <span
                            className="pricing-fallback-warning"
                            title={yellowWarningMessage}
                            aria-label={foilNeedsDoubleCheck
                              ? `${row.cardName} foil price should be double-checked`
                              : `${row.cardName} is using MTGJSON fallback pricing`}
                          ><AlertTriangle size={18} /></span>
                        )}
                        {needsWarning && (
                          <a
                            className="pricing-warning"
                            href={tcgplayerSearchUrl}
                            target="_blank"
                            rel="noreferrer"
                            title={`${warningMessage} Search TCGplayer for this card.`}
                            aria-label={`Search TCGplayer for ${row.cardName}`}
                          ><AlertCircle size={17} /></a>
                        )}
                      </div>

                      <div
                        className={`pricing-set-control pricing-printing-picker ${openPrintingRowId === row.id ? "is-open" : ""}`}
                        data-printing-row={row.id}
                      >
                        <button
                          type="button"
                          className="pricing-printing-trigger"
                          disabled={!controlsEnabled || !editions.length}
                          onClick={(event) => {
                            if (openPrintingRowId === row.id) {
                              setOpenPrintingRowId(null);
                              setPrintingMenuPosition(null);
                              return;
                            }
                            const rect = event.currentTarget.getBoundingClientRect();
                            const width = Math.max(rect.width, 300);
                            const desiredHeight = Math.min(280, editions.length * 43 + 10);
                            const spaceBelow = window.innerHeight - rect.bottom - 8;
                            const opensAbove = spaceBelow < Math.min(desiredHeight, 180) && rect.top > spaceBelow;
                            const maxHeight = Math.max(120, Math.min(desiredHeight, opensAbove ? rect.top - 12 : spaceBelow));
                            setPrintingMenuPosition({
                              rowId: row.id,
                              top: opensAbove ? Math.max(8, rect.top - maxHeight - 4) : rect.bottom + 4,
                              left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
                              width,
                              maxHeight,
                            });
                            setOpenPrintingRowId(row.id);
                          }}
                          aria-label={`Printing for ${row.cardName}`}
                          aria-haspopup="listbox"
                          aria-expanded={openPrintingRowId === row.id}
                        >
                          {selectedEdition
                            ? <i className={`ss ss-${selectedEdition.keyruneCode} ss-fw`} aria-hidden="true" />
                            : <span className="set-symbol-placeholder" aria-hidden="true">—</span>}
                          <span className="pricing-printing-trigger-label">
                            <strong>{selectedEdition?.setCode || (row.resolved ? "Unavailable" : "Needs review")}</strong>
                            {selectedEdition && <span>: {selectedEdition.setName}</span>}
                          </span>
                          <ChevronDown size={14} aria-hidden="true" />
                        </button>
                        {openPrintingRowId === row.id && printingMenuPosition?.rowId === row.id && createPortal(
                          <div
                            className="pricing-printing-menu"
                            data-printing-row={row.id}
                            data-printing-menu={row.id}
                            role="listbox"
                            aria-label={`Available printings for ${row.cardName}`}
                            style={{
                              top: printingMenuPosition.top,
                              left: printingMenuPosition.left,
                              width: printingMenuPosition.width,
                              maxHeight: printingMenuPosition.maxHeight,
                            }}
                          >
                            {editions.map((edition) => (
                              <button
                                type="button"
                                role="option"
                                aria-selected={edition.setCode === row.setCode}
                                className={edition.setCode === row.setCode ? "is-selected" : ""}
                                key={edition.setCode}
                                onClick={() => {
                                  const setCode = edition.setCode;
                                  const availableFinishes = finishOptions(pricing.card, setCode, "standard");
                                  updateRow(row.id, {
                                    setCode,
                                    treatment: "standard",
                                    finish: availableFinishes.includes("normal") ? "normal" : availableFinishes[0],
                                  });
                                  setOpenPrintingRowId(null);
                                  setPrintingMenuPosition(null);
                                  void hydrateLivePrice(row, setCode);
                                }}
                                title={`${edition.setName} (${edition.releaseDate})`}
                              >
                                <i className={`ss ss-${edition.keyruneCode} ss-fw`} aria-hidden="true" />
                                <span><strong>{edition.setCode}</strong><small>{edition.setName}</small></span>
                                {edition.setCode === row.setCode && <Check size={15} aria-hidden="true" />}
                              </button>
                            ))}
                          </div>,
                          document.body,
                        )}
                      </div>

                      <select
                        value={row.finish}
                        disabled={!controlsEnabled}
                        onChange={(event) => updateRow(row.id, { finish: event.target.value as PricingFinish })}
                        aria-label={`Finish for ${row.cardName}`}
                      >
                        {finishes.map((finish) => <option value={finish} key={finish}>{FINISH_LABELS[finish]}</option>)}
                      </select>
                      <select
                        value={row.treatment}
                        disabled={!controlsEnabled}
                        onChange={(event) => {
                          const treatment = event.target.value;
                          const nextFinishes = finishOptions(pricing.card, row.setCode, treatment);
                          updateRow(row.id, {
                            treatment,
                            finish: nextFinishes.includes(row.finish) ? row.finish : nextFinishes[0],
                          });
                        }}
                        aria-label={`Treatment for ${row.cardName}`}
                      >
                        {treatments.map((treatment) => <option value={treatment} key={treatment}>{TREATMENT_LABELS[treatment] || treatment}</option>)}
                      </select>

                      <select
                        value="near-mint"
                        disabled
                        aria-label={`Condition for ${row.cardName}; condition pricing is coming soon`}
                        title="Condition pricing is coming soon"
                      >
                        <option value="near-mint">NM</option>
                        <option value="lightly-played">LP</option>
                        <option value="moderately-played">MP</option>
                        <option value="heavily-played">HP</option>
                        <option value="damaged">Damaged</option>
                      </select>

                      <div className={`pricing-price ${row.priceOverride !== null ? "is-manual" : ""} ${row.found && !priceIsValid && row.setCode ? "is-missing" : ""}`}>
                        <span>{currencySymbol}</span>
                        <input
                          inputMode="decimal"
                          value={priceValue}
                          disabled={!controlsEnabled}
                          onChange={(event) => updateRow(row.id, { priceOverride: event.target.value })}
                          onBlur={() => {
                            if (row.priceOverride === null) return;
                            const parsedOverride = parsePrice(row.priceOverride);
                            const minimumOverride = applyMinimumPrice(
                              parsedOverride,
                              row.isBasicLand,
                              row.treatment,
                              row.finish,
                            );
                            if (minimumOverride !== null) {
                              updateRow(row.id, { priceOverride: formatPrice(minimumOverride) });
                            }
                          }}
                          placeholder={isPriceLoading ? "Loading..." : "0.00"}
                          aria-label={`Price for one ${row.cardName}`}
                          title={row.priceOverride !== null
                            ? `Manual price · minimum ${currencySymbol}${minimumPriceForSelection(row.isBasicLand, row.treatment, row.finish).toFixed(2)}`
                            : pricing.automatic.message}
                        />
                        {isPriceLoading && <Loader2 size={13} className="spin pricing-price-loader" aria-label="Loading automatic price" />}
                        {!isPriceLoading && row.priceOverride !== null && (
                          <button type="button" disabled={!controlsEnabled} onClick={() => updateRow(row.id, { priceOverride: null })} title="Restore automatic price" aria-label="Restore automatic price">
                            <RotateCcw size={13} />
                          </button>
                        )}
                        {!isPriceLoading && row.priceOverride === null && row.found && tcgplayerUrl && (
                          <a href={tcgplayerUrl} target="_blank" rel="noreferrer" title={`Open exact TCGplayer product #${tcgplayerProductId}`} aria-label={`Open ${row.cardName} ${row.setCode} on TCGplayer`}>
                            <ExternalLink size={13} />
                          </a>
                        )}
                      </div>

                      <div className="pricing-row-actions">
                        {needsVarianceReview && (
                          <a
                            className="pricing-variance-warning"
                            href={tcgplayerUrl || tcgplayerSearchUrl}
                            target="_blank"
                            rel="noreferrer"
                            title={`${varianceMessage} Open TCGplayer to review.`}
                            aria-label={`${varianceMessage} Open TCGplayer to review.`}
                          ><AlertTriangle size={18} /></a>
                        )}
                        <button type="button" disabled={!controlsEnabled} onClick={() => duplicateRow(row)} title="Break out into another printing" aria-label={`Break out ${row.cardName} into another printing`}><CornerDownLeft size={17} /></button>
                        {groupCanRemove && <button type="button" onClick={() => removeRow(row.id)} title="Remove this split row" aria-label={`Remove split ${row.cardName}`}><Trash2 size={16} /></button>}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <footer className="pricing-total-bar">
            <div><strong>{foundCount}/{requestedCount}</strong><span>cards found</span></div>
            {unpricedFoundCount > 0 && <span className="pricing-incomplete">{unpricedFoundCount} found row{unpricedFoundCount === 1 ? "" : "s"} still need pricing</span>}
            <div className="pricing-grand-total"><span>Total</span><strong>{currencySymbol}{totalPrice.toFixed(2)}</strong></div>
          </footer>
        </>
      )}
    </section>
  );
}

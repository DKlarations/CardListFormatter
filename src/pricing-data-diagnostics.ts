export const PRICING_DATA_DIAGNOSTIC_LIMIT = 8;

export type PricingDataDiagnosticStage = "manifest" | "shard" | "fallback" | "recovery" | "retry";
export type PricingDataDiagnosticOutcome = "started" | "success" | "partial" | "failed";

/** Session-only pricing-catalog metadata. It deliberately contains no customer data or request payloads. */
export type PricingDataDiagnostic = {
  timestamp: string;
  stage: PricingDataDiagnosticStage;
  outcome: PricingDataDiagnosticOutcome;
  message: string;
  status?: number;
  shardKey?: string;
  requested?: number;
  cataloged?: number;
  missing?: number;
};

export type PricingDataDiagnosticReporter = (event: PricingDataDiagnostic) => void;

function safeText(value: unknown, maxLength = 300) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function safeMessage(value: unknown) {
  return safeText(value).replace(/https?:\/\/\S+/gi, "[URL omitted]");
}

function safeCount(value: unknown) {
  const count = Number(value);
  return Number.isInteger(count) && count >= 0 ? count : undefined;
}

function safeHttpStatus(value: unknown) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
}

export function createPricingDataDiagnostic(value: Partial<PricingDataDiagnostic>): PricingDataDiagnostic {
  const status = safeHttpStatus(value.status);
  const requested = safeCount(value.requested);
  const cataloged = safeCount(value.cataloged);
  const missing = safeCount(value.missing);
  return {
    timestamp: safeText(value.timestamp) || new Date().toISOString(),
    stage: value.stage || "fallback",
    outcome: value.outcome || "failed",
    message: safeMessage(value.message) || "Pricing data operation completed.",
    ...(status === undefined ? {} : { status }),
    ...(safeText(value.shardKey, 12) ? { shardKey: safeText(value.shardKey, 12).toUpperCase() } : {}),
    ...(requested === undefined ? {} : { requested }),
    ...(cataloged === undefined ? {} : { cataloged }),
    ...(missing === undefined ? {} : { missing }),
  };
}

export function addPricingDataDiagnostic(events: PricingDataDiagnostic[], event: PricingDataDiagnostic) {
  return [createPricingDataDiagnostic(event), ...events].slice(0, PRICING_DATA_DIAGNOSTIC_LIMIT);
}

export function pricingDataDiagnosticStageLabel(stage: PricingDataDiagnosticStage) {
  return stage.toUpperCase();
}

export function pricingDataDiagnosticOutcomeLabel(outcome: PricingDataDiagnosticOutcome) {
  return outcome.toUpperCase();
}

export function formatPricingDataDiagnosticReport(events: PricingDataDiagnostic[]) {
  const entries = events.map((event) => [
    new Date(event.timestamp).toISOString().replace("T", " ").replace(".000Z", ""),
    "",
    pricingDataDiagnosticStageLabel(event.stage),
    pricingDataDiagnosticOutcomeLabel(event.outcome),
    ...(event.status ? [`HTTP ${event.status}`] : []),
    ...(event.shardKey ? [`Shard: ${event.shardKey}`] : []),
    ...(event.requested === undefined ? [] : [
      `${event.cataloged || 0}/${event.requested} cards cataloged`,
      `${event.missing || 0} unresolved after ${event.stage}`,
    ]),
    "",
    event.message,
  ].join("\n"));
  return ["Pullsmith Pricing Data Diagnostics", ...entries].join("\n\n");
}

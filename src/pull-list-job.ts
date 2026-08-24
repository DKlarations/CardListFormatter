import {
  customerSearchFields,
  normalizeCustomer,
  type Customer,
} from "./customer.js";
import { isGeneratedSampleCustomerName } from "./generated-sample.js";
import {
  type PricingAssistantRowState,
} from "./pricing.js";
import {
  MAX_SAVED_PRICING_ENTRIES,
  normalizeExcludedSourceIndices,
  normalizePricingAssistantRow,
} from "./pricing-session.js";

export const SAVED_PULL_LIST_TTL_SECONDS = 30 * 24 * 60 * 60;
export const SAVED_PULL_LIST_SCHEMA_VERSION = 1;
export const SAVED_PRICING_STATE_VERSION = 1;

export type SavedPricingState = {
  version: 1;
  rows: PricingAssistantRowState[];
  excludedSourceIndices: number[];
  pricingSource: string;
  includeNotFound: boolean;
};

export type PullListJobStats = {
  resolvedCount: number;
  needsReviewCount: number;
  printFallbackCount: number;
};

export type PullListJobFormatterSettings = {
  useCheckboxes: boolean;
};

export type PullListJobTeamsMetadata = {
  teamId?: string;
  channelId?: string;
  messageId?: string;
  postedAt?: string;
};

export type PullListJobSearchFields = {
  name: string;
  phone: string;
  email: string;
};

export type PullListJob = {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  processedAt: string;
  customer: Customer;
  input: string;
  output: string;
  formatterItems: Array<Record<string, unknown>>;
  pricingState: SavedPricingState;
  source: "manual" | "email" | "microsoft-graph" | string;
  status?: string;
  teams?: PullListJobTeamsMetadata;
  stats: PullListJobStats;
  formatterSettings: PullListJobFormatterSettings;
  fingerprint: string;
  /** Server-maintained exact-match fields for indexed lookup. */
  search: PullListJobSearchFields;
};

export type PullListJobDraft = Pick<
  PullListJob,
  "customer" | "input" | "output" | "formatterItems" | "pricingState" | "source" | "processedAt" | "stats" | "formatterSettings"
> & {
  status?: string;
  teams?: PullListJobTeamsMetadata;
};

export type SavedJobSummary = {
  id: string;
  customer: Customer;
  createdAt: string;
  updatedAt: string;
  processedAt: string;
  cardCount: number;
  foundCount: number;
  source: string;
};

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanDocument(value: unknown) {
  return typeof value === "string" ? value : "";
}

function cleanCount(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.floor(number)) : 0;
}

function safeDate(value: unknown, fallback = new Date(0).toISOString()) {
  const text = cleanText(value);
  const date = text ? new Date(text) : new Date(fallback);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

export function expiresAtFromUpdate(updatedAt: string) {
  return new Date(new Date(updatedAt).getTime() + SAVED_PULL_LIST_TTL_SECONDS * 1000).toISOString();
}

export function emptySavedPricingState(): SavedPricingState {
  return {
    version: SAVED_PRICING_STATE_VERSION,
    rows: [],
    excludedSourceIndices: [],
    pricingSource: "tcgplayer-listed-median",
    includeNotFound: true,
  };
}

export function normalizeSavedPricingState(value: unknown): SavedPricingState {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    version: SAVED_PRICING_STATE_VERSION,
    rows: Array.isArray(raw.rows)
      ? raw.rows
        .filter((row) => row && typeof row === "object")
        .slice(0, MAX_SAVED_PRICING_ENTRIES)
        .map((row) => normalizePricingAssistantRow(row))
      : [],
    excludedSourceIndices: normalizeExcludedSourceIndices(raw.excludedSourceIndices),
    pricingSource: cleanText(raw.pricingSource) || "tcgplayer-listed-median",
    includeNotFound: raw.includeNotFound !== false,
  };
}

export function normalizePullListJobDraft(value: unknown): PullListJobDraft {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const rawStats = raw.stats && typeof raw.stats === "object" ? raw.stats as Record<string, unknown> : {};
  const teams = raw.teams && typeof raw.teams === "object" ? raw.teams as Record<string, unknown> : null;
  return {
    customer: normalizeCustomer(raw.customer),
    input: cleanDocument(raw.input),
    output: cleanDocument(raw.output),
    formatterItems: Array.isArray(raw.formatterItems)
      ? raw.formatterItems.filter((item) => item && typeof item === "object").slice(0, 1000)
      : [],
    pricingState: normalizeSavedPricingState(raw.pricingState),
    source: cleanText(raw.source) || "manual",
    processedAt: safeDate(raw.processedAt, new Date().toISOString()),
    stats: {
      resolvedCount: cleanCount(rawStats.resolvedCount),
      needsReviewCount: cleanCount(rawStats.needsReviewCount),
      printFallbackCount: cleanCount(rawStats.printFallbackCount),
    },
    formatterSettings: {
      useCheckboxes: (raw.formatterSettings as Record<string, unknown> | undefined)?.useCheckboxes !== false,
    },
    ...(cleanText(raw.status) ? { status: cleanText(raw.status) } : {}),
    ...(teams ? {
      teams: {
        ...(cleanText(teams.teamId) ? { teamId: cleanText(teams.teamId) } : {}),
        ...(cleanText(teams.channelId) ? { channelId: cleanText(teams.channelId) } : {}),
        ...(cleanText(teams.messageId) ? { messageId: cleanText(teams.messageId) } : {}),
        ...(cleanText(teams.postedAt) ? { postedAt: safeDate(teams.postedAt) } : {}),
      },
    } : {}),
  };
}

export function isPersistablePullListJobDraft(value: unknown) {
  const draft = normalizePullListJobDraft(value);
  return Boolean(
    draft.input.trim()
    && draft.output.trim()
    && draft.formatterItems.length
    && draft.processedAt
    && !isGeneratedSampleCustomerName(draft.customer.name),
  );
}

export function isGeneratedSamplePullListJobDraft(value: unknown) {
  return isGeneratedSampleCustomerName(normalizePullListJobDraft(value).customer.name);
}

export function normalizePullListJob(value: unknown): PullListJob {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const draft = normalizePullListJobDraft(raw);
  const updatedAt = safeDate(raw.updatedAt, new Date().toISOString());
  return {
    schemaVersion: SAVED_PULL_LIST_SCHEMA_VERSION,
    id: cleanText(raw.id),
    createdAt: safeDate(raw.createdAt, updatedAt),
    updatedAt,
    expiresAt: safeDate(raw.expiresAt, expiresAtFromUpdate(updatedAt)),
    ...draft,
    fingerprint: cleanText(raw.fingerprint),
    search: customerSearchFields(draft.customer),
  };
}

export function savedJobSummary(jobValue: PullListJob): SavedJobSummary {
  const job = normalizePullListJob(jobValue);
  return {
    id: job.id,
    customer: job.customer,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    processedAt: job.processedAt,
    cardCount: job.formatterItems.reduce((sum, item) => sum + Math.max(1, Number(item.quantity) || 1), 0),
    foundCount: job.pricingState.rows
      .filter((row) => row.found)
      .reduce((sum, row) => sum + Math.max(0, Number(row.quantity) || 0), 0),
    source: job.source,
  };
}

export function normalizeSavedJobSummary(value: unknown): SavedJobSummary {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    id: cleanText(raw.id),
    customer: normalizeCustomer(raw.customer),
    createdAt: safeDate(raw.createdAt),
    updatedAt: safeDate(raw.updatedAt),
    processedAt: safeDate(raw.processedAt),
    cardCount: cleanCount(raw.cardCount),
    foundCount: cleanCount(raw.foundCount),
    source: cleanText(raw.source) || "manual",
  };
}

/** Copy Link deliberately passes no pricing state; a saved job deliberately restores it. */
export function pricingStateForWorkspaceLoad(
  source: "copy-link" | "saved-job" | "fresh",
  value?: unknown,
) {
  return source === "saved-job" ? normalizeSavedPricingState(value) : null;
}

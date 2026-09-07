import { createHash, randomUUID } from "node:crypto";
import {
  customerSearchFields,
  normalizeCustomerNameForSearch,
  normalizeEmailForSearch,
  normalizePhoneForSearch,
} from "../src/customer.js";
import { pullListFingerprint } from "../src/pull-list-fingerprint.js";
import {
  expiresAtFromUpdate,
  isGeneratedSamplePullListJobDraft,
  isPersistablePullListJobDraft,
  normalizePullListJob,
  normalizePullListJobDraft,
  normalizePullListJobPrintStatus,
  updatePullListJobPrintStatus,
  savedJobSummary,
  SAVED_PULL_LIST_SCHEMA_VERSION,
  SAVED_PULL_LIST_TTL_SECONDS,
  type PullListJob,
  type PullListJobDraft,
  type PullListJobEmailDisplay,
  type PullListJobPrintTarget,
  type PullListJobTeamsMetadata,
  type SavedJobSummary,
} from "../src/pull-list-job.js";

export const PULL_LIST_JOB_KEY_PREFIX = "pull-list-job:";
export const PULL_LIST_FINGERPRINT_KEY_PREFIX = "pull-list-fingerprint:";
export const PULL_LIST_RECENT_INDEX_KEY = "pull-list-jobs:recent";
export const PULL_LIST_SEARCH_KEY_PREFIX = "pull-list-jobs:search:";

export type PullListJobStore = {
  eval<T = unknown>(script: string, keys: string[], args: unknown[]): Promise<T>;
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, options?: Record<string, unknown>): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
  zadd(key: string, value: { score: number; member: string }): Promise<unknown>;
  zrange<T = string>(key: string, start: number, stop: number, options?: Record<string, unknown>): Promise<T[]>;
  zrem(key: string, ...members: string[]): Promise<unknown>;
};

export function isPullListJobId(value: unknown): value is string {
  return typeof value === "string" && /^pl_[a-zA-Z0-9_-]{1,100}$/.test(value);
}

export function validatedPrintStatusMutation(id: unknown, target: unknown, printedAt: unknown) {
  if (!isPullListJobId(id)) throw new Error("A valid Saved Pull List ID is required.");
  if (target !== "pull-list" && target !== "pricing") throw new Error("Invalid print-status target.");
  if (typeof printedAt !== "string" || !printedAt.trim() || !Number.isFinite(Date.parse(printedAt))) {
    throw new Error("A valid print timestamp is required.");
  }
  return { id, target: target as PullListJobPrintTarget, printedAt: new Date(printedAt).toISOString() };
}

// Prefix the raw JSON so Redis clients cannot deserialize it before the CAS.
// Keeping the original bytes also avoids Lua cjson turning empty arrays into objects.
export const READ_JOB_SNAPSHOT_SCRIPT = `-- pull-list-job:read-snapshot
local value = redis.call('GET', KEYS[1])
if not value then return false end
return 'raw:' .. value
`;

export const COMPARE_AND_SET_JOB_SCRIPT = `-- pull-list-job:compare-and-set
local value = redis.call('GET', KEYS[1])
if not value then return 'not-found' end
if value ~= ARGV[1] then return 'retry' end
local owner = redis.call('GET', KEYS[2])
if ARGV[6] == 'full' and owner and owner ~= ARGV[4] then return 'duplicate' end
redis.call('SET', KEYS[1], ARGV[2], 'EX', ARGV[3])
if ARGV[6] == 'full' then
  redis.call('SET', KEYS[2], ARGV[4], 'EX', ARGV[3])
  if KEYS[2] ~= KEYS[3] and redis.call('GET', KEYS[3]) == ARGV[4] then redis.call('DEL', KEYS[3]) end
elseif owner == ARGV[4] then
  redis.call('EXPIRE', KEYS[2], ARGV[3])
end
local newCount = tonumber(ARGV[7])
for i = 4, 3 + newCount do
  redis.call('ZADD', KEYS[i], ARGV[5], ARGV[4])
  redis.call('EXPIRE', KEYS[i], ARGV[3])
end
for i = 4 + newCount, #KEYS do redis.call('ZREM', KEYS[i], ARGV[4]) end
return 'updated'
`;

export const CREATE_JOB_SCRIPT = `-- pull-list-job:create
if redis.call('GET', KEYS[2]) then return 'duplicate' end
if redis.call('EXISTS', KEYS[1]) == 1 then return 'retry' end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
for i = 3, #KEYS do
  redis.call('ZADD', KEYS[i], ARGV[4], ARGV[2])
  redis.call('EXPIRE', KEYS[i], ARGV[3])
end
return 'created'
`;

type JobSnapshot = { raw: string; job: PullListJob };

async function readJobSnapshot(store: PullListJobStore, id: string, nowMs: number): Promise<JobSnapshot | null> {
  const encoded = await store.eval<string | null>(READ_JOB_SNAPSHOT_SCRIPT, [jobKey(id)], []);
  if (!encoded) return null;
  if (!encoded.startsWith("raw:")) throw new Error("Invalid Saved Pull List storage response.");
  const raw = encoded.slice(4);
  const job = JSON.parse(raw) as PullListJob;
  if (!job || job.id !== id || !Number.isFinite(Date.parse(job.expiresAt)) || isExpired(job, nowMs)) return null;
  return { raw, job };
}

async function compareAndSetJob(store: PullListJobStore, snapshot: JobSnapshot, next: PullListJob, mode: "full" | "narrow") {
  const newIndexes = [PULL_LIST_RECENT_INDEX_KEY, ...searchIndexKeys(next.search)];
  const oldIndexes = searchIndexKeys(snapshot.job.search).filter((key) => !newIndexes.includes(key));
  return store.eval<"updated" | "not-found" | "retry" | "duplicate">(COMPARE_AND_SET_JOB_SCRIPT, [
    jobKey(next.id), fingerprintKey(next.fingerprint), fingerprintKey(snapshot.job.fingerprint),
    ...newIndexes, ...oldIndexes,
  ], [snapshot.raw, JSON.stringify(next), SAVED_PULL_LIST_TTL_SECONDS, next.id, Date.parse(next.updatedAt), mode, newIndexes.length]);
}

function latestPrintStatus(previous: unknown, incoming: unknown) {
  const stored = normalizePullListJobPrintStatus(previous);
  const proposed = normalizePullListJobPrintStatus(incoming);
  return {
    pullListPrintedAt: stored.pullListPrintedAt > proposed.pullListPrintedAt ? stored.pullListPrintedAt : proposed.pullListPrintedAt,
    pricingPrintedAt: stored.pricingPrintedAt > proposed.pricingPrintedAt ? stored.pricingPrintedAt : proposed.pricingPrintedAt,
  };
}

export type PullListJobSaveResult =
  | { status: "created" | "updated"; job: PullListJob }
  | { status: "duplicate"; existingJob: SavedJobSummary }
  | { status: "not-found" };

export type PullListJobDeleteResult =
  | { status: "deleted"; id: string }
  | { status: "not-found" };

export type PullListJobSearchQuery = {
  name?: string;
  namePrefix?: string;
  phone?: string;
  email?: string;
  limit?: number;
};

function jobKey(id: string) {
  return `${PULL_LIST_JOB_KEY_PREFIX}${id}`;
}

function fingerprintKey(fingerprint: string) {
  return `${PULL_LIST_FINGERPRINT_KEY_PREFIX}${fingerprint}`;
}

function searchToken(value: string) {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

type SearchIndexField = "name" | "name-prefix" | "phone" | "email";

function searchIndexKey(field: SearchIndexField, normalizedValue: string) {
  return `${PULL_LIST_SEARCH_KEY_PREFIX}${field}:${searchToken(normalizedValue)}`;
}

export function normalizedCustomerNamePrefixes(value: string) {
  const normalized = normalizeCustomerNameForSearch(value).slice(0, 64);
  return Array.from({ length: normalized.length }, (_, index) => normalized.slice(0, index + 1));
}

function searchIndexKeys(search: PullListJob["search"]) {
  const exactKeys = (Object.entries(search) as Array<["name" | "phone" | "email", string]>)
    .filter(([, value]) => Boolean(value))
    .map(([field, value]) => searchIndexKey(field, value));
  return [
    ...exactKeys,
    ...normalizedCustomerNamePrefixes(search.name)
      .map((prefix) => searchIndexKey("name-prefix", prefix)),
  ];
}

function isExpired(job: PullListJob, nowMs: number) {
  return new Date(job.expiresAt).getTime() <= nowMs;
}

async function removeFingerprintIfOwned(store: PullListJobStore, fingerprint: string, jobId: string) {
  if (!fingerprint) return;
  const key = fingerprintKey(fingerprint);
  if (await store.get<string>(key) === jobId) await store.del(key);
}

async function removeSearchIndexes(store: PullListJobStore, job: PullListJob) {
  await Promise.all([
    store.zrem(PULL_LIST_RECENT_INDEX_KEY, job.id),
    ...searchIndexKeys(job.search).map((key) => store.zrem(key, job.id)),
  ]);
}

export async function getPullListJob(
  store: PullListJobStore,
  id: string,
  nowMs = Date.now(),
) {
  const saved = await store.get<PullListJob>(jobKey(id));
  if (!saved) return null;
  const job = normalizePullListJob(saved);
  if (!job.id || isExpired(job, nowMs)) {
    await Promise.all([
      store.del(jobKey(id)),
      removeFingerprintIfOwned(store, job.fingerprint, id),
      removeSearchIndexes(store, { ...job, id }),
    ]);
    return null;
  }
  return job;
}

export async function findDuplicatePullListJob(
  store: PullListJobStore,
  fingerprint: string,
  currentJobId = "",
  nowMs = Date.now(),
) {
  const key = fingerprintKey(fingerprint);
  const existingId = await store.get<string>(key);
  if (!existingId || existingId === currentJobId) return null;
  const existing = await getPullListJob(store, existingId, nowMs);
  if (!existing || existing.fingerprint !== fingerprint) {
    if (await store.get<string>(key) === existingId) await store.del(key);
    return null;
  }
  return savedJobSummary(existing);
}

export async function createPullListJob(
  store: PullListJobStore,
  draftValue: PullListJobDraft,
  nowMs = Date.now(),
): Promise<PullListJobSaveResult> {
  if (isGeneratedSamplePullListJobDraft(draftValue)) {
    throw new Error("Generated sample pull lists are not saved.");
  }
  if (!isPersistablePullListJobDraft(draftValue)) {
    throw new Error("A successfully processed pull list is required.");
  }
  const draft = normalizePullListJobDraft(draftValue);
  const fingerprint = pullListFingerprint(draft.formatterItems);
  const id = `pl_${randomUUID()}`;

  const now = new Date(nowMs).toISOString();
  const job: PullListJob = {
    schemaVersion: SAVED_PULL_LIST_SCHEMA_VERSION,
    id,
    createdAt: now,
    updatedAt: now,
    expiresAt: expiresAtFromUpdate(now),
    ...draft,
    fingerprint,
    search: customerSearchFields(draft.customer),
  };
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const duplicate = await findDuplicatePullListJob(store, fingerprint, "", nowMs);
    if (duplicate) return { status: "duplicate", existingJob: duplicate };
    // Publish identity, record, and indexes together: no visible reservation gap.
    const result = await store.eval<string>(CREATE_JOB_SCRIPT, [
      jobKey(id), fingerprintKey(fingerprint), PULL_LIST_RECENT_INDEX_KEY, ...searchIndexKeys(job.search),
    ], [JSON.stringify(job), id, SAVED_PULL_LIST_TTL_SECONDS, nowMs]);
    if (result === "created") return { status: "created", job };
  }
  throw new Error("Could not create the Saved Pull List. Please retry.");
}

export async function updatePullListJob(
  store: PullListJobStore,
  id: string,
  draftValue: PullListJobDraft,
  nowMs = Date.now(),
): Promise<PullListJobSaveResult> {
  if (isGeneratedSamplePullListJobDraft(draftValue)) {
    throw new Error("Generated sample pull lists are not saved.");
  }
  if (!isPersistablePullListJobDraft(draftValue)) {
    throw new Error("A coherent processed pull list is required.");
  }
  if (!isPullListJobId(id)) throw new Error("A valid Saved Pull List ID is required.");
  const draft = normalizePullListJobDraft(draftValue);
  const fingerprint = pullListFingerprint(draft.formatterItems);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const snapshot = await readJobSnapshot(store, id, nowMs);
    if (!snapshot) return { status: "not-found" };
    const previous = snapshot.job;
    const duplicate = await findDuplicatePullListJob(store, fingerprint, id, nowMs);
    if (duplicate) return { status: "duplicate", existingJob: duplicate };
    const now = new Date(Math.max(nowMs, Date.parse(previous.updatedAt) || 0)).toISOString();
    const job: PullListJob = {
      ...previous,
      ...draft,
      source: previous.source,
      // Only trusted ingestion and registration may create or change this metadata.
      teams: previous.teams,
      emailDisplay: previous.emailDisplay,
      printStatus: { ...previous.printStatus, ...latestPrintStatus(previous.printStatus, draft.printStatus) },
      updatedAt: now,
      expiresAt: expiresAtFromUpdate(now),
      fingerprint,
      search: customerSearchFields(draft.customer),
    };
    const result = await compareAndSetJob(store, snapshot, job, "full");
    if (result === "updated") return { status: "updated", job };
    if (result === "not-found") return { status: "not-found" };
  }
  throw new Error("Saved Pull List changed repeatedly. Please retry the update.");
}

export async function mutatePullListJobPrintStatus(
  store: PullListJobStore,
  id: string,
  target: PullListJobPrintTarget,
  printedAt: string,
  nowMs = Date.now(),
): Promise<{ status: "updated"; job: PullListJob; changed: boolean } | { status: "not-found" }> {
  const mutation = validatedPrintStatusMutation(id, target, printedAt);
  const field = target === "pull-list" ? "pullListPrintedAt" : "pricingPrintedAt";
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const snapshot = await readJobSnapshot(store, id, nowMs);
    if (!snapshot) return { status: "not-found" };
    const previous = snapshot.job;
    const requested = updatePullListJobPrintStatus(previous.printStatus, target, mutation.printedAt);
    const merged = latestPrintStatus(previous.printStatus, requested);
    const changed = merged[field] !== (previous.printStatus?.[field] || "");
    const now = new Date(Math.max(nowMs, Date.parse(previous.updatedAt) || 0)).toISOString();
    const job: PullListJob = {
      ...previous,
      printStatus: { ...previous.printStatus, [field]: merged[field] },
      updatedAt: now,
      expiresAt: expiresAtFromUpdate(now),
    };
    const result = await compareAndSetJob(store, snapshot, job, "narrow");
    if (result === "updated") return { status: "updated", job, changed };
    if (result === "not-found") return { status: "not-found" };
  }
  throw new Error("Saved Pull List changed repeatedly. Please retry the print status.");
}

/** Trusted server callback only; ordinary browser saves cannot call this operation. */
export async function registerPullListJobTeams(
  store: PullListJobStore,
  id: string,
  metadata: PullListJobTeamsMetadata,
  nowMs = Date.now(),
): Promise<{ status: "updated"; job: PullListJob; changed: boolean } | { status: "not-found" | "conflict" }> {
  if (!isPullListJobId(id)) throw new Error("A valid Saved Pull List ID is required.");
  const teams = normalizePullListJobDraft({ teams: metadata }).teams;
  if (!teams?.messageId) throw new Error("The original Teams message ID is required.");
  if (metadata.postedAt && !Number.isFinite(Date.parse(metadata.postedAt))) throw new Error("Invalid Teams posting timestamp.");
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const snapshot = await readJobSnapshot(store, id, nowMs);
    if (!snapshot) return { status: "not-found" };
    const previous = snapshot.job;
    for (const field of ["teamId", "channelId", "conversationId", "messageId", "messageLink"] as const) {
      if (previous.teams?.[field] && teams[field] && previous.teams[field] !== teams[field]) return { status: "conflict" };
    }
    const mergedTeams = { ...teams, ...previous.teams };
    if (!mergedTeams.postedAt) mergedTeams.postedAt = new Date(nowMs).toISOString();
    const changed = Object.entries(mergedTeams).some(([key, value]) => previous.teams?.[key] !== value);
    if (!changed) return { status: "updated", job: previous, changed: false };
    const now = new Date(Math.max(nowMs, Date.parse(previous.updatedAt) || 0)).toISOString();
    const job: PullListJob = { ...previous, teams: mergedTeams, updatedAt: now, expiresAt: expiresAtFromUpdate(now) };
    const result = await compareAndSetJob(store, snapshot, job, "narrow");
    if (result === "updated") return { status: "updated", job, changed };
    if (result === "not-found") return { status: "not-found" };
  }
  throw new Error("Saved Pull List changed repeatedly. Please retry Teams registration.");
}
/** Durable claim prevents reposting after a successful webhook with a lost callback. */
export async function claimPullListJobTeamsPost(
  store: PullListJobStore,
  id: string,
  nowMs = Date.now(),
): Promise<{ status: "updated"; job: PullListJob; shouldPost: boolean } | { status: "not-found" }> {
  if (!isPullListJobId(id)) throw new Error("A valid Saved Pull List ID is required.");
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const snapshot = await readJobSnapshot(store, id, nowMs);
    if (!snapshot) return { status: "not-found" };
    const previous = snapshot.job;
    if (previous.teams?.messageId || previous.teams?.initialPostClaimedAt) {
      return { status: "updated", job: previous, shouldPost: false };
    }
    const now = new Date(Math.max(nowMs, Date.parse(previous.updatedAt) || 0)).toISOString();
    const job: PullListJob = {
      ...previous,
      teams: { ...previous.teams, initialPostClaimedAt: now },
      updatedAt: now,
      expiresAt: expiresAtFromUpdate(now),
    };
    const result = await compareAndSetJob(store, snapshot, job, "narrow");
    if (result === "updated") return { status: "updated", job, shouldPost: true };
    if (result === "not-found") return { status: "not-found" };
  }
  throw new Error("Saved Pull List changed repeatedly. Please retry Teams posting claim.");
}

/** Attach the first trusted email event when ingestion reuses an existing job. */
export async function attachPullListJobEmail(
  store: PullListJobStore,
  id: string,
  emailDisplay: PullListJobEmailDisplay,
  nowMs = Date.now(),
): Promise<{ status: "updated"; job: PullListJob; changed: boolean } | { status: "not-found" }> {
  if (!isPullListJobId(id)) throw new Error("A valid Saved Pull List ID is required.");
  const normalized = normalizePullListJobDraft({ emailDisplay }).emailDisplay;
  if (!normalized) throw new Error("Original email content is required.");
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const snapshot = await readJobSnapshot(store, id, nowMs);
    if (!snapshot) return { status: "not-found" };
    const previous = snapshot.job;
    if (previous.emailDisplay) return { status: "updated", job: previous, changed: false };
    const now = new Date(Math.max(nowMs, Date.parse(previous.updatedAt) || 0)).toISOString();
    const job: PullListJob = {
      ...previous, emailDisplay: normalized, source: "email", updatedAt: now, expiresAt: expiresAtFromUpdate(now),
    };
    const result = await compareAndSetJob(store, snapshot, job, "narrow");
    if (result === "updated") return { status: "updated", job, changed: true };
    if (result === "not-found") return { status: "not-found" };
  }
  throw new Error("Saved Pull List changed repeatedly. Please retry email attachment.");
}

export async function deletePullListJob(
  store: PullListJobStore,
  id: string,
  nowMs = Date.now(),
): Promise<PullListJobDeleteResult> {
  const job = await getPullListJob(store, id, nowMs);
  if (!job) return { status: "not-found" };

  await Promise.all([
    store.del(jobKey(id)),
    removeFingerprintIfOwned(store, job.fingerprint, id),
    removeSearchIndexes(store, job),
  ]);
  return { status: "deleted", id };
}

function normalizedQuery(query: PullListJobSearchQuery) {
  return {
    name: normalizeCustomerNameForSearch(query.name),
    namePrefix: normalizeCustomerNameForSearch(query.namePrefix).slice(0, 64),
    phone: normalizePhoneForSearch(query.phone),
    email: normalizeEmailForSearch(query.email),
  };
}

export async function searchPullListJobs(
  store: PullListJobStore,
  query: PullListJobSearchQuery,
  nowMs = Date.now(),
) {
  const limit = Math.max(1, Math.min(50, Math.floor(Number(query.limit) || 20)));
  const normalized = normalizedQuery(query);
  const filterKeys = (Object.entries(normalized) as Array<["name" | "namePrefix" | "phone" | "email", string]>)
    .filter(([, value]) => Boolean(value))
    .map(([field, value]) => searchIndexKey(field === "namePrefix" ? "name-prefix" : field, value));
  const indexKeys = filterKeys.length ? filterKeys : [PULL_LIST_RECENT_INDEX_KEY];
  const indexedIds = await Promise.all(indexKeys.map((key) => (
    store.zrange<string>(key, 0, Math.max(limit * 4, 50) - 1, { rev: true })
  )));
  const candidateIds = indexedIds.length === 1
    ? indexedIds[0]
    : indexedIds[0].filter((id) => indexedIds.every((ids) => ids.includes(id)));

  const summaries: SavedJobSummary[] = [];
  for (const id of candidateIds) {
    if (summaries.length >= limit) break;
    const job = await getPullListJob(store, id, nowMs);
    if (!job) {
      await Promise.all(indexKeys.map((key) => store.zrem(key, id)));
      continue;
    }
    summaries.push(savedJobSummary(job));
  }
  return summaries;
}

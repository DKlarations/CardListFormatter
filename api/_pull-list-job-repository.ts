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
  savedJobSummary,
  SAVED_PULL_LIST_SCHEMA_VERSION,
  SAVED_PULL_LIST_TTL_SECONDS,
  type PullListJob,
  type PullListJobDraft,
  type SavedJobSummary,
} from "../src/pull-list-job.js";

export const PULL_LIST_JOB_KEY_PREFIX = "pull-list-job:";
export const PULL_LIST_FINGERPRINT_KEY_PREFIX = "pull-list-fingerprint:";
export const PULL_LIST_RECENT_INDEX_KEY = "pull-list-jobs:recent";
export const PULL_LIST_SEARCH_KEY_PREFIX = "pull-list-jobs:search:";

export type PullListJobStore = {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, options?: Record<string, unknown>): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
  zadd(key: string, value: { score: number; member: string }): Promise<unknown>;
  zrange<T = string>(key: string, start: number, stop: number, options?: Record<string, unknown>): Promise<T[]>;
  zrem(key: string, ...members: string[]): Promise<unknown>;
};

export type PullListJobSaveResult =
  | { status: "created" | "updated"; job: PullListJob }
  | { status: "duplicate"; existingJob: SavedJobSummary }
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

async function indexJob(store: PullListJobStore, job: PullListJob, score: number) {
  const keys = searchIndexKeys(job.search);
  await Promise.all([
    store.zadd(PULL_LIST_RECENT_INDEX_KEY, { score, member: job.id }),
    store.expire(PULL_LIST_RECENT_INDEX_KEY, SAVED_PULL_LIST_TTL_SECONDS),
    ...keys.flatMap((key) => [
      store.zadd(key, { score, member: job.id }),
      store.expire(key, SAVED_PULL_LIST_TTL_SECONDS),
    ]),
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

async function reserveFingerprint(store: PullListJobStore, fingerprint: string, jobId: string) {
  return store.set(fingerprintKey(fingerprint), jobId, {
    ex: SAVED_PULL_LIST_TTL_SECONDS,
    nx: true,
  });
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
  const duplicate = await findDuplicatePullListJob(store, fingerprint, "", nowMs);
  if (duplicate) return { status: "duplicate", existingJob: duplicate };

  const id = `pl_${randomUUID()}`;
  const reserved = await reserveFingerprint(store, fingerprint, id);
  if (!reserved) {
    const racedDuplicate = await findDuplicatePullListJob(store, fingerprint, "", nowMs);
    if (racedDuplicate) return { status: "duplicate", existingJob: racedDuplicate };
    await store.del(fingerprintKey(fingerprint));
    const retry = await reserveFingerprint(store, fingerprint, id);
    if (!retry) throw new Error("Could not reserve the pull-list fingerprint.");
  }

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
  await store.set(jobKey(id), job, { ex: SAVED_PULL_LIST_TTL_SECONDS });
  await indexJob(store, job, nowMs);
  return { status: "created", job };
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
  const previous = await getPullListJob(store, id, nowMs);
  if (!previous) return { status: "not-found" };

  const draft = normalizePullListJobDraft(draftValue);
  const fingerprint = pullListFingerprint(draft.formatterItems);
  const duplicate = await findDuplicatePullListJob(store, fingerprint, id, nowMs);
  if (duplicate) return { status: "duplicate", existingJob: duplicate };

  if (fingerprint !== previous.fingerprint) {
    const reserved = await reserveFingerprint(store, fingerprint, id);
    if (!reserved) {
      const racedDuplicate = await findDuplicatePullListJob(store, fingerprint, id, nowMs);
      if (racedDuplicate) return { status: "duplicate", existingJob: racedDuplicate };
      await store.del(fingerprintKey(fingerprint));
      if (!await reserveFingerprint(store, fingerprint, id)) {
        throw new Error("Could not update the pull-list fingerprint.");
      }
    }
  } else {
    await store.set(fingerprintKey(fingerprint), id, { ex: SAVED_PULL_LIST_TTL_SECONDS });
  }

  const now = new Date(nowMs).toISOString();
  const job: PullListJob = {
    schemaVersion: SAVED_PULL_LIST_SCHEMA_VERSION,
    id,
    createdAt: previous.createdAt,
    updatedAt: now,
    expiresAt: expiresAtFromUpdate(now),
    ...draft,
    fingerprint,
    search: customerSearchFields(draft.customer),
  };
  await store.set(jobKey(id), job, { ex: SAVED_PULL_LIST_TTL_SECONDS });
  await indexJob(store, job, nowMs);

  if (fingerprint !== previous.fingerprint) {
    await removeFingerprintIfOwned(store, previous.fingerprint, id);
  }
  const oldSearchKeys = new Set(searchIndexKeys(previous.search));
  const newSearchKeys = new Set(searchIndexKeys(job.search));
  await Promise.all(Array.from(oldSearchKeys)
    .filter((key) => !newSearchKeys.has(key))
    .map((key) => store.zrem(key, id)));

  return { status: "updated", job };
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

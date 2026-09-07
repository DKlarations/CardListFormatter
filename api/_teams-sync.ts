import { createHash, randomUUID } from "node:crypto";
import { buildPullListTeamsCard } from "../shared/pull-list-teams-card.mjs";
import { getPullListJob, type PullListJobStore } from "./_pull-list-job-repository.js";
import { signTeamsAction } from "./_teams-action-token.js";
import { SAVED_PULL_LIST_TTL_SECONDS, type PullListJob } from "../src/pull-list-job.js";

export type TeamsSyncResult = { status: "updated" | "skipped" | "failed"; reason?: string };
type Env = Record<string, string | undefined>;
export function formatterBaseUrl(env: Env = process.env) {
  const url = new URL(env.FORMATTER_BASE_URL || "https://card-list-formatter.vercel.app/");
  if (url.username || url.password) throw new Error("Invalid formatter URL configuration.");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("Invalid formatter URL configuration.");
  url.search = "";
  url.hash = "";
  return url;
}

export function jobBrowserUrl(jobId: string, env: Env = process.env) {
  const url = formatterBaseUrl(env);
  url.searchParams.set("job", jobId);
  return url.toString();
}

export function renderJobTeamsCard(job: PullListJob, env: Env = process.env, checkEmailNowUrl?: string) {
  const statusUrls: Record<string, string> = {};
  if (env.TEAMS_ACTION_SIGNING_SECRET) {
    for (const target of ["pull-list", "pricing"] as const) {
      const token = signTeamsAction({ v: 1, jobId: job.id, target, exp: Math.floor(new Date(job.expiresAt).getTime() / 1000) }, env.TEAMS_ACTION_SIGNING_SECRET);
      const url = new URL("/api/teams-actions", formatterBaseUrl(env));
      url.search = new URLSearchParams({ id: job.id, target, token }).toString();
      statusUrls[target] = url.toString();
    }
  }
  return buildPullListTeamsCard({ jobId: job.id, emailDisplay: job.emailDisplay,
    formatterUrl: jobBrowserUrl(job.id, env), checkEmailNowUrl: checkEmailNowUrl ?? (env.CHECK_EMAIL_NOW_URL || job.emailDisplay?.checkEmailNowUrl || ""),
    statusUrls, printStatus: job.printStatus });
}

export function teamsUpdateEnvelope(job: PullListJob, env: Env = process.env) {
  const revision = createHash("sha256").update(JSON.stringify([job.id, job.teams, job.printStatus])).digest("hex");
  return { operation: "update-card" as const, jobId: job.id, teams: job.teams,
    card: renderJobTeamsCard(job, env), idempotencyKey: `update:${job.id}:${revision}`,
    statusRevision: revision, updatedAt: job.updatedAt };
}

type SyncDependencies = { env?: Env; fetch?: typeof fetch; now?: () => number; sleep?: (ms: number) => Promise<void> };
const RELEASE_LOCK = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0";

/** Only replaces the stored original card. There is deliberately no post/reply transport here. */
export async function syncTeamsCard(store: PullListJobStore, jobId: string, deps: SyncDependencies = {}): Promise<TeamsSyncResult> {
  const env = deps.env ?? process.env;
  const fetcher = deps.fetch ?? fetch;
  const now = deps.now ?? Date.now;
  const sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const diagnosticKey = `pull-list-teams-sync:${jobId}`;
  const recordFailure = async (reason: string, status: "skipped" | "failed" = "failed"): Promise<TeamsSyncResult> => {
    console.warn("Original Teams card synchronization incomplete.", { jobId, reason });
    await store.set(diagnosticKey, { status, reason, attemptedAt: new Date(now()).toISOString() }, { ex: SAVED_PULL_LIST_TTL_SECONDS });
    return { status, reason };
  };
  let job = await getPullListJob(store, jobId, now());
  if (!job) return { status: "skipped", reason: "job-not-found" };
  if (job.source !== "email" && !job.teams) return { status: "skipped", reason: "not-email-job" };
  if (!job.teams?.messageId || !job.teams.teamId || !job.teams.channelId) return recordFailure("missing-message-identity", "skipped");
  if (!job.emailDisplay) return recordFailure("missing-email-content", "skipped");
  if (!env.TEAMS_UPDATE_WORKFLOW_URL || !env.TEAMS_UPDATE_WORKFLOW_SECRET) return recordFailure("missing-update-configuration", "skipped");
  if (env.TEAMS_UPDATE_WORKFLOW_URL === env.TEAMS_WEBHOOK_URL) return recordFailure("separate-update-workflow-required", "skipped");
  try { if (new URL(env.TEAMS_UPDATE_WORKFLOW_URL).protocol !== "https:") return recordFailure("invalid-update-configuration"); }
  catch { return recordFailure("invalid-update-configuration"); }

  const lockKey = `pull-list-teams-sync-lock:${jobId}`;
  const owner = randomUUID();
  let acquired = false;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (await store.set(lockKey, owner, { nx: true, ex: 60 })) { acquired = true; break; }
    await sleep(250);
  }
  if (!acquired) return recordFailure("sync-in-progress");
  try {
    // Reload before each attempt so simultaneous prints converge to both timestamps.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      job = await getPullListJob(store, jobId, now());
      if (!job) return { status: "skipped", reason: "job-not-found" };
      const envelope = teamsUpdateEnvelope(job, env);
      const previous = await store.get<{ idempotencyKey?: string; status?: string }>(diagnosticKey);
      if (previous?.status === "updated" && previous.idempotencyKey === envelope.idempotencyKey) return { status: "updated" };
      try {
        const response = await fetcher(env.TEAMS_UPDATE_WORKFLOW_URL, { method: "POST", redirect: "error",
          signal: AbortSignal.timeout(8000), headers: { "content-type": "application/json", "x-pullsmith-workflow-secret": env.TEAMS_UPDATE_WORKFLOW_SECRET },
          body: JSON.stringify(envelope) });
        const ack = await response.json().catch(() => null);
        // An accepted webhook (202) alone is not proof that Update Card ran.
        if (response.ok && ack?.status === "updated" && ack.jobId === job.id
          && ack.messageId === job.teams?.messageId && ack.idempotencyKey === envelope.idempotencyKey) {
          await store.set(diagnosticKey, { status: "updated", idempotencyKey: envelope.idempotencyKey, attemptedAt: new Date(now()).toISOString() }, { ex: SAVED_PULL_LIST_TTL_SECONDS });
          const latest = await getPullListJob(store, jobId, now());
          if (!latest || teamsUpdateEnvelope(latest, env).idempotencyKey === envelope.idempotencyKey) return { status: "updated" };
        }
      } catch { /* Never log transport URLs, response bodies, or secrets. */ }
      if (attempt < 2) await sleep(200 * (attempt + 1));
    }
    return recordFailure("update-not-confirmed");
  } finally {
    await store.eval(RELEASE_LOCK, [lockKey], [owner]);
  }
}

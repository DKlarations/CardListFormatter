import { createHash } from "node:crypto";
import { getRedis } from "./_redis.js";
import { createEmailIngestHandler } from "./_email-ingest.js";
import { constantTimeEqual, validTeamsJobId, verifyTeamsAction } from "./_teams-action-token.js";
import { claimPullListJobTeamsPost, getPullListJob, mutatePullListJobPrintStatus, registerPullListJobTeams, type PullListJobStore } from "./_pull-list-job-repository.js";
import { jobBrowserUrl, renderJobTeamsCard, syncTeamsCard, teamsUpdateEnvelope, type TeamsSyncResult } from "./_teams-sync.js";
import type { PullListJobTeamsMetadata } from "../src/pull-list-job.js";

type Dependencies = {
  getStore?: () => PullListJobStore;
  env?: Record<string, string | undefined>;
  now?: () => number;
  sync?: (store: PullListJobStore, id: string) => Promise<TeamsSyncResult>;
};
function escape(value: string) { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!); }
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
function page(title: string, content: string, status = 200) {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} | Pullsmith</title><style>body{margin:0;background:#101b2a;color:#f3f7fb;font:16px/1.55 system-ui;min-height:100vh;display:grid;place-items:center}main{box-sizing:border-box;width:min(34rem,calc(100% - 2rem));padding:1.5rem;background:#172638;border:1px solid #456078;border-radius:8px}h1{font-size:1.4rem;line-height:1.3}button,a{display:inline-block;padding:.7rem 1rem;border-radius:6px}button{font:inherit;font-weight:700;background:#2779b8;color:white;border:1px solid #73b7e8;cursor:pointer}a{color:#b7ddff}button:focus-visible,a:focus-visible{outline:3px solid white;outline-offset:3px}</style></head><body><main><h1>${escape(title)}</h1>${content}</main></body></html>`, {
    status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "strict-origin",
      "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" },
  });
}
const invalidPage = () => page("Link unavailable", "<p>This action link is invalid or expired. Open the saved list in Pullsmith to record its print status.</p>", 404);

function metadata(value: unknown): PullListJobTeamsMetadata | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const result: Record<string, string> = {};
  for (const name of ["teamId", "channelId", "conversationId", "messageId", "messageLink", "postedAt"]) {
    if (raw[name] === undefined) continue;
    if (typeof raw[name] !== "string" || !(raw[name] as string).trim() || (raw[name] as string).length > 2048) return null;
    result[name] = raw[name] as string;
  }
  if (!result.teamId || !result.channelId || !result.messageId) return null;
  if (result.postedAt) {
    const date = new Date(result.postedAt);
    if (!Number.isFinite(date.getTime())) return null;
    result.postedAt = date.toISOString();
  }
  if (result.messageLink) {
    try {
      const url = new URL(result.messageLink);
      if (url.protocol !== "https:" || !["teams.microsoft.com", "teams.cloud.microsoft"].includes(url.hostname) || url.username || url.password) return null;
    } catch { return null; }
  }
  return result;
}

export function createTeamsActionHandlers(deps: Dependencies = {}) {
  const env = deps.env ?? process.env;
  const getStore = deps.getStore ?? (() => getRedis() as unknown as PullListJobStore);
  const now = deps.now ?? Date.now;
  const sync = deps.sync ?? ((store, id) => syncTeamsCard(store, id, { env, now }));
  const authorized = (request: Request) => Boolean(env.FORMATTED_LIST_WRITE_SECRET)
    && constantTimeEqual(request.headers.get("x-formatted-list-secret") || "", env.FORMATTED_LIST_WRITE_SECRET!);
  const ingest = createEmailIngestHandler({ getStore, env: (name: string, fallback = "") => env[name] || fallback,
    renderCard: (job, request, checkEmailNowUrl?: string) => renderJobTeamsCard(job, { ...env, FORMATTER_BASE_URL: env.FORMATTER_BASE_URL || new URL(request.url).origin }, checkEmailNowUrl) });
  const safeSync = async (store: PullListJobStore, id: string): Promise<TeamsSyncResult> => {
    try { return await sync(store, id); }
    catch { console.warn("Original Teams card synchronization failed.", { jobId: id }); return { status: "failed", reason: "sync-unavailable" }; }
  };
  return {
    async GET(request: Request) {
      const url = new URL(request.url);
      if (url.searchParams.get("action") === "card") {
        if (!authorized(request)) return json({ error: "Not found." }, 404);
        const id = url.searchParams.get("id");
        if (!validTeamsJobId(id)) return json({ error: "Invalid request." }, 400);
        try {
          const job = await getPullListJob(getStore(), id, now());
          return job ? json(teamsUpdateEnvelope(job, env)) : json({ error: "Not found." }, 404);
        } catch { return json({ error: "Card lookup failed." }, 500); }
      }
      const id = url.searchParams.get("id");
      const target = url.searchParams.get("target");
      const token = url.searchParams.get("token");
      const claims = verifyTeamsAction(token, env.TEAMS_ACTION_SIGNING_SECRET || "", id, target, now());
      if (!claims) return invalidPage();
      try {
        // GET only reads. Even a valid scanner/preview request cannot mark a status.
        const job = await getPullListJob(getStore(), claims.jobId, now());
        if (!job) return invalidPage();
        const label = claims.target === "pull-list" ? "Pull List Printed" : "Pricing Printed";
        return page(`Mark ${label}`, `<p>${escape(job.customer.name || "Saved Pull List")}</p><p>Confirm that this print action was used. This records a status; it does not verify physical paper output.</p><form method="post" action="/api/teams-actions"><input type="hidden" name="id" value="${escape(claims.jobId)}"><input type="hidden" name="target" value="${escape(claims.target)}"><input type="hidden" name="token" value="${escape(token!)}"><button type="submit">Confirm ${label}</button></form><a href="${escape(jobBrowserUrl(job.id, env))}">Open Formatted List</a>`);
      } catch { return page("Unable to load status", "<p>Please try this action again.</p>", 503); }
    },
    async POST(request: Request) {
      const url = new URL(request.url);
      const action = url.searchParams.get("action");
      if (action === "ingest") return ingest(request);
      if (action === "claim-post") {
        if (!authorized(request)) return json({ error: "Not found." }, 404);
        try {
          const body = await request.json();
          if (!validTeamsJobId(body?.jobId)) return json({ error: "Invalid request." }, 400);
          const store = getStore();
          const job = await getPullListJob(store, body.jobId, now());
          if (!job || !job.emailDisplay) return json({ error: "Not found." }, 404);
          if (job.teams?.messageId) return json({ shouldPost: false, jobId: job.id, teams: job.teams });
          // Fail closed after an ambiguous Post Card result: a retry must not create another root card.
          const claim = await claimPullListJobTeamsPost(store, job.id, now());
          if (claim.status === "not-found") return json({ error: "Not found." }, 404);
          return json({ shouldPost: claim.shouldPost, jobId: job.id,
            ...(!claim.shouldPost ? { reason: "initial-post-already-claimed" } : {}) });
        } catch { return json({ error: "Initial post could not be claimed." }, 500); }
      }
      if (action === "register-message") {
        if (!authorized(request)) return json({ error: "Not found." }, 404);
        try {
          const body = await request.json();
          const teams = metadata(body?.teams);
          if (!validTeamsJobId(body?.jobId) || !teams) return json({ error: "Invalid message registration." }, 400);
          const store = getStore();
          const result = await registerPullListJobTeams(store, body.jobId, teams, now());
          if (result.status === "not-found") return json({ error: "Not found." }, 404);
          if (result.status !== "updated") return json({ error: "Original Teams message is already registered." }, 409);
          const printed = result.job.printStatus.pullListPrintedAt || result.job.printStatus.pricingPrintedAt;
          const teamsSync = printed ? await safeSync(store, body.jobId) : { status: "skipped", reason: "no-print-status" };
          return json({ registered: true, jobId: result.job.id, teams: result.job.teams, teamsSync });
        } catch { return json({ error: "Message registration failed." }, 500); }
      }
      if (action) return json({ error: "Not found." }, 404);
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin) return invalidPage();
      if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded")) return invalidPage();
      try {
        const form = new URLSearchParams(await request.text());
        const token = form.get("token");
        const claims = verifyTeamsAction(token, env.TEAMS_ACTION_SIGNING_SECRET || "", form.get("id"), form.get("target"), now());
        if (!claims) return invalidPage();
        const store = getStore();
        if (!await getPullListJob(store, claims.jobId, now())) return invalidPage();
        // One timestamp per signed action; double-clicks/retries replay the same mutation.
        const receiptKey = `pull-list-teams-action:${createHash("sha256").update(token!).digest("hex")}`;
        const printedAt = new Date(now()).toISOString();
        await store.set(receiptKey, printedAt, { nx: true, ex: Math.max(1, claims.exp - Math.floor(now() / 1000)) });
        const firstTimestamp = await store.get<string>(receiptKey);
        if (!firstTimestamp) throw new Error("Action receipt unavailable.");
        const result = await mutatePullListJobPrintStatus(store, claims.jobId, claims.target, firstTimestamp, now());
        if (result.status === "not-found") return invalidPage();
        const teamsSync = await safeSync(store, claims.jobId);
        const warning = teamsSync.status !== "updated" ? "<p>Your status is saved. The original Teams card could not be synchronized. It has not been reposted; retry this confirmation to retry synchronization.</p>" : "<p>The original Teams card was updated.</p>";
        return page("Print status saved", `${warning}<a href="${escape(jobBrowserUrl(claims.jobId, env))}">Open Formatted List</a>`);
      } catch { return page("Status could not be saved", "<p>Please retry this confirmation. Your saved list and pricing work have not been replaced.</p>", 503); }
    },
  };
}

export const { GET, POST } = createTeamsActionHandlers();

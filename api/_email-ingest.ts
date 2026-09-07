import { timingSafeEqual } from "node:crypto";
import { attachPullListJobEmail, createPullListJob, type PullListJobStore } from "./_pull-list-job-repository.js";
import {
  emptyPullListJobPrintStatus, emptySavedPricingState, isPersistablePullListJobDraft,
  normalizePullListJobDraft, type PullListJob,
} from "../src/pull-list-job.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: {
    "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
  } });
}

export function emailJobUrl(baseUrl: string, id: string) {
  const url = new URL(baseUrl);
  url.search = "";
  url.hash = "";
  url.searchParams.set("job", id);
  return url.toString();
}

export function createEmailIngestHandler({ getStore, env, renderCard }: {
  getStore: () => PullListJobStore;
  env: (name: string, fallback?: string) => string;
  renderCard: (job: PullListJob, request: Request, checkEmailNowUrl?: string) => unknown;
}) {
  return async (request: Request) => {
    const secret = env("FORMATTED_LIST_WRITE_SECRET");
    const supplied = request.headers.get("x-formatted-list-secret") || "";
    if (!secret) return jsonResponse({ error: "Email ingestion is not configured." }, 503);
    const expectedBytes = Buffer.from(secret);
    const suppliedBytes = Buffer.from(supplied);
    if (expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) {
      return jsonResponse({ error: "Unauthorized." }, 401);
    }
    let body: any;
    try { body = await request.json(); } catch { return jsonResponse({ error: "Invalid JSON." }, 400); }
    const draft = normalizePullListJobDraft({
      ...body?.data,
      source: "email",
      teams: undefined,
      emailDisplay: {
        ...body?.emailDisplay,
        checkEmailNowUrl: typeof body?.checkEmailNowUrl === "string" ? body.checkEmailNowUrl : env("CHECK_EMAIL_NOW_URL"),
      },
      pricingState: emptySavedPricingState(),
      printStatus: emptyPullListJobPrintStatus(),
    });
    if (!isPersistablePullListJobDraft(draft) || !draft.emailDisplay?.body) {
      return jsonResponse({ error: "A complete processed email pull list is required." }, 400);
    }
    try {
      const store = getStore();
      const result = await createPullListJob(store, draft);
      const reused = result.status === "duplicate"
        ? await attachPullListJobEmail(store, result.existingJob.id, draft.emailDisplay)
        : null;
      const job = result.status === "duplicate"
        ? reused?.status === "updated" ? reused.job : null
        : result.status === "not-found" ? null : result.job;
      if (!job) return jsonResponse({ error: "Saved Pull List creation failed." }, 500);
      const url = emailJobUrl(env("FORMATTER_BASE_URL", new URL(request.url).origin), job.id);
      const checkEmailNowUrl = typeof body.checkEmailNowUrl === "string" ? body.checkEmailNowUrl : undefined;
      return jsonResponse({
        job, id: job.id, url, duplicate: result.status === "duplicate",
        alreadyPosted: Boolean(job.teams?.messageId),
        card: renderCard(job, request, checkEmailNowUrl),
      }, result.status === "duplicate" ? 200 : 201);
    } catch {
      return jsonResponse({ error: "Email pull list could not be saved. Retry after checking server configuration." }, 500);
    }
  };
}

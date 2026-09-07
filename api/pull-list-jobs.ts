import { getRedis } from "./_redis.js";
import {
  createPullListJob,
  deletePullListJob,
  getPullListJob,
  mutatePullListJobPrintStatus,
  searchPullListJobs,
  updatePullListJob,
  validatedPrintStatusMutation,
  type PullListJobStore,
} from "./_pull-list-job-repository.js";
import { isGeneratedSamplePullListJobDraft, isPersistablePullListJobDraft } from "../src/pull-list-job.js";
import { syncTeamsCard } from "./_teams-sync.js";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function store() {
  return getRedis() as unknown as PullListJobStore;
}

// TODO: Apply production Microsoft Entra ID authentication at this API boundary.
export function createPullListJobHandlers(
  getStore: () => PullListJobStore = store,
  syncTeams: typeof syncTeamsCard = syncTeamsCard,
) {
  return {
    async GET(request: Request) {
      const url = new URL(request.url);
      const id = (url.searchParams.get("id") || "").trim();
      try {
        if (id) {
          const job = await getPullListJob(getStore(), id);
          return job
            ? jsonResponse({ job })
            : jsonResponse({ error: "Saved Pull List not found." }, 404);
        }
        const jobs = await searchPullListJobs(getStore(), {
          name: url.searchParams.get("name") || "",
          namePrefix: url.searchParams.get("namePrefix") || "",
          phone: url.searchParams.get("phone") || "",
          email: url.searchParams.get("email") || "",
          limit: Number(url.searchParams.get("limit")) || 20,
        });
        return jsonResponse({ jobs });
      } catch (error) {
        console.error("Saved Pull List lookup failed.", error);
        return jsonResponse({ error: error instanceof Error ? error.message : "Saved Pull List lookup failed." }, 500);
      }
    },

    async POST(request: Request) {
      const url = new URL(request.url);
      if (url.searchParams.get("action") === "print-status") {
        const origin = request.headers.get("origin");
        if ((origin && origin !== url.origin) || request.headers.get("sec-fetch-site") === "cross-site") {
          return jsonResponse({ error: "This request must originate from Pullsmith." }, 403);
        }
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") || "")) {
          return jsonResponse({ error: "A JSON print-status request is required." }, 415);
        }
        let mutation: ReturnType<typeof validatedPrintStatusMutation>;
        try {
          const body = await request.json();
          mutation = validatedPrintStatusMutation(body?.id, body?.target, body?.printedAt);
        } catch {
          return jsonResponse({ error: "Invalid Saved Pull List print-status request." }, 400);
        }
        try {
          const jobStore = getStore();
          const result = await mutatePullListJobPrintStatus(jobStore, mutation.id, mutation.target, mutation.printedAt);
          if (result.status === "not-found") return jsonResponse({ error: "Saved Pull List not found." }, 404);
          let teamsSync: Awaited<ReturnType<typeof syncTeamsCard>>;
          try {
            teamsSync = await syncTeams(jobStore, result.job.id);
          } catch {
            teamsSync = { status: "failed", reason: "Teams synchronization failed." };
          }
          return jsonResponse({ job: result.job, teamsSync });
        } catch {
          return jsonResponse({ error: "Saved Pull List print-status update failed." }, 500);
        }
      }
      if (url.searchParams.has("action")) return jsonResponse({ error: "Invalid Saved Pull List action." }, 400);
      try {
        const body = await request.json();
        if (isGeneratedSamplePullListJobDraft(body?.job)) {
          return jsonResponse({ error: "Generated sample pull lists are not saved." }, 400);
        }
        if (!isPersistablePullListJobDraft(body?.job)) {
          return jsonResponse({ error: "A successfully processed pull list is required." }, 400);
        }
        const result = await createPullListJob(getStore(), {
          ...body?.job, source: "manual", teams: undefined, emailDisplay: undefined,
        });
        if (result.status === "duplicate") {
          return jsonResponse({ duplicate: true, existingJob: result.existingJob }, 409);
        }
        if (result.status === "not-found") {
          return jsonResponse({ error: "Saved Pull List creation failed." }, 500);
        }
        return jsonResponse({ job: result.job }, 201);
      } catch (error) {
        return jsonResponse({ error: error instanceof Error ? error.message : "Saved Pull List creation failed." }, 500);
      }
    },

    async PUT(request: Request) {
      try {
        const body = await request.json();
        const id = String(body?.id || "").trim();
        if (!id) return jsonResponse({ error: "Saved Pull List ID is required." }, 400);
        if (isGeneratedSamplePullListJobDraft(body?.job)) {
          return jsonResponse({ error: "Generated sample pull lists are not saved." }, 400);
        }
        if (!isPersistablePullListJobDraft(body?.job)) {
          return jsonResponse({ error: "A coherent processed pull list is required." }, 400);
        }
        const jobStore = getStore();
        const previous = await getPullListJob(jobStore, id);
        const result = await updatePullListJob(jobStore, id, body?.job);
        if (result.status === "not-found") return jsonResponse({ error: "Saved Pull List not found." }, 404);
        if (result.status === "duplicate") {
          return jsonResponse({ duplicate: true, existingJob: result.existingJob }, 409);
        }
        const printStatusChanged = previous && (
          result.job.printStatus.pullListPrintedAt > previous.printStatus.pullListPrintedAt
          || result.job.printStatus.pricingPrintedAt > previous.printStatus.pricingPrintedAt
        );
        let teamsSync: Awaited<ReturnType<typeof syncTeamsCard>> | undefined;
        if (printStatusChanged) {
          try {
            teamsSync = await syncTeams(jobStore, result.job.id);
          } catch {
            teamsSync = { status: "failed", reason: "Teams synchronization failed." };
          }
        }
        return jsonResponse({ job: result.job, ...(teamsSync ? { teamsSync } : {}) });
      } catch (error) {
        return jsonResponse({ error: error instanceof Error ? error.message : "Saved Pull List update failed." }, 500);
      }
    },

    async DELETE(request: Request) {
      const url = new URL(request.url);
      const id = (url.searchParams.get("id") || "").trim();
      if (!id) return jsonResponse({ error: "Saved Pull List ID is required." }, 400);
      try {
        const result = await deletePullListJob(getStore(), id);
        if (result.status === "not-found") {
          return jsonResponse({ error: "Saved Pull List not found." }, 404);
        }
        return jsonResponse({ deleted: true, id: result.id });
      } catch (error) {
        return jsonResponse({ error: error instanceof Error ? error.message : "Saved Pull List deletion failed." }, 500);
      }
    },
  };
}

const handlers = createPullListJobHandlers();

export const { GET, POST, PUT, DELETE } = handlers;

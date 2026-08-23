import { getRedis } from "./_redis.js";
import {
  createPullListJob,
  getPullListJob,
  searchPullListJobs,
  updatePullListJob,
  type PullListJobStore,
} from "./_pull-list-job-repository.js";
import { isPersistablePullListJobDraft } from "../src/pull-list-job.js";

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
export function createPullListJobHandlers(getStore: () => PullListJobStore = store) {
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
      try {
        const body = await request.json();
        if (!isPersistablePullListJobDraft(body?.job)) {
          return jsonResponse({ error: "A successfully processed pull list is required." }, 400);
        }
        const result = await createPullListJob(getStore(), body?.job);
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
        if (!isPersistablePullListJobDraft(body?.job)) {
          return jsonResponse({ error: "A coherent processed pull list is required." }, 400);
        }
        const result = await updatePullListJob(getStore(), id, body?.job);
        if (result.status === "not-found") return jsonResponse({ error: "Saved Pull List not found." }, 404);
        if (result.status === "duplicate") {
          return jsonResponse({ duplicate: true, existingJob: result.existingJob }, 409);
        }
        return jsonResponse({ job: result.job });
      } catch (error) {
        return jsonResponse({ error: error instanceof Error ? error.message : "Saved Pull List update failed." }, 500);
      }
    },
  };
}

const handlers = createPullListJobHandlers();

export const { GET, POST, PUT } = handlers;

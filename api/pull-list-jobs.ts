import { getRedis } from "./_redis";
import { isStaffAuthorized } from "./_staff-auth";
import {
  createPullListJob,
  getPullListJob,
  searchPullListJobs,
  updatePullListJob,
  type PullListJobStore,
} from "./_pull-list-job-repository";
import { isPersistablePullListJobDraft } from "../src/pull-list-job";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function authorized(request: Request) {
  return isStaffAuthorized(request)
    ? null
    : jsonResponse({ error: "Staff authorization is required.", authRequired: true }, 401);
}

function store() {
  return getRedis() as unknown as PullListJobStore;
}

export async function GET(request: Request) {
  const denied = authorized(request);
  if (denied) return denied;
  const url = new URL(request.url);
  const id = (url.searchParams.get("id") || "").trim();
  try {
    if (id) {
      const job = await getPullListJob(store(), id);
      return job
        ? jsonResponse({ job })
        : jsonResponse({ error: "Saved Pull List not found." }, 404);
    }
    const jobs = await searchPullListJobs(store(), {
      name: url.searchParams.get("name") || "",
      namePrefix: url.searchParams.get("namePrefix") || "",
      phone: url.searchParams.get("phone") || "",
      email: url.searchParams.get("email") || "",
      limit: Number(url.searchParams.get("limit")) || 20,
    });
    return jsonResponse({ jobs });
  } catch (error) {
    console.error("Saved Pull List lookup failed.", error);
    return jsonResponse({ error: "Saved Pull List lookup failed." }, 500);
  }
}

export async function POST(request: Request) {
  const denied = authorized(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    if (!isPersistablePullListJobDraft(body?.job)) {
      return jsonResponse({ error: "A successfully processed pull list is required." }, 400);
    }
    const result = await createPullListJob(store(), body?.job);
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
}

export async function PUT(request: Request) {
  const denied = authorized(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const id = String(body?.id || "").trim();
    if (!id) return jsonResponse({ error: "Saved Pull List ID is required." }, 400);
    if (!isPersistablePullListJobDraft(body?.job)) {
      return jsonResponse({ error: "A coherent processed pull list is required." }, 400);
    }
    const result = await updatePullListJob(store(), id, body?.job);
    if (result.status === "not-found") return jsonResponse({ error: "Saved Pull List not found." }, 404);
    if (result.status === "duplicate") {
      return jsonResponse({ duplicate: true, existingJob: result.existingJob }, 409);
    }
    return jsonResponse({ job: result.job });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "Saved Pull List update failed." }, 500);
  }
}

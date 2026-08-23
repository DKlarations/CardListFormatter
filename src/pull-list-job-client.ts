import {
  normalizePullListJob,
  normalizeSavedJobSummary,
  type PullListJob,
  type PullListJobDraft,
  type SavedJobSummary,
} from "./pull-list-job";

export type SavedPullListSummaryQuery = {
  namePrefix?: string;
  phone?: string;
  email?: string;
  limit?: number;
};

export class StaffAuthorizationRequiredError extends Error {
  constructor() {
    super("Staff authorization is required.");
    this.name = "StaffAuthorizationRequiredError";
  }
}

export type ClientSaveJobResult =
  | { status: "saved"; job: PullListJob }
  | { status: "duplicate"; existingJob: SavedJobSummary };

async function responseBody(response: Response) {
  return response.json().catch(() => ({}));
}

function jobApiUrl() {
  return "/api/pull-list-jobs";
}

export async function persistPullListJob(
  draft: PullListJobDraft,
  currentJobId = "",
): Promise<ClientSaveJobResult> {
  const response = await fetch(jobApiUrl(), {
    method: currentJobId ? "PUT" : "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", Accept: "application/json" },
    body: JSON.stringify(currentJobId ? { id: currentJobId, job: draft } : { job: draft }),
  });
  const body = await responseBody(response);
  if (response.status === 401) throw new StaffAuthorizationRequiredError();
  if (response.status === 409 && body.duplicate && body.existingJob) {
    return { status: "duplicate", existingJob: body.existingJob };
  }
  if (!response.ok || !body.job) {
    throw new Error(body.error || `Saved Pull List request failed (${response.status}).`);
  }
  return { status: "saved", job: normalizePullListJob(body.job) };
}

export async function loadPullListJob(id: string) {
  const response = await fetch(`${jobApiUrl()}?id=${encodeURIComponent(id)}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  const body = await responseBody(response);
  if (response.status === 401) throw new StaffAuthorizationRequiredError();
  if (!response.ok || !body.job) {
    throw new Error(body.error || `Saved Pull List load failed (${response.status}).`);
  }
  return normalizePullListJob(body.job);
}

export async function listPullListJobs(query: SavedPullListSummaryQuery = {}) {
  const search = new URLSearchParams();
  if (query.namePrefix) search.set("namePrefix", query.namePrefix);
  if (query.phone) search.set("phone", query.phone);
  if (query.email) search.set("email", query.email);
  search.set("limit", String(query.limit || 15));
  const response = await fetch(`${jobApiUrl()}?${search.toString()}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  });
  const body = await responseBody(response);
  if (response.status === 401) throw new StaffAuthorizationRequiredError();
  if (!response.ok || !Array.isArray(body.jobs)) {
    throw new Error(body.error || `Saved Pull List search failed (${response.status}).`);
  }
  return body.jobs.map(normalizeSavedJobSummary).filter((job: SavedJobSummary) => Boolean(job.id));
}

export async function unlockStaffSaving(passcode: string) {
  const response = await fetch("/api/staff-session", {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ passcode }),
  });
  const body = await responseBody(response);
  if (!response.ok || !body.authenticated) {
    throw new Error(body.error || "Staff unlock failed.");
  }
}

export function pullListJobUrl(id: string, locationValue: Pick<Location, "href"> = window.location) {
  const url = new URL(locationValue.href);
  url.searchParams.delete("list");
  url.searchParams.set("job", id);
  url.hash = "";
  return url;
}

export function formatterShareUrlWithoutJob(locationValue: Pick<Location, "href"> = window.location) {
  const url = new URL(locationValue.href);
  url.searchParams.delete("job");
  url.hash = "";
  return url;
}

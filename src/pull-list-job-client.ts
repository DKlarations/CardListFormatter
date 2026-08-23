import {
  normalizePullListJob,
  normalizeSavedJobSummary,
  type PullListJob,
  type PullListJobDraft,
  type SavedJobSummary,
} from "./pull-list-job";
import {
  createSavedPullListDiagnostic,
  type SavedPullListDiagnosticMethod,
  type SavedPullListDiagnosticOperation,
  type SavedPullListDiagnosticReporter,
} from "./saved-pull-list-diagnostics";

export type SavedPullListSummaryQuery = {
  namePrefix?: string;
  phone?: string;
  email?: string;
  limit?: number;
};

export type ClientSaveJobResult =
  | { status: "saved"; job: PullListJob }
  | { status: "duplicate"; existingJob: SavedJobSummary };

type SavedPullListRequestOptions = {
  onDiagnostic?: SavedPullListDiagnosticReporter;
};

export class SavedPullListRequestError extends Error {
  status?: number;
  method: SavedPullListDiagnosticMethod;
  endpoint: string;
  requestId?: string;
  operation: SavedPullListDiagnosticOperation;

  constructor({
    message,
    status,
    method,
    endpoint,
    requestId,
    operation,
  }: {
    message: string;
    status?: number;
    method: SavedPullListDiagnosticMethod;
    endpoint: string;
    requestId?: string;
    operation: SavedPullListDiagnosticOperation;
  }) {
    super(message);
    this.name = "SavedPullListRequestError";
    this.status = status;
    this.method = method;
    this.endpoint = endpoint;
    this.requestId = requestId;
    this.operation = operation;
  }
}

async function responseBody(response: Response) {
  return response.json().catch(() => ({}));
}

function jobApiUrl() {
  return "/api/pull-list-jobs";
}

function requestId(response: Response, body: Record<string, unknown>) {
  return response.headers.get("x-vercel-id")
    || response.headers.get("x-request-id")
    || (typeof body.requestId === "string" ? body.requestId : "");
}

function safeServerMessage(body: Record<string, unknown>, fallback: string) {
  return typeof body.error === "string" && body.error.trim() ? body.error.trim() : fallback;
}

function report(
  onDiagnostic: SavedPullListDiagnosticReporter | undefined,
  event: Parameters<typeof createSavedPullListDiagnostic>[0],
) {
  onDiagnostic?.(createSavedPullListDiagnostic(event));
}

async function savedPullListRequest(
  operation: SavedPullListDiagnosticOperation,
  method: SavedPullListDiagnosticMethod,
  requestUrl: string,
  init: RequestInit,
  onDiagnostic?: SavedPullListDiagnosticReporter,
) {
  const endpoint = jobApiUrl();
  try {
    const response = await fetch(requestUrl, init);
    const parsedBody = await responseBody(response);
    const body = parsedBody && typeof parsedBody === "object" ? parsedBody as Record<string, unknown> : {};
    return { response, body, endpoint, requestId: requestId(response, body) };
  } catch (error) {
    const message = error instanceof Error && error.message
      ? error.message
      : "Saved Pull List request could not reach the server.";
    const requestError = new SavedPullListRequestError({ message, method, endpoint, operation });
    report(onDiagnostic, { operation, method, endpoint, outcome: "failed", message });
    throw requestError;
  }
}

function failedRequest(
  operation: SavedPullListDiagnosticOperation,
  method: SavedPullListDiagnosticMethod,
  endpoint: string,
  response: Response,
  body: Record<string, unknown>,
  responseRequestId: string,
  fallback: string,
  onDiagnostic?: SavedPullListDiagnosticReporter,
) {
  const message = safeServerMessage(body, fallback);
  const requestError = new SavedPullListRequestError({
    message,
    status: response.status,
    method,
    endpoint,
    requestId: responseRequestId || undefined,
    operation,
  });
  report(onDiagnostic, {
    operation,
    method,
    endpoint,
    outcome: "failed",
    status: response.status,
    message,
    requestId: responseRequestId,
  });
  return requestError;
}

export async function persistPullListJob(
  draft: PullListJobDraft,
  currentJobId = "",
  { onDiagnostic }: SavedPullListRequestOptions = {},
): Promise<ClientSaveJobResult> {
  const method: SavedPullListDiagnosticMethod = currentJobId ? "PUT" : "POST";
  const operation: SavedPullListDiagnosticOperation = currentJobId ? "autosave" : "create";
  const { response, body, endpoint, requestId: responseRequestId } = await savedPullListRequest(operation, method, jobApiUrl(), {
    method,
    credentials: "same-origin",
    headers: { "content-type": "application/json", Accept: "application/json" },
    body: JSON.stringify(currentJobId ? { id: currentJobId, job: draft } : { job: draft }),
  }, onDiagnostic);
  if (response.status === 409 && body.duplicate && body.existingJob) {
    const existingJob = normalizeSavedJobSummary(body.existingJob);
    report(onDiagnostic, {
      operation,
      method,
      endpoint,
      outcome: "duplicate",
      status: response.status,
      message: "Matching Saved Pull List already exists.",
      jobId: existingJob.id,
      requestId: responseRequestId,
    });
    return { status: "duplicate", existingJob };
  }
  if (!response.ok || !body.job) {
    throw failedRequest(
      operation,
      method,
      endpoint,
      response,
      body,
      responseRequestId,
      `Saved Pull List request failed (${response.status}).`,
      onDiagnostic,
    );
  }
  const job = normalizePullListJob(body.job);
  report(onDiagnostic, {
    operation,
    method,
    endpoint,
    outcome: "success",
    status: response.status,
    message: operation === "create" ? "Saved Pull List created." : "Saved Pull List autosaved.",
    jobId: job.id,
    requestId: responseRequestId,
  });
  return { status: "saved", job };
}

export async function loadPullListJob(id: string, { onDiagnostic }: SavedPullListRequestOptions = {}) {
  const { response, body, endpoint, requestId: responseRequestId } = await savedPullListRequest("load", "GET", `${jobApiUrl()}?id=${encodeURIComponent(id)}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  }, onDiagnostic);
  if (!response.ok || !body.job) {
    throw failedRequest("load", "GET", endpoint, response, body, responseRequestId, `Saved Pull List load failed (${response.status}).`, onDiagnostic);
  }
  const job = normalizePullListJob(body.job);
  report(onDiagnostic, {
    operation: "load",
    method: "GET",
    endpoint,
    outcome: "success",
    status: response.status,
    message: "Saved Pull List loaded.",
    jobId: job.id,
    requestId: responseRequestId,
  });
  return job;
}

export async function deletePullListJob(id: string, { onDiagnostic }: SavedPullListRequestOptions = {}) {
  const requestUrl = `${jobApiUrl()}?id=${encodeURIComponent(id)}`;
  const { response, body, endpoint, requestId: responseRequestId } = await savedPullListRequest("delete", "DELETE", requestUrl, {
    method: "DELETE",
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  }, onDiagnostic);
  if (!response.ok || body.deleted !== true) {
    throw failedRequest(
      "delete",
      "DELETE",
      endpoint,
      response,
      body,
      responseRequestId,
      `Saved Pull List deletion failed (${response.status}).`,
      onDiagnostic,
    );
  }
  report(onDiagnostic, {
    operation: "delete",
    method: "DELETE",
    endpoint,
    outcome: "success",
    status: response.status,
    message: "Saved Pull List deleted.",
    jobId: id,
    requestId: responseRequestId,
  });
  return { deleted: true as const, id };
}

export async function listPullListJobs(query: SavedPullListSummaryQuery = {}, { onDiagnostic }: SavedPullListRequestOptions = {}) {
  const search = new URLSearchParams();
  if (query.namePrefix) search.set("namePrefix", query.namePrefix);
  if (query.phone) search.set("phone", query.phone);
  if (query.email) search.set("email", query.email);
  search.set("limit", String(query.limit || 15));
  const operation: SavedPullListDiagnosticOperation = query.namePrefix || query.phone || query.email ? "search" : "recent";
  const { response, body, endpoint, requestId: responseRequestId } = await savedPullListRequest(operation, "GET", `${jobApiUrl()}?${search.toString()}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json" },
  }, onDiagnostic);
  if (!response.ok || !Array.isArray(body.jobs)) {
    throw failedRequest(operation, "GET", endpoint, response, body, responseRequestId, `Saved Pull List search failed (${response.status}).`, onDiagnostic);
  }
  const jobs = (body.jobs as unknown[]).map(normalizeSavedJobSummary).filter((job: SavedJobSummary) => Boolean(job.id));
  report(onDiagnostic, {
    operation,
    method: "GET",
    endpoint,
    outcome: "success",
    status: response.status,
    message: operation === "recent" ? "Recent Saved Pull Lists loaded." : "Saved Pull List search completed.",
    requestId: responseRequestId,
  });
  return jobs;
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

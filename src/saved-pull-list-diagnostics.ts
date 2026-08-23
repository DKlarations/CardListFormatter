export const SAVED_PULL_LIST_DIAGNOSTIC_LIMIT = 5;

export type SavedPullListDiagnosticOperation = "create" | "autosave" | "load" | "search" | "recent";
export type SavedPullListDiagnosticMethod = "GET" | "POST" | "PUT";
export type SavedPullListDiagnosticOutcome = "success" | "failed" | "duplicate";

/** Session-only, intentionally payload-free Saved Pull List API diagnostic. */
export type SavedPullListDiagnostic = {
  timestamp: string;
  operation: SavedPullListDiagnosticOperation;
  method: SavedPullListDiagnosticMethod;
  endpoint: string;
  outcome: SavedPullListDiagnosticOutcome;
  message: string;
  status?: number;
  jobId?: string;
  requestId?: string;
};

export type SavedPullListDiagnosticReporter = (event: SavedPullListDiagnostic) => void;

function text(value: unknown, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function status(value: unknown) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 100 && number <= 599 ? number : undefined;
}

/** Accepts only allowlisted, non-payload request metadata. */
export function createSavedPullListDiagnostic(value: Partial<SavedPullListDiagnostic>): SavedPullListDiagnostic {
  const timestamp = text(value.timestamp) || new Date().toISOString();
  const operation = value.operation || "search";
  const method = value.method || "GET";
  const outcome = value.outcome || "failed";
  return {
    timestamp,
    operation,
    method,
    endpoint: text(value.endpoint, 160) || "/api/pull-list-jobs",
    outcome,
    message: text(value.message) || "Saved Pull List request completed.",
    ...(status(value.status) ? { status: status(value.status) } : {}),
    ...(text(value.jobId, 120) ? { jobId: text(value.jobId, 120) } : {}),
    ...(text(value.requestId, 240) ? { requestId: text(value.requestId, 240) } : {}),
  };
}

export function addSavedPullListDiagnostic(
  events: SavedPullListDiagnostic[],
  event: SavedPullListDiagnostic,
) {
  return [createSavedPullListDiagnostic(event), ...events].slice(0, SAVED_PULL_LIST_DIAGNOSTIC_LIMIT);
}

export function savedPullListDiagnosticOperationLabel(operation: SavedPullListDiagnosticOperation) {
  if (operation === "autosave") return "AUTOSAVE";
  return operation.toUpperCase();
}

export function savedPullListDiagnosticOutcomeLabel(outcome: SavedPullListDiagnosticOutcome) {
  if (outcome === "success") return "SAVED";
  return outcome.toUpperCase();
}

export function shortenedSavedPullListJobId(value?: string) {
  const id = text(value, 120);
  return id ? `...${id.slice(-8)}` : "";
}

/** Plain-text report deliberately serializes only the allowlisted diagnostic fields. */
export function formatSavedPullListDiagnosticReport(events: SavedPullListDiagnostic[]) {
  const entries = events.map((event) => {
    const parts = [
      new Date(event.timestamp).toISOString().replace("T", " ").replace(".000Z", ""),
      "",
      savedPullListDiagnosticOperationLabel(event.operation),
      `${event.method} ${event.endpoint}`,
      event.status ? `HTTP ${event.status}` : "HTTP status unavailable",
      savedPullListDiagnosticOutcomeLabel(event.outcome),
      "",
      event.message,
      ...(event.jobId ? ["", `Job: ${shortenedSavedPullListJobId(event.jobId)}`] : []),
      ...(event.requestId ? ["", `Vercel request: ${event.requestId}`] : []),
    ];
    return parts.join("\n");
  });
  return ["Pullsmith Saved Pull List Diagnostics", ...entries].join("\n\n");
}

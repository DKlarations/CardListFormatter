import {
  normalizeCustomerNameForSearch,
  normalizeEmailForSearch,
  normalizePhoneForSearch,
} from "./customer";
import type { SavedJobSummary } from "./pull-list-job";
import { shouldConfirmNewList, type SavedJobSaveState } from "./saved-session-state";

export const SAVED_PULL_LIST_RECENT_LIMIT = 15;
export const SAVED_PULL_LIST_SEARCH_DEBOUNCE_MS = 300;

export type SavedPullListPickerEvent =
  | "open"
  | "close"
  | "toggle"
  | "escape"
  | "outside"
  | "job-opened";

export type SavedPullListSearchRequest = {
  mode: "recent" | "name" | "phone" | "email";
  limit: number;
  namePrefix?: string;
  phone?: string;
  email?: string;
};

export type SavedPullListOpenResult =
  | { status: "opened" }
  | { status: "canceled" }
  | { status: "error"; message: string };

export function nextSavedPullListsPickerOpen(
  current: boolean,
  event: SavedPullListPickerEvent,
) {
  if (event === "open") return true;
  if (event === "toggle") return !current;
  return false;
}

export function savedPullListSearchRequest(queryValue: unknown): SavedPullListSearchRequest {
  const query = typeof queryValue === "string" ? queryValue.trim() : "";
  if (!query) return { mode: "recent", limit: SAVED_PULL_LIST_RECENT_LIMIT };

  if (query.includes("@")) {
    return {
      mode: "email",
      email: normalizeEmailForSearch(query),
      limit: SAVED_PULL_LIST_RECENT_LIMIT,
    };
  }

  if (/^[\d()+.\-\s]+$/.test(query)) {
    return {
      mode: "phone",
      phone: normalizePhoneForSearch(query),
      limit: SAVED_PULL_LIST_RECENT_LIMIT,
    };
  }

  return {
    mode: "name",
    namePrefix: normalizeCustomerNameForSearch(query),
    limit: SAVED_PULL_LIST_RECENT_LIMIT,
  };
}

export function savedJobOpenDisposition(saveState: SavedJobSaveState) {
  return {
    requiresConfirmation: shouldConfirmNewList(saveState),
  };
}

export function formatSavedPullListDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently updated";
  return new Intl.DateTimeFormat(undefined, {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function savedPullListDeleteConfirmation(job: SavedJobSummary) {
  const customerName = job.customer.name.trim();
  const when = formatSavedPullListDate(job.updatedAt);
  return customerName
    ? `Delete the Saved Pull List for ${customerName} from ${when}?\n\nThis cannot be undone.`
    : `Delete this Saved Pull List from ${when}?\n\nThis cannot be undone.`;
}

export function confirmSavedPullListDeletion(
  job: SavedJobSummary,
  confirm: (message: string) => boolean,
) {
  return confirm(savedPullListDeleteConfirmation(job));
}

export function removeDeletedSavedPullList(
  jobs: SavedJobSummary[],
  deletedJobId: string,
) {
  return jobs.filter((job) => job.id !== deletedJobId);
}

import { randomBytes } from "node:crypto";

function randomSuffix(length = 6) {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function dateStamp(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  const usableDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return [
    String(usableDate.getMonth() + 1).padStart(2, "0"),
    String(usableDate.getDate()).padStart(2, "0"),
    String(usableDate.getFullYear()),
  ].join("");
}

export function baseListIdForDate(value) {
  return `${dateStamp(value)}-${randomSuffix()}`;
}

export function formattedListApiUrl(formatterBaseUrl) {
  return new URL("/api/formatted-lists", formatterBaseUrl).toString();
}

export async function saveFormattedList(config, baseId, data) {
  if (!config.formattedListWriteSecret) {
    throw new Error("FORMATTED_LIST_WRITE_SECRET is not configured.");
  }

  const response = await fetch(formattedListApiUrl(config.formatterBaseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-formatted-list-secret": config.formattedListWriteSecret,
    },
    body: JSON.stringify({ baseId, data }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `Formatted list save failed (${response.status}).`);
  }

  return body;
}

import { createHmac, timingSafeEqual } from "node:crypto";
import type { PullListJobPrintTarget } from "../src/pull-list-job.js";

export type TeamsActionClaims = { v: 1; jobId: string; target: PullListJobPrintTarget; exp: number };
export const validTeamsJobId = (value: unknown): value is string => typeof value === "string" && /^pl_[A-Za-z0-9-]{1,80}$/.test(value);
export const validTeamsTarget = (value: unknown): value is PullListJobPrintTarget => value === "pull-list" || value === "pricing";

export function constantTimeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function signTeamsAction(claims: TeamsActionClaims, secret: string) {
  if (!secret || claims.v !== 1 || !validTeamsJobId(claims.jobId) || !validTeamsTarget(claims.target) || !Number.isSafeInteger(claims.exp)) {
    throw new Error("Invalid Teams action configuration.");
  }
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

export function verifyTeamsAction(token: unknown, secret: string, jobId: unknown, target: unknown, nowMs = Date.now()): TeamsActionClaims | null {
  if (!secret || typeof token !== "string" || token.length > 1024 || !validTeamsJobId(jobId) || !validTeamsTarget(target)) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_-]+$/.test(part))) return null;
  const [payload, signature] = parts;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  if (!constantTimeEqual(signature, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return claims.v === 1 && claims.jobId === jobId && claims.target === target
      && Number.isSafeInteger(claims.exp) && claims.exp > Math.floor(nowMs / 1000) ? claims : null;
  } catch { return null; }
}

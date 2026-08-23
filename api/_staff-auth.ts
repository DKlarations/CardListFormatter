import { createHmac, timingSafeEqual } from "node:crypto";

export const STAFF_SESSION_COOKIE = "rrg_pullsmith_staff";
export const STAFF_SESSION_DURATION_SECONDS = 12 * 60 * 60;

type StaffSessionPayload = {
  scope: "saved-pull-lists";
  exp: number;
};

function base64Url(value: string | Buffer) {
  return Buffer.from(value).toString("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function configuredPasscode() {
  return process.env.PULL_LIST_STAFF_PASSCODE || "";
}

function configuredSessionSecret() {
  return process.env.PULL_LIST_STAFF_SESSION_SECRET || configuredPasscode();
}

export function verifyStaffPasscode(provided: unknown, expected = configuredPasscode()) {
  return Boolean(expected && typeof provided === "string" && safeEqual(provided, expected));
}

export function createStaffSessionToken(
  nowMs = Date.now(),
  secret = configuredSessionSecret(),
) {
  if (!secret) throw new Error("Staff session environment variables are not configured.");
  const payload: StaffSessionPayload = {
    scope: "saved-pull-lists",
    exp: Math.floor(nowMs / 1000) + STAFF_SESSION_DURATION_SECONDS,
  };
  const encoded = base64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifyStaffSessionToken(
  token: unknown,
  nowMs = Date.now(),
  secret = configuredSessionSecret(),
) {
  if (!secret || typeof token !== "string") return false;
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) return false;
  const expected = createHmac("sha256", secret).update(encoded).digest("base64url");
  if (!safeEqual(signature, expected)) return false;
  try {
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as StaffSessionPayload;
    return payload.scope === "saved-pull-lists" && payload.exp > Math.floor(nowMs / 1000);
  } catch {
    return false;
  }
}

function cookieValue(request: Request, name: string) {
  const cookie = request.headers.get("cookie") || "";
  const entry = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : "";
}

export function isStaffAuthorized(request: Request) {
  return verifyStaffSessionToken(cookieValue(request, STAFF_SESSION_COOKIE));
}

export function staffSessionCookie(token: string, request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${STAFF_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${STAFF_SESSION_DURATION_SECONDS}${secure}`;
}

export function clearedStaffSessionCookie(request: Request) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${STAFF_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`;
}

// TODO: Replace this isolated shared-passcode boundary with Microsoft Entra organization identity.

import {
  clearedStaffSessionCookie,
  createStaffSessionToken,
  isStaffAuthorized,
  staffSessionCookie,
  verifyStaffPasscode,
} from "./_staff-auth";

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

export async function GET(request: Request) {
  return jsonResponse({ authenticated: isStaffAuthorized(request) });
}

export async function POST(request: Request) {
  if (!process.env.PULL_LIST_STAFF_PASSCODE) {
    return jsonResponse({ error: "Staff saving is not configured." }, 503);
  }
  const body = await request.json().catch(() => ({}));
  if (!verifyStaffPasscode(body?.passcode)) {
    return jsonResponse({ error: "That staff passcode was not accepted." }, 401);
  }
  const token = createStaffSessionToken();
  return jsonResponse(
    { authenticated: true },
    200,
    { "set-cookie": staffSessionCookie(token, request) },
  );
}

export async function DELETE(request: Request) {
  return jsonResponse(
    { authenticated: false },
    200,
    { "set-cookie": clearedStaffSessionCookie(request) },
  );
}

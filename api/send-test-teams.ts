import { compactFormatterItems, processPullListText } from "./server-formatter.mjs";
import { initialTeamsCardPayload } from "../shared/pull-list-teams-card.mjs";

function env(name: string, fallback = "") {
  return process.env[name] || fallback;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  } });
}

export function createSendTestTeamsHandler({
  readEnv = env, fetchImpl = fetch, processText = processPullListText,
  compactItems = compactFormatterItems, warn = console.warn,
} = {}) {
  return async (request: Request) => {
    const secret = readEnv("FORMATTED_LIST_WRITE_SECRET");
    const webhookUrl = readEnv("TEAMS_WEBHOOK_URL");
    const checkEmailNowUrl = readEnv("CHECK_EMAIL_NOW_URL");
    if (!secret) return jsonResponse({ error: "FORMATTED_LIST_WRITE_SECRET is not configured in Vercel." }, 500);
    if (!webhookUrl) return jsonResponse({ error: "TEAMS_WEBHOOK_URL is not configured in Vercel." }, 500);
    if (!checkEmailNowUrl) warn("CHECK_EMAIL_NOW_URL is not configured; Teams cards will omit Check Email Now.");
    let body: any;
    try { body = await request.json(); } catch { return jsonResponse({ error: "Invalid JSON." }, 400); }
    const rawText = typeof body?.text === "string" ? body.text.trim() : "";
    if (!rawText) return jsonResponse({ error: "Test text is required." }, 400);
    try {
      const emailDisplay = {
        sender: "Teams Test Page", subject: "Manual Pull List Test", receivedAt: new Date().toISOString(), body: rawText,
      };
      const input = [
        `From: ${emailDisplay.sender}`, `Subject: ${emailDisplay.subject}`, `Received: ${emailDisplay.receivedAt}`, "", rawText,
      ].join("\n");
      const processed = await processText(input, { useCheckboxes: true });
      const savedResponse = await fetchImpl(new URL("/api/teams-actions?action=ingest", request.url), {
        method: "POST",
        headers: { "content-type": "application/json", "x-formatted-list-secret": secret },
        body: JSON.stringify({
          data: {
            input, output: processed.output, processedAt: processed.processedAt, customer: processed.customer,
            formatterItems: compactItems(processed.items), formatterSettings: { useCheckboxes: true },
            stats: {
              resolvedCount: processed.items.filter((item: any) => item.status === "found").length,
              needsReviewCount: processed.items.filter((item: any) => item.status !== "found").length,
              printFallbackCount: processed.items.filter((item: any) => item.status === "found" && item.printLookupFailed).length,
            },
          }, emailDisplay, checkEmailNowUrl,
        }),
      });
      const saved = await savedResponse.json().catch(() => ({}));
      if (!savedResponse.ok || !saved.id || !saved.url || !saved.card) {
        return jsonResponse({ error: "Test pull list could not be saved. No Teams card was posted." }, 502);
      }
      if (!saved.alreadyPosted) {
        const posted = await fetchImpl(webhookUrl, {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify(initialTeamsCardPayload(saved.id, saved.card)),
        });
        if (!posted.ok) return jsonResponse({ error: `Teams post failed (${posted.status}). The saved pull list is available.`, formatterUrl: saved.url }, 502);
      }
      return jsonResponse({ ok: true, id: saved.id, formatterUrl: saved.url, alreadyPosted: Boolean(saved.alreadyPosted) });
    } catch {
      return jsonResponse({ error: "Teams test failed. Check server and workflow configuration." }, 500);
    }
  };
}

export const POST = createSendTestTeamsHandler();

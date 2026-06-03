import { randomBytes } from "node:crypto";
import LZString from "lz-string";
import { processPullListText } from "../src/formatter";

const FALLBACK_HASH_PREFIX = "input=";

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

function randomSuffix(length = 6) {
  const alphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const bytes = randomBytes(length);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function dateStamp(value = new Date()) {
  return [
    String(value.getMonth() + 1).padStart(2, "0"),
    String(value.getDate()).padStart(2, "0"),
    String(value.getFullYear()),
  ].join("");
}

function fallbackHashForInput(text: string) {
  return `${FALLBACK_HASH_PREFIX}${LZString.compressToEncodedURIComponent(text)}`;
}

function formattedListUrl(baseUrl: string, id: string, fallbackInput: string) {
  const url = new URL(baseUrl);
  url.searchParams.set("list", id);
  url.hash = fallbackHashForInput(fallbackInput);
  return url.toString();
}

function processedStats(processed: any) {
  return {
    resolvedCount: processed.items.filter((item: any) => item.status === "found").length,
    needsReviewCount: processed.items.filter((item: any) => item.status !== "found").length,
    printFallbackCount: processed.items.filter((item: any) => item.status === "found" && item.printLookupFailed).length,
  };
}

function makeTeamsPayload(text: string, formatterUrl: string) {
  const cardText = text.length > 12000
    ? `${text.slice(0, 12000)}\n\n[Message truncated for Teams card size.]`
    : text;

  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.2",
          body: [
            {
              type: "TextBlock",
              text: "New Pull List Received:",
              weight: "Bolder",
              size: "Medium",
            },
            {
              type: "TextBlock",
              text: cardText,
              wrap: true,
            },
          ],
          actions: [
            {
              type: "Action.OpenUrl",
              title: "Open Formatted List",
              url: formatterUrl,
            },
          ],
        },
      },
    ],
  };
}

async function saveFormattedList(request: Request, secret: string, data: unknown) {
  const requestUrl = new URL(request.url);
  const response = await fetch(new URL("/api/formatted-lists", requestUrl.origin), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-formatted-list-secret": secret,
    },
    body: JSON.stringify({
      baseId: `${dateStamp()}-${randomSuffix()}`,
      data,
    }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(body.error || `Formatted list save failed (${response.status}).`);
  }

  return body;
}

async function postToTeams(webhookUrl: string, payload: unknown) {
  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Teams post failed (${response.status}): ${body}`);
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}

export async function POST(request: Request) {
  const configuredSecret = env("FORMATTED_LIST_WRITE_SECRET");
  const teamsWebhookUrl = env("TEAMS_WEBHOOK_URL");
  const formatterBaseUrl = env("FORMATTER_BASE_URL", new URL(request.url).origin);

  if (!configuredSecret) {
    return jsonResponse({ error: "FORMATTED_LIST_WRITE_SECRET is not configured in Vercel." }, 500);
  }

  if (!teamsWebhookUrl) {
    return jsonResponse({ error: "TEAMS_WEBHOOK_URL is not configured in Vercel." }, 500);
  }

  try {
    const body = await request.json();
    const rawText = typeof body?.text === "string" ? body.text.trim() : "";
    if (!rawText) {
      return jsonResponse({ error: "Test text is required." }, 400);
    }

    const receivedAt = new Date().toLocaleString();
    const cardText = [
      "From: Teams Test Page",
      "Subject: Manual Pull List Test",
      `Received: ${receivedAt}`,
      "",
      rawText,
    ].join("\n");

    const processed = await processPullListText(cardText, {
      useCheckboxes: true,
    });
    const formattedState = {
      input: cardText,
      output: processed.output,
      processedAt: processed.processedAt,
      reliabilityNote: processed.reliabilityNote,
      customer: processed.customer,
      stats: processedStats(processed),
    };
    const saved = await saveFormattedList(request, configuredSecret, formattedState);
    const formatterUrl = formattedListUrl(formatterBaseUrl, saved.id, cardText);
    await postToTeams(teamsWebhookUrl, makeTeamsPayload(cardText, formatterUrl));

    return jsonResponse({
      ok: true,
      id: saved.id,
      formatterUrl,
      expiresInSeconds: saved.expiresInSeconds,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return jsonResponse({ error: message }, 500);
  }
}

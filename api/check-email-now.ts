import { timingSafeEqual } from "node:crypto";

const DEFAULT_REPOSITORY = "DKlarations/CardListFormatter";
const DEFAULT_WORKFLOW_ID = "email-to-teams.yml";
const DEFAULT_REF = "main";

function env(name: string, fallback = "") {
  return process.env[name] || fallback;
}

function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    },
  });
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function page(title: string, message: string, autoClose = false) {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const autoCloseScript = autoClose
    ? `<script>
      window.setTimeout(() => {
        window.close();
      }, 15000);

      window.setTimeout(() => {
        const fallback = document.querySelector("[data-fallback]");
        if (fallback) fallback.hidden = false;
      }, 15500);
    </script>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background:
          linear-gradient(180deg, rgba(61, 129, 190, 0.08), transparent 320px),
          #101b2a;
        color: #f3f7fb;
      }

      main {
        width: min(520px, calc(100vw - 32px));
        padding: 28px;
        border: 1px solid rgba(255, 255, 255, 0.13);
        border-radius: 8px;
        background: #172638;
        box-shadow: 0 18px 48px rgb(0 0 0 / 28%);
      }

      h1 {
        margin: 0 0 12px;
        font-size: 1.25rem;
      }

      p {
        margin: 0;
        line-height: 1.5;
        color: #d6e1ed;
      }

      button {
        margin-top: 20px;
        min-height: 40px;
        padding: 0 14px;
        border: 1px solid #499bd0;
        border-radius: 8px;
        color: #ffffff;
        background: #2779b8;
        font: inherit;
        font-weight: 800;
        cursor: pointer;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${safeTitle}</h1>
      <p>${safeMessage}</p>
      <p data-fallback hidden>If this tab stays open, you can close it now.</p>
      <button type="button" onclick="window.close()">Close tab</button>
    </main>
    ${autoCloseScript}
  </body>
</html>`;
}

async function dispatchWorkflow(readEnv: typeof env, fetchImpl: typeof fetch) {
  const token = readEnv("GITHUB_WORKFLOW_TOKEN");
  const repository = readEnv("GITHUB_WORKFLOW_REPOSITORY", DEFAULT_REPOSITORY);
  const workflowId = readEnv("GITHUB_WORKFLOW_ID", DEFAULT_WORKFLOW_ID);
  const ref = readEnv("GITHUB_WORKFLOW_REF", DEFAULT_REF);

  if (!token) {
    return {
      ok: false,
      status: 500,
      message: "GITHUB_WORKFLOW_TOKEN is not configured.",
    };
  }

  const response = await fetchImpl(
    `https://api.github.com/repos/${repository}/actions/workflows/${workflowId}/dispatches`,
    {
      method: "POST",
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "user-agent": "rrg-pull-list-formatter",
        "x-github-api-version": "2022-11-28",
      },
      body: JSON.stringify({ ref }),
    },
  );

  if (response.status === 204) {
    return {
      ok: true,
      status: 204,
      message: "Email check started. You can close this tab.",
    };
  }

  return {
    ok: false,
    status: 502,
    message: `GitHub could not start the email check (${response.status}).`,
  };
}

export function createCheckEmailNowHandler({ readEnv = env, fetchImpl = fetch } = {}) {
  return async (request: Request) => {
    const configuredSecret = readEnv("CHECK_EMAIL_NOW_SECRET");
    const providedSecret = new URL(request.url).searchParams.get("secret") || "";
    const expected = Buffer.from(configuredSecret);
    const supplied = Buffer.from(providedSecret);
    if (!configuredSecret || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      return htmlResponse(page("Not Found", "This link is not available."), 404);
    }
    try {
      const result = await dispatchWorkflow(readEnv, fetchImpl);
      if (result.ok) {
        return htmlResponse(page("Email Check Started", "Email check started. This tab will try to close automatically in 15 seconds.", true));
      }
      return htmlResponse(page("Email Check Failed", result.message), result.status);
    } catch {
      return htmlResponse(page("Email Check Failed", "The email check could not be started. Please try again later."), 502);
    }
  };
}

export const GET = createCheckEmailNowHandler();

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

function page(title: string, message: string) {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);

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
        background: #f6f3ed;
        color: #1f2933;
      }

      main {
        width: min(520px, calc(100vw - 32px));
        padding: 28px;
        border: 1px solid #d8d2c8;
        border-radius: 8px;
        background: #fffdf8;
        box-shadow: 0 18px 48px rgb(31 41 51 / 12%);
      }

      h1 {
        margin: 0 0 12px;
        font-size: 1.25rem;
      }

      p {
        margin: 0;
        line-height: 1.5;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${safeTitle}</h1>
      <p>${safeMessage}</p>
    </main>
  </body>
</html>`;
}

async function dispatchWorkflow() {
  const token = env("GITHUB_WORKFLOW_TOKEN");
  const repository = env("GITHUB_WORKFLOW_REPOSITORY", DEFAULT_REPOSITORY);
  const workflowId = env("GITHUB_WORKFLOW_ID", DEFAULT_WORKFLOW_ID);
  const ref = env("GITHUB_WORKFLOW_REF", DEFAULT_REF);

  if (!token) {
    return {
      ok: false,
      status: 500,
      message: "GITHUB_WORKFLOW_TOKEN is not configured.",
    };
  }

  const response = await fetch(
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

  const details = await response.text();
  return {
    ok: false,
    status: response.status,
    message: details || `GitHub returned ${response.status}.`,
  };
}

export async function GET(request: Request) {
  const configuredSecret = env("CHECK_EMAIL_NOW_SECRET");
  const requestUrl = new URL(request.url);
  const providedSecret = requestUrl.searchParams.get("secret") || "";

  if (!configuredSecret || providedSecret !== configuredSecret) {
    return htmlResponse(page("Not Found", "This link is not available."), 404);
  }

  try {
    const result = await dispatchWorkflow();
    if (result.ok) {
      return htmlResponse(page("Email Check Started", result.message));
    }

    return htmlResponse(page("Email Check Failed", result.message), result.status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return htmlResponse(page("Email Check Failed", message), 500);
  }
}

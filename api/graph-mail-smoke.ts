import {
  MicrosoftGraphConfigurationError,
  MicrosoftGraphRequestError,
  getMicrosoftGraphAppToken,
  microsoftGraphConfigFromEnv,
  readMicrosoftGraphMailboxSmokeSample,
  type MicrosoftGraphEnvironment,
  type MicrosoftGraphFailureStage,
  type MicrosoftGraphFetch,
} from "./_microsoft-graph.js";

type GraphMailSmokeHandlerOptions = {
  envSource?: MicrosoftGraphEnvironment;
  fetchImpl?: MicrosoftGraphFetch;
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export function authorizeGraphMailSmokeRequest(
  request: Request,
  envSource: MicrosoftGraphEnvironment = process.env,
) {
  const configuredSecret = envSource.CRON_SECRET || "";
  if (!configuredSecret) {
    return {
      ok: false as const,
      response: jsonResponse({ error: "CRON_SECRET is not configured." }, 500),
    };
  }

  if (request.headers.get("authorization") !== `Bearer ${configuredSecret}`) {
    return {
      ok: false as const,
      response: jsonResponse({ error: "Unauthorized." }, 401),
    };
  }

  return { ok: true as const };
}

function graphFailureResponse(error: unknown, stage: MicrosoftGraphFailureStage) {
  const graphError = error instanceof MicrosoftGraphRequestError ? error : null;
  const responseBody = {
    ok: false,
    stage,
    error: stage === "token"
      ? "Microsoft Graph authentication failed."
      : "Microsoft Graph mailbox read failed.",
    ...(graphError?.providerStatus !== undefined
      ? { providerStatus: graphError.providerStatus }
      : {}),
    ...(graphError?.providerCode ? { providerCode: graphError.providerCode } : {}),
  };

  return jsonResponse(responseBody, 502);
}

export function createGraphMailSmokeHandler(
  options: GraphMailSmokeHandlerOptions = {},
) {
  const envSource = options.envSource || process.env;
  const fetchImpl = options.fetchImpl || fetch;

  return async function GET(request: Request) {
    const authorization = authorizeGraphMailSmokeRequest(request, envSource);
    if (!authorization.ok) return authorization.response;

    let config;
    try {
      config = microsoftGraphConfigFromEnv(envSource);
    } catch (error) {
      if (error instanceof MicrosoftGraphConfigurationError) {
        return jsonResponse({
          ok: false,
          stage: "token",
          error: "Microsoft Graph server configuration is incomplete.",
        }, 500);
      }
      return graphFailureResponse(error, "token");
    }

    let accessToken: string;
    try {
      accessToken = await getMicrosoftGraphAppToken(config, fetchImpl);
    } catch (error) {
      return graphFailureResponse(error, "token");
    }

    try {
      const sample = await readMicrosoftGraphMailboxSmokeSample(config, accessToken, fetchImpl);
      return jsonResponse({
        ok: true,
        stage: "complete",
        mailbox: config.mailboxAddress,
        inboxReachable: true,
        retrievedCount: sample.retrievedCount,
        messages: sample.messages,
      });
    } catch (error) {
      return graphFailureResponse(error, "mailbox");
    }
  };
}

export const GET = createGraphMailSmokeHandler();

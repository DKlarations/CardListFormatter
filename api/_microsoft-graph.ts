const MICROSOFT_LOGIN_BASE_URL = "https://login.microsoftonline.com/";
const MICROSOFT_GRAPH_BASE_URL = "https://graph.microsoft.com/v1.0/";
const MICROSOFT_GRAPH_SCOPE = "https://graph.microsoft.com/.default";
const MAILBOX_SAMPLE_LIMIT = 3;
const MAILBOX_SAMPLE_FIELDS = [
  "id",
  "internetMessageId",
  "subject",
  "from",
  "receivedDateTime",
  "isRead",
] as const;

export type MicrosoftGraphEnvironment = Record<string, string | undefined>;

export type MicrosoftGraphConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  mailboxAddress: string;
};

export type MicrosoftGraphFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type MicrosoftGraphFailureStage = "token" | "mailbox";

export type MicrosoftGraphMailboxSmokeMessage = {
  receivedAt: string;
  isRead: boolean;
  hasSubject: boolean;
  hasSender: boolean;
  senderDomain: string;
  messageIdPresent: boolean;
  internetMessageIdPresent: boolean;
};

export type MicrosoftGraphMailboxSmokeSample = {
  retrievedCount: number;
  messages: MicrosoftGraphMailboxSmokeMessage[];
};

export class MicrosoftGraphConfigurationError extends Error {
  constructor() {
    super(
      "Microsoft Graph configuration is incomplete. Required server environment variables: "
      + "MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, and PULLSMITH_MAILBOX_ADDRESS.",
    );
    this.name = "MicrosoftGraphConfigurationError";
  }
}

export class MicrosoftGraphRequestError extends Error {
  readonly stage: MicrosoftGraphFailureStage;
  readonly providerStatus?: number;
  readonly providerCode?: string;

  constructor(
    stage: MicrosoftGraphFailureStage,
    message: string,
    details: { providerStatus?: number; providerCode?: string } = {},
  ) {
    super(message);
    this.name = "MicrosoftGraphRequestError";
    this.stage = stage;
    this.providerStatus = details.providerStatus;
    this.providerCode = details.providerCode;
  }
}

export function microsoftGraphConfigFromEnv(
  envSource: MicrosoftGraphEnvironment = process.env,
): MicrosoftGraphConfig {
  const tenantId = (envSource.MICROSOFT_TENANT_ID || "").trim();
  const clientId = (envSource.MICROSOFT_CLIENT_ID || "").trim();
  const clientSecret = envSource.MICROSOFT_CLIENT_SECRET || "";
  const mailboxAddress = (envSource.PULLSMITH_MAILBOX_ADDRESS || "").trim();

  if (!tenantId || !clientId || !clientSecret.trim() || !mailboxAddress) {
    throw new MicrosoftGraphConfigurationError();
  }

  return {
    tenantId,
    clientId,
    clientSecret,
    mailboxAddress,
  };
}

function recordFromUnknown(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function safeProviderCode(value: unknown, sensitiveValues: string[]) {
  if (typeof value !== "string") return "";
  const code = value.trim();
  const containsSensitiveValue = sensitiveValues
    .filter(Boolean)
    .some((sensitiveValue) => code.includes(sensitiveValue));
  return code.length <= 100 && /^[A-Za-z0-9._-]+$/.test(code) && !containsSensitiveValue ? code : "";
}

function providerCodeFromPayload(payload: unknown, sensitiveValues: string[]) {
  const body = recordFromUnknown(payload);
  if (!body) return "";

  const directCode = safeProviderCode(body.error, sensitiveValues);
  if (directCode) return directCode;

  const nestedError = recordFromUnknown(body.error);
  return safeProviderCode(nestedError?.code, sensitiveValues);
}

async function providerFailure(
  stage: MicrosoftGraphFailureStage,
  response: Response,
  message: string,
  sensitiveValues: string[],
) {
  let providerCode = "";
  try {
    providerCode = providerCodeFromPayload(await response.json(), sensitiveValues);
  } catch {
    // The upstream body is intentionally discarded when it is not safe JSON.
  }

  return new MicrosoftGraphRequestError(stage, message, {
    providerStatus: response.status,
    ...(providerCode ? { providerCode } : {}),
  });
}

async function responseJson(
  stage: MicrosoftGraphFailureStage,
  response: Response,
  message: string,
) {
  try {
    return await response.json();
  } catch {
    throw new MicrosoftGraphRequestError(stage, message, {
      providerStatus: response.status,
    });
  }
}

export async function getMicrosoftGraphAppToken(
  config: MicrosoftGraphConfig,
  fetchImpl: MicrosoftGraphFetch = fetch,
) {
  const tokenUrl = new URL(
    `${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`,
    MICROSOFT_LOGIN_BASE_URL,
  );
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: MICROSOFT_GRAPH_SCOPE,
    grant_type: "client_credentials",
  });

  const response = await fetchImpl(tokenUrl, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    throw await providerFailure(
      "token",
      response,
      "Microsoft Graph authentication failed.",
      [config.tenantId, config.clientId, config.clientSecret],
    );
  }

  const payload = recordFromUnknown(await responseJson(
    "token",
    response,
    "Microsoft Graph authentication returned an invalid response.",
  ));
  const accessToken = typeof payload?.access_token === "string" ? payload.access_token : "";
  const tokenType = payload?.token_type;

  if (!accessToken.trim()) {
    throw new MicrosoftGraphRequestError(
      "token",
      "Microsoft Graph authentication returned an invalid response.",
      { providerStatus: response.status },
    );
  }

  if (tokenType !== undefined && (
    typeof tokenType !== "string" || tokenType.trim().toLowerCase() !== "bearer"
  )) {
    throw new MicrosoftGraphRequestError(
      "token",
      "Microsoft Graph authentication returned an unsupported token type.",
      { providerStatus: response.status },
    );
  }

  return accessToken;
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}

function senderDomain(address: string) {
  const normalized = address.trim().toLowerCase();
  const separatorIndex = normalized.lastIndexOf("@");
  const domain = separatorIndex >= 0 ? normalized.slice(separatorIndex + 1) : "";
  return domain.length <= 255 && /^[a-z0-9.-]+$/.test(domain) ? domain : "";
}

function privacySafeMessage(value: unknown): MicrosoftGraphMailboxSmokeMessage {
  const message = recordFromUnknown(value) || {};
  const from = recordFromUnknown(message.from);
  const emailAddress = recordFromUnknown(from?.emailAddress);
  const address = typeof emailAddress?.address === "string" ? emailAddress.address : "";

  return {
    receivedAt: typeof message.receivedDateTime === "string" ? message.receivedDateTime : "",
    isRead: message.isRead === true,
    hasSubject: nonEmptyString(message.subject),
    hasSender: nonEmptyString(emailAddress?.address) || nonEmptyString(emailAddress?.name),
    senderDomain: senderDomain(address),
    messageIdPresent: nonEmptyString(message.id),
    internetMessageIdPresent: nonEmptyString(message.internetMessageId),
  };
}

export async function readMicrosoftGraphMailboxSmokeSample(
  config: MicrosoftGraphConfig,
  accessToken: string,
  fetchImpl: MicrosoftGraphFetch = fetch,
): Promise<MicrosoftGraphMailboxSmokeSample> {
  const messagesUrl = new URL(
    `users/${encodeURIComponent(config.mailboxAddress)}/mailFolders/inbox/messages`,
    MICROSOFT_GRAPH_BASE_URL,
  );
  messagesUrl.searchParams.set("$top", String(MAILBOX_SAMPLE_LIMIT));
  messagesUrl.searchParams.set("$select", MAILBOX_SAMPLE_FIELDS.join(","));
  messagesUrl.searchParams.set("$orderby", "receivedDateTime desc");

  const response = await fetchImpl(messagesUrl, {
    method: "GET",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw await providerFailure(
      "mailbox",
      response,
      "Microsoft Graph mailbox read failed.",
      [config.tenantId, config.clientId, config.clientSecret, accessToken],
    );
  }

  const payload = recordFromUnknown(await responseJson(
    "mailbox",
    response,
    "Microsoft Graph mailbox read returned an invalid response.",
  ));
  if (!Array.isArray(payload?.value)) {
    throw new MicrosoftGraphRequestError(
      "mailbox",
      "Microsoft Graph mailbox read returned an invalid response.",
      { providerStatus: response.status },
    );
  }

  const messages = payload.value.slice(0, MAILBOX_SAMPLE_LIMIT).map(privacySafeMessage);
  return {
    retrievedCount: messages.length,
    messages,
  };
}

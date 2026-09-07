import assert from "node:assert/strict";
import test from "node:test";
import { importBundledModule } from "./test-module-bundle.mjs";

const graphModule = await importBundledModule("api/_microsoft-graph.ts", "pullsmith-microsoft-graph");
const routeModule = await importBundledModule("api/graph-mail-smoke.ts", "pullsmith-graph-mail-smoke-route");

const UNIT_SECRET = "unit-test-secret";
const UNIT_ACCESS_TOKEN = "unit-test-access-token";
const UNIT_CRON_SECRET = "unit-test-cron-secret";

const graphConfig = {
  tenantId: "unit-test-tenant",
  clientId: "unit-test-client",
  clientSecret: UNIT_SECRET,
  mailboxAddress: "service@example.test",
};

const completeEnvironment = {
  CRON_SECRET: UNIT_CRON_SECRET,
  MICROSOFT_TENANT_ID: graphConfig.tenantId,
  MICROSOFT_CLIENT_ID: graphConfig.clientId,
  MICROSOFT_CLIENT_SECRET: graphConfig.clientSecret,
  PULLSMITH_MAILBOX_ADDRESS: graphConfig.mailboxAddress,
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestUrl(input) {
  return new URL(input instanceof Request ? input.url : String(input));
}

function requestHeaders(init) {
  return new Headers(init?.headers);
}

test("Microsoft Graph configuration requires a complete server-only credential set", () => {
  assert.deepEqual(graphModule.microsoftGraphConfigFromEnv({
    MICROSOFT_TENANT_ID: "  unit-test-tenant  ",
    MICROSOFT_CLIENT_ID: "  unit-test-client  ",
    MICROSOFT_CLIENT_SECRET: ` ${UNIT_SECRET} `,
    PULLSMITH_MAILBOX_ADDRESS: "  service@example.test  ",
  }), {
    tenantId: "unit-test-tenant",
    clientId: "unit-test-client",
    clientSecret: ` ${UNIT_SECRET} `,
    mailboxAddress: "service@example.test",
  });

  for (const missingName of [
    "MICROSOFT_TENANT_ID",
    "MICROSOFT_CLIENT_ID",
    "MICROSOFT_CLIENT_SECRET",
    "PULLSMITH_MAILBOX_ADDRESS",
  ]) {
    const incomplete = { ...completeEnvironment };
    delete incomplete[missingName];
    assert.throws(
      () => graphModule.microsoftGraphConfigFromEnv(incomplete),
      (error) => {
        assert.match(error.message, /Microsoft Graph configuration is incomplete/);
        assert.equal(error.message.includes(UNIT_SECRET), false);
        return true;
      },
    );
  }
});

test("app token acquisition constructs the client-credentials form request and returns only the access token", async () => {
  let captured;
  const accessToken = await graphModule.getMicrosoftGraphAppToken(graphConfig, async (input, init) => {
    captured = { input, init };
    return jsonResponse({
      access_token: UNIT_ACCESS_TOKEN,
      token_type: "Bearer",
      expires_in: 3599,
      refresh_token: "must-not-be-returned",
    });
  });

  const url = requestUrl(captured.input);
  const body = new URLSearchParams(String(captured.init.body));
  assert.equal(captured.init.method, "POST");
  assert.equal(url.origin, "https://login.microsoftonline.com");
  assert.equal(url.pathname, "/unit-test-tenant/oauth2/v2.0/token");
  assert.equal(requestHeaders(captured.init).get("content-type"), "application/x-www-form-urlencoded");
  assert.equal(body.get("client_id"), graphConfig.clientId);
  assert.equal(body.get("client_secret"), UNIT_SECRET);
  assert.equal(body.get("scope"), "https://graph.microsoft.com/.default");
  assert.equal(body.get("grant_type"), "client_credentials");
  assert.equal(accessToken, UNIT_ACCESS_TOKEN);
  assert.equal(typeof accessToken, "string");
});

test("token provider 400 and 401 failures retain only safe staged details", async (t) => {
  for (const status of [400, 401]) {
    await t.test(`HTTP ${status}`, async () => {
      await assert.rejects(
        graphModule.getMicrosoftGraphAppToken(graphConfig, async () => jsonResponse({
          error: status === 400 ? "invalid_request" : "invalid_client",
          error_description: `unsafe upstream detail containing ${UNIT_SECRET}`,
        }, status)),
        (error) => {
          assert.equal(error.stage, "token");
          assert.equal(error.providerStatus, status);
          assert.equal(error.providerCode, status === 400 ? "invalid_request" : "invalid_client");
          assert.equal(error.message, "Microsoft Graph authentication failed.");
          assert.equal(error.message.includes(UNIT_SECRET), false);
          assert.equal(JSON.stringify(error).includes(UNIT_SECRET), false);
          return true;
        },
      );
    });
  }
});

test("provider codes that repeat a credential are discarded", async () => {
  await assert.rejects(
    graphModule.getMicrosoftGraphAppToken(
      graphConfig,
      async () => jsonResponse({ error: UNIT_SECRET }, 401),
    ),
    (error) => {
      assert.equal(error.providerCode, undefined);
      assert.equal(error.message.includes(UNIT_SECRET), false);
      assert.equal(JSON.stringify(error).includes(UNIT_SECRET), false);
      return true;
    },
  );
});

test("token success responses must contain a usable access token and valid JSON", async () => {
  const failures = [
    async () => jsonResponse({ token_type: "Bearer" }),
    async () => new Response("{not-json", {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ];

  for (const fetchImpl of failures) {
    await assert.rejects(
      graphModule.getMicrosoftGraphAppToken(graphConfig, fetchImpl),
      (error) => {
        assert.equal(error.stage, "token");
        assert.equal(error.message.includes(UNIT_SECRET), false);
        return true;
      },
    );
  }
});

test("mailbox smoke read uses one metadata-only Inbox GET and returns privacy-safe structure", async () => {
  let captured;
  const privateMessage = {
    id: "graph-private-id-1",
    internetMessageId: "<internet-private-id-1@example.com>",
    subject: "Private order for Alice",
    from: {
      emailAddress: {
        name: "Alice Customer",
        address: "alice.customer@Example.COM",
      },
    },
    receivedDateTime: "2026-09-01T14:15:16Z",
    isRead: false,
  };
  const sample = await graphModule.readMicrosoftGraphMailboxSmokeSample(
    graphConfig,
    UNIT_ACCESS_TOKEN,
    async (input, init) => {
      captured = { input, init };
      return jsonResponse({
        value: [
          privateMessage,
          {
            id: "graph-private-id-2",
            internetMessageId: "<internet-private-id-2@example.net>",
            subject: "Another private subject",
            from: { emailAddress: { name: "Bob Customer", address: "bob@example.net" } },
            receivedDateTime: "2026-09-01T13:00:00Z",
            isRead: true,
          },
          {
            id: "graph-private-id-3",
            internetMessageId: "<internet-private-id-3@example.org>",
            subject: "Third private subject",
            from: { emailAddress: { name: "Sender Without Address" } },
            receivedDateTime: "2026-09-01T12:00:00Z",
            isRead: false,
          },
          {
            id: "graph-private-id-4",
            subject: "Graph must not return more than three",
            receivedDateTime: "2026-09-01T11:00:00Z",
            isRead: false,
          },
        ],
      });
    },
  );

  const url = requestUrl(captured.input);
  const selectedFields = url.searchParams.get("$select").split(",");
  assert.equal(captured.init.method, "GET");
  assert.equal(url.origin, "https://graph.microsoft.com");
  assert.equal(
    decodeURIComponent(url.pathname),
    "/v1.0/users/service@example.test/mailFolders/inbox/messages",
  );
  assert.equal(url.searchParams.get("$top"), "3");
  assert.deepEqual(selectedFields, [
    "id",
    "internetMessageId",
    "subject",
    "from",
    "receivedDateTime",
    "isRead",
  ]);
  assert.equal(selectedFields.includes("body"), false);
  assert.equal(selectedFields.includes("bodyPreview"), false);
  assert.equal(selectedFields.includes("attachments"), false);
  assert.equal(url.searchParams.get("$orderby"), "receivedDateTime desc");
  assert.equal(requestHeaders(captured.init).get("authorization"), `Bearer ${UNIT_ACCESS_TOKEN}`);

  assert.equal(sample.retrievedCount, 3);
  assert.deepEqual(sample.messages[0], {
    receivedAt: "2026-09-01T14:15:16Z",
    isRead: false,
    hasSubject: true,
    hasSender: true,
    senderDomain: "example.com",
    messageIdPresent: true,
    internetMessageIdPresent: true,
  });
  assert.equal(sample.messages[2].hasSender, true);
  assert.equal(sample.messages[2].senderDomain, "");

  const serialized = JSON.stringify(sample);
  for (const privateValue of [
    privateMessage.subject,
    privateMessage.from.emailAddress.name,
    privateMessage.from.emailAddress.address,
    privateMessage.id,
    privateMessage.internetMessageId,
  ]) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test("mailbox provider failures expose no token or upstream private message", async () => {
  await assert.rejects(
    graphModule.readMicrosoftGraphMailboxSmokeSample(
      graphConfig,
      UNIT_ACCESS_TOKEN,
      async () => jsonResponse({
        error: {
          code: "ErrorAccessDenied",
          message: `private provider detail with ${UNIT_ACCESS_TOKEN} and ${UNIT_SECRET}`,
        },
      }, 403),
    ),
    (error) => {
      assert.equal(error.stage, "mailbox");
      assert.equal(error.providerStatus, 403);
      assert.equal(error.providerCode, "ErrorAccessDenied");
      assert.equal(error.message, "Microsoft Graph mailbox read failed.");
      assert.equal(error.message.includes(UNIT_ACCESS_TOKEN), false);
      assert.equal(error.message.includes(UNIT_SECRET), false);
      return true;
    },
  );
});

test("route authorization rejects missing, wrong, and query-string secrets before Microsoft fetch", async () => {
  for (const request of [
    new Request("https://pullsmith.example/api/graph-mail-smoke"),
    new Request("https://pullsmith.example/api/graph-mail-smoke", {
      headers: { authorization: "Bearer wrong-secret" },
    }),
    new Request(`https://pullsmith.example/api/graph-mail-smoke?secret=${UNIT_CRON_SECRET}`),
  ]) {
    let fetchCount = 0;
    const handler = routeModule.createGraphMailSmokeHandler({
      envSource: completeEnvironment,
      fetchImpl: async () => {
        fetchCount += 1;
        throw new Error("Microsoft fetch must not execute.");
      },
    });
    const response = await handler(request);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Unauthorized." });
    assert.equal(fetchCount, 0);
  }
});

test("route reports missing CRON_SECRET safely before reading Microsoft configuration or fetching", async () => {
  let microsoftCredentialReadCount = 0;
  let fetchCount = 0;
  const envSource = new Proxy({}, {
    get(_target, property) {
      if (String(property).startsWith("MICROSOFT_") || property === "PULLSMITH_MAILBOX_ADDRESS") {
        microsoftCredentialReadCount += 1;
      }
      return undefined;
    },
  });
  const handler = routeModule.createGraphMailSmokeHandler({
    envSource,
    fetchImpl: async () => {
      fetchCount += 1;
      throw new Error("Microsoft fetch must not execute.");
    },
  });

  const response = await handler(new Request("https://pullsmith.example/api/graph-mail-smoke"));
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "CRON_SECRET is not configured." });
  assert.equal(microsoftCredentialReadCount, 0);
  assert.equal(fetchCount, 0);
});

test("authorized route performs only token POST then Inbox GET and returns the safe sample", async () => {
  const requests = [];
  const handler = routeModule.createGraphMailSmokeHandler({
    envSource: completeEnvironment,
    fetchImpl: async (input, init) => {
      const url = requestUrl(input);
      requests.push({ url, method: init?.method || "GET" });
      if (url.origin === "https://login.microsoftonline.com") {
        return jsonResponse({ access_token: UNIT_ACCESS_TOKEN, token_type: "Bearer" });
      }
      if (url.origin === "https://graph.microsoft.com") {
        return jsonResponse({
          value: [{
            id: "route-private-graph-id",
            internetMessageId: "<route-private-internet-id@example.com>",
            subject: "Route private subject",
            from: { emailAddress: { name: "Route Private Name", address: "private@example.com" } },
            receivedDateTime: "2026-09-01T15:00:00Z",
            isRead: false,
          }],
        });
      }
      throw new Error("Unexpected request.");
    },
  });

  const response = await handler(new Request("https://pullsmith.example/api/graph-mail-smoke", {
    headers: { authorization: `Bearer ${UNIT_CRON_SECRET}` },
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(body, {
    ok: true,
    stage: "complete",
    mailbox: graphConfig.mailboxAddress,
    inboxReachable: true,
    retrievedCount: 1,
    messages: [{
      receivedAt: "2026-09-01T15:00:00Z",
      isRead: false,
      hasSubject: true,
      hasSender: true,
      senderDomain: "example.com",
      messageIdPresent: true,
      internetMessageIdPresent: true,
    }],
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].method, "POST");
  const graphResourceRequests = requests.filter(({ url }) => url.origin === "https://graph.microsoft.com");
  assert.equal(graphResourceRequests.length, 1);
  assert.equal(graphResourceRequests.every(({ method }) => method === "GET"), true);
  assert.match(graphResourceRequests[0].url.pathname, /\/mailFolders\/inbox\/messages$/);
  assert.equal(requests.some(({ url }) => /sendMail/i.test(url.href)), false);

  const serialized = JSON.stringify(body);
  for (const privateValue of [
    "Route private subject",
    "Route Private Name",
    "private@example.com",
    "route-private-graph-id",
    "route-private-internet-id",
    UNIT_ACCESS_TOKEN,
    UNIT_SECRET,
  ]) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test("route returns safe token and mailbox failure stages", async (t) => {
  await t.test("token", async () => {
    const handler = routeModule.createGraphMailSmokeHandler({
      envSource: completeEnvironment,
      fetchImpl: async () => jsonResponse({
        error: "invalid_client",
        error_description: `unsafe ${UNIT_SECRET}`,
      }, 401),
    });
    const response = await handler(new Request("https://pullsmith.example/api/graph-mail-smoke", {
      headers: { authorization: `Bearer ${UNIT_CRON_SECRET}` },
    }));
    const bodyText = await response.text();
    assert.equal(response.status, 502);
    assert.deepEqual(JSON.parse(bodyText), {
      ok: false,
      stage: "token",
      error: "Microsoft Graph authentication failed.",
      providerStatus: 401,
      providerCode: "invalid_client",
    });
    assert.equal(bodyText.includes(UNIT_SECRET), false);
  });

  await t.test("mailbox", async () => {
    let callCount = 0;
    const handler = routeModule.createGraphMailSmokeHandler({
      envSource: completeEnvironment,
      fetchImpl: async () => {
        callCount += 1;
        return callCount === 1
          ? jsonResponse({ access_token: UNIT_ACCESS_TOKEN, token_type: "Bearer" })
          : jsonResponse({ error: { code: "ErrorAccessDenied", message: "Private detail" } }, 403);
      },
    });
    const response = await handler(new Request("https://pullsmith.example/api/graph-mail-smoke", {
      headers: { authorization: `Bearer ${UNIT_CRON_SECRET}` },
    }));
    const bodyText = await response.text();
    assert.equal(response.status, 502);
    assert.deepEqual(JSON.parse(bodyText), {
      ok: false,
      stage: "mailbox",
      error: "Microsoft Graph mailbox read failed.",
      providerStatus: 403,
      providerCode: "ErrorAccessDenied",
    });
    assert.equal(bodyText.includes(UNIT_ACCESS_TOKEN), false);
    assert.equal(bodyText.includes("Private detail"), false);
  });
});

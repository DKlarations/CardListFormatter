import assert from "node:assert/strict";
import test from "node:test";
import { importBundledModule } from "./test-module-bundle.mjs";
import { buildPullListTeamsCard } from "../shared/pull-list-teams-card.mjs";

const { createCheckEmailNowHandler } = await importBundledModule("api/check-email-now.ts", "check-email-api");
const { createSendTestTeamsHandler } = await importBundledModule("api/send-test-teams.ts", "send-teams-api");
const { createEmailIngestHandler } = await importBundledModule("api/_email-ingest.ts", "email-ingest");
const { createPullListJob, getPullListJob } = await importBundledModule("api/_pull-list-job-repository.ts", "email-job-repository");
const env = {
  CHECK_EMAIL_NOW_SECRET: "check-link-secret", GITHUB_WORKFLOW_TOKEN: "github-token-secret",
  IMAP_PASSWORD: "mailbox-secret", FORMATTED_LIST_WRITE_SECRET: "write-secret", TEAMS_WEBHOOK_URL: "https://workflow.example.test/private-url",
  FORMATTER_BASE_URL: "https://pullsmith.example/",
};
const readEnv = (name, fallback = "") => env[name] || fallback;
const checkUrl = "https://pullsmith.example/api/check-email-now?secret=check-link-secret";

test("Check Email Now dispatches the existing workflow defaults with token in authorization only", async () => {
  const calls = [];
  const handler = createCheckEmailNowHandler({ readEnv, fetchImpl: async (...args) => { calls.push(args); return new Response(null, { status: 204 }); } });
  const response = await handler(new Request(checkUrl));
  assert.equal(response.status, 200);
  assert.equal(calls[0][0], "https://api.github.com/repos/DKlarations/CardListFormatter/actions/workflows/email-to-teams.yml/dispatches");
  assert.equal(calls[0][1].method, "POST");
  assert.equal(calls[0][1].headers.authorization, "Bearer github-token-secret");
  assert.deepEqual(JSON.parse(calls[0][1].body), { ref: "main" });
  const html = await response.text();
  for (const secret of [env.GITHUB_WORKFLOW_TOKEN, env.IMAP_PASSWORD, env.CHECK_EMAIL_NOW_SECRET]) assert.ok(!html.includes(secret));
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
});

test("Check Email authorization rejects missing, incorrect, and unconfigured secrets before dispatch", async () => {
  let calls = 0;
  for (const [query, configured] of [["", true], ["?secret=wrong", true], ["?secret=check-link-secret", false]]) {
    const handler = createCheckEmailNowHandler({ readEnv: (name, fallback) => !configured && name === "CHECK_EMAIL_NOW_SECRET" ? "" : readEnv(name, fallback), fetchImpl: async () => { calls += 1; throw new Error("must not dispatch"); } });
    assert.equal((await handler(new Request(`https://pullsmith.example/api/check-email-now${query}`))).status, 404);
  }
  assert.equal(calls, 0);
});

test("Check Email keeps repository/workflow/ref overrides and never returns upstream secrets", async () => {
  const overrides = { GITHUB_WORKFLOW_REPOSITORY: "example/custom", GITHUB_WORKFLOW_ID: "custom.yml", GITHUB_WORKFLOW_REF: "preview" };
  const handler = createCheckEmailNowHandler({ readEnv: (name, fallback) => overrides[name] || readEnv(name, fallback), fetchImpl: async (url, init) => {
    assert.equal(url, "https://api.github.com/repos/example/custom/actions/workflows/custom.yml/dispatches");
    assert.deepEqual(JSON.parse(init.body), { ref: "preview" });
    return new Response(`${env.GITHUB_WORKFLOW_TOKEN} ${env.IMAP_PASSWORD}`, { status: 403 });
  } });
  const response = await handler(new Request(checkUrl));
  assert.equal(response.status, 502);
  const html = await response.text();
  assert.ok(!html.includes(env.GITHUB_WORKFLOW_TOKEN));
  assert.ok(!html.includes(env.IMAP_PASSWORD));
  const failure = createCheckEmailNowHandler({ readEnv, fetchImpl: async () => { throw new Error(env.GITHUB_WORKFLOW_TOKEN); } });
  assert.ok(!(await (await failure(new Request(checkUrl))).text()).includes(env.GITHUB_WORKFLOW_TOKEN));
});

import { FakePullListRedis as FakeRedis } from "./fake-pull-list-redis.mjs";

function emailData(quantity = 2) {
  return {
    customer: { name: "Pat Example", email: "pat@example.test" }, input: `${quantity} Lightning Bolt`, output: `${quantity} Lightning Bolt`,
    formatterItems: [{ index: 0, quantity, inputName: "Lightning Bolt", status: "found", requestedPrinting: { setCode: "2XM" }, card: { name: "Lightning Bolt" } }],
    processedAt: "2026-09-07T05:41:00Z", formatterSettings: { useCheckboxes: true },
    stats: { resolvedCount: 1, needsReviewCount: 0, printFallbackCount: 0 },
  };
}
const emailDisplay = { sender: "Pat Example", subject: "MTG list", receivedAt: "2026-09-07T05:41:00Z", body: "2 Lightning Bolt\n" };
const ingestRequest = (data = emailData(), secret = env.FORMATTED_LIST_WRITE_SECRET) => new Request("https://pullsmith.example/api/teams-actions?action=ingest", {
  method: "POST", headers: { "content-type": "application/json", "x-formatted-list-secret": secret }, body: JSON.stringify({ data, emailDisplay, checkEmailNowUrl: checkUrl }),
});

test("protected email ingest creates complete jobs and reuses duplicate identities while revisions stay distinct", async () => {
  const store = new FakeRedis();
  const handler = createEmailIngestHandler({ getStore: () => store, env: readEnv, renderCard: (job, _request, url) => buildPullListTeamsCard({ jobId: job.id, emailDisplay: job.emailDisplay, checkEmailNowUrl: url, printStatus: job.printStatus }) });
  const response = await handler(ingestRequest({ ...emailData(), source: "manual", printStatus: { pricingPrintedAt: "2026-09-07T05:41:00Z" }, teams: { messageId: "forged" } }));
  assert.equal(response.status, 201);
  const created = await response.json();
  assert.equal(created.job.source, "email");
  assert.equal(created.job.teams, undefined);
  assert.deepEqual(created.job.printStatus, { pullListPrintedAt: "", pricingPrintedAt: "" });
  assert.deepEqual(created.job.pricingState.rows, []);
  assert.deepEqual(created.job.pricingState.excludedSourceIndices, []);
  assert.deepEqual(created.job.formatterItems, emailData().formatterItems);
  assert.equal(created.job.emailDisplay.body, emailDisplay.body);
  assert.equal(created.job.emailDisplay.checkEmailNowUrl, checkUrl);
  assert.equal(new URL(created.url).searchParams.get("job"), created.id);
  assert.equal(new URL(created.url).searchParams.get("list"), null);
  assert.deepEqual(await getPullListJob(store, created.id), created.job);
  const duplicate = await (await handler(ingestRequest())).json();
  assert.equal(duplicate.id, created.id);
  assert.equal(duplicate.duplicate, true);
  const revised = await (await handler(ingestRequest(emailData(3)))).json();
  assert.notEqual(revised.id, created.id);
  assert.equal(store.values.size, 4);
});

test("unauthorized or incomplete email ingestion cannot create records", async () => {
  const store = new FakeRedis();
  const handler = createEmailIngestHandler({ getStore: () => store, env: readEnv, renderCard: () => ({}) });
  assert.equal((await handler(ingestRequest(emailData(), "wrong"))).status, 401);
  assert.equal((await handler(ingestRequest({ input: "incomplete" })) ).status, 400);
  assert.equal(store.values.size, 0);
});

test("duplicate ingestion attaches original email to a manual job without losing pricing or print progress", async () => {
  const store = new FakeRedis();
  const initial = await createPullListJob(store, { ...emailData(), source: "manual",
    pricingState: { version: 1, rows: [], excludedSourceIndices: [0], includeNotFound: false, pricingSource: "tcgplayer-listed-median" },
    printStatus: { pullListPrintedAt: "2026-09-07T05:41:00.000Z", pricingPrintedAt: "2026-09-07T06:08:00.000Z" },
  });
  const handler = createEmailIngestHandler({ getStore: () => store, env: readEnv, renderCard: (job) => buildPullListTeamsCard({ jobId: job.id, emailDisplay: job.emailDisplay }) });
  const response = await handler(ingestRequest());
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.id, initial.job.id);
  assert.equal(result.job.source, "email");
  for (const key of ["customer", "input", "output", "formatterItems", "pricingState", "printStatus", "fingerprint", "search"]) {
    assert.deepEqual(result.job[key], initial.job[key], key);
  }
  assert.equal(result.job.emailDisplay.body, emailDisplay.body);
  assert.ok(result.card.body[1].text.endsWith(emailDisplay.body));
});

test("trusted ingestion retains the original Check Email capability URL for later replacement cards", async () => {
  const { renderJobTeamsCard } = await importBundledModule("api/_teams-sync.ts", "email-check-url-retention");
  const store = new FakeRedis();
  const handler = createEmailIngestHandler({ getStore: () => store, env: readEnv,
    renderCard: (job, _request, override) => renderJobTeamsCard(job, env, override),
  });
  const result = await (await handler(ingestRequest())).json();
  assert.equal(env.CHECK_EMAIL_NOW_URL, undefined);
  assert.equal(result.job.emailDisplay.checkEmailNowUrl, checkUrl);
  const card = renderJobTeamsCard(await getPullListJob(store, result.id), env);
  assert.deepEqual(card.actions.filter((action) => action.title === "Check Email Now"), [
    { type: "Action.OpenUrl", title: "Check Email Now", url: checkUrl },
  ]);
});

for (const checkEmailNowUrl of [checkUrl, ""]) {
  test(`/teams-test uses the same server-rendered card and Check Email action (${Boolean(checkEmailNowUrl)})`, async () => {
    const calls = [], warnings = [];
    let serverCard;
    const handler = createSendTestTeamsHandler({
      readEnv: (name, fallback) => name === "CHECK_EMAIL_NOW_URL" ? checkEmailNowUrl : readEnv(name, fallback),
      warn: (message) => warnings.push(message),
      processText: async () => ({ ...emailData(), items: [{ status: "found" }] }), compactItems: () => emailData().formatterItems,
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), ...init });
        if (String(url).includes("action=ingest")) {
          const body = JSON.parse(init.body);
          assert.equal(init.headers["x-formatted-list-secret"], env.FORMATTED_LIST_WRITE_SECRET);
          serverCard = buildPullListTeamsCard({ jobId: "pl_test", emailDisplay: body.emailDisplay, formatterUrl: "https://pullsmith.example/?job=pl_test", checkEmailNowUrl: body.checkEmailNowUrl });
          return Response.json({ id: "pl_test", url: "https://pullsmith.example/?job=pl_test", card: serverCard });
        }
        return new Response(null, { status: 202 });
      },
    });
    const response = await handler(new Request("https://pullsmith.example/api/send-test-teams", { method: "POST", body: JSON.stringify({ text: "2 Lightning Bolt" }) }));
    assert.equal(response.status, 200);
    assert.equal(calls.length, 2);
    const payload = JSON.parse(calls[1].body);
    assert.deepEqual(payload.card, serverCard);
    assert.equal(payload.operation, "post-card");
    assert.equal(payload.jobId, "pl_test");
    assert.deepEqual(payload.card.actions.filter((action) => action.title === "Check Email Now"), checkEmailNowUrl ? [{ type: "Action.OpenUrl", title: "Check Email Now", url: checkEmailNowUrl }] : []);
    assert.equal(warnings.length, checkEmailNowUrl ? 0 : 1);
    for (const secret of [env.GITHUB_WORKFLOW_TOKEN, env.IMAP_PASSWORD, env.FORMATTED_LIST_WRITE_SECRET, env.TEAMS_WEBHOOK_URL]) {
      assert.ok(!calls[1].body.includes(secret));
    }
  });
}

test("a /teams-test ingest failure prevents a Teams post and hides upstream error details", async () => {
  let requests = 0;
  const handler = createSendTestTeamsHandler({ readEnv, warn: () => {}, processText: async () => ({ ...emailData(), items: [] }), compactItems: () => [], fetchImpl: async () => { requests += 1; return Response.json({ error: env.IMAP_PASSWORD }, { status: 500 }); } });
  const response = await handler(new Request("https://pullsmith.example/api/send-test-teams", { method: "POST", body: JSON.stringify({ text: "test" }) }));
  assert.equal(response.status, 502);
  assert.equal(requests, 1);
  assert.ok(!(await response.text()).includes(env.IMAP_PASSWORD));
});

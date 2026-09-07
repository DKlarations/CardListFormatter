import assert from "node:assert/strict";
import test from "node:test";
import { importBundledModule } from "./test-module-bundle.mjs";
import { FakePullListRedis } from "./fake-pull-list-redis.mjs";

const tokens = await importBundledModule("api/_teams-action-token.ts", "teams-tokens");
const api = await importBundledModule("api/teams-actions.ts", "teams-actions");
const sync = await importBundledModule("api/_teams-sync.ts", "teams-sync");
const repo = await importBundledModule("api/_pull-list-job-repository.ts", "teams-repo");
const now = Date.parse("2026-09-07T07:41:00.000Z");
const env = { TEAMS_ACTION_SIGNING_SECRET: "test-signing-private", FORMATTED_LIST_WRITE_SECRET: "test-write-private",
  TEAMS_UPDATE_WORKFLOW_SECRET: "test-update-private", TEAMS_UPDATE_WORKFLOW_URL: "https://workflow.example.test/update",
  FORMATTER_BASE_URL: "https://pullsmith.example.test/", CHECK_EMAIL_NOW_URL: "https://pullsmith.example.test/api/check-email-now?secret=capability" };
async function setup(withTeams = true) {
  const store = new FakePullListRedis();
  const result = await repo.createPullListJob(store, { customer: { name: "TEST ONLY", phone: "", email: "test@example.invalid" },
    input: "1 Lightning Bolt", output: "1 Lightning Bolt", formatterItems: [{ index: 0, quantity: 1, inputName: "Lightning Bolt", status: "found", card: { name: "Lightning Bolt" } }],
    pricingState: { version: 1, rows: [], excludedSourceIndices: [], pricingSource: "tcgplayer-listed-median", includeNotFound: true },
    printStatus: { pullListPrintedAt: "", pricingPrintedAt: "" }, source: "email", processedAt: new Date(now).toISOString(),
    emailDisplay: { sender: "Test <test@example.invalid>", subject: "TEST ONLY", receivedAt: new Date(now).toISOString(), body: "1 Lightning Bolt\n".repeat(1000) },
    stats: { resolvedCount: 1, needsReviewCount: 0, printFallbackCount: 0 }, formatterSettings: { useCheckboxes: true },
    ...(withTeams ? { teams: { teamId: "team", channelId: "channel", conversationId: "conversation", messageId: "message", messageLink: "https://teams.microsoft.com/l/message/test", postedAt: new Date(now).toISOString() } } : {}),
  }, now);
  return { store, job: result.job };
}
function action(jobId, target = "pull-list", exp = Math.floor(now / 1000) + 3600) {
  return tokens.signTeamsAction({ v: 1, jobId, target, exp }, env.TEAMS_ACTION_SIGNING_SECRET);
}
function request(jobId, target, token, method = "GET") {
  const params = new URLSearchParams({ id: jobId, target, token });
  return new Request(`https://pullsmith.example.test/api/teams-actions${method === "GET" ? `?${params}` : ""}`, method === "GET" ? {} : {
    method, headers: { "content-type": "application/x-www-form-urlencoded", origin: "https://pullsmith.example.test" }, body: params,
  });
}
test("HMAC tokens bind both targets, job, expiration and version; malformed and altered claims fail", () => {
  for (const target of ["pull-list", "pricing"]) {
    const token = action("pl_test", target);
    assert.equal(tokens.verifyTeamsAction(token, env.TEAMS_ACTION_SIGNING_SECRET, "pl_test", target, now).target, target);
    assert.equal(tokens.verifyTeamsAction(token, env.TEAMS_ACTION_SIGNING_SECRET, "pl_other", target, now), null);
    assert.equal(tokens.verifyTeamsAction(token, env.TEAMS_ACTION_SIGNING_SECRET, "pl_test", target === "pricing" ? "pull-list" : "pricing", now), null);
    const [payload, signature] = token.split(".");
    for (const changed of [{ jobId: "pl_other" }, { target: "other" }, { exp: Math.floor(now / 1000) + 999999 }]) {
      const claims = { ...JSON.parse(Buffer.from(payload, "base64url")), ...changed };
      const altered = `${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${signature}`;
      assert.equal(tokens.verifyTeamsAction(altered, env.TEAMS_ACTION_SIGNING_SECRET, "pl_test", target, now), null);
    }
    assert.equal(tokens.verifyTeamsAction(token, "wrong-secret", "pl_test", target, now), null);
  }
  assert.equal(tokens.verifyTeamsAction(action("pl_test", "pricing", Math.floor(now / 1000)), env.TEAMS_ACTION_SIGNING_SECRET, "pl_test", "pricing", now), null);
  for (const token of [null, "", "bad", "x.y.z", "###.###", "a".repeat(2048)]) assert.equal(tokens.verifyTeamsAction(token, env.TEAMS_ACTION_SIGNING_SECRET, "pl_test", "pricing", now), null);
});
test("confirmation GET never mutates; POST preserves complete job and replay timestamp", async () => {
  const { store, job } = await setup();
  const calls = [];
  let clock = now;
  const handlers = api.createTeamsActionHandlers({ getStore: () => store, env, now: () => clock, sync: async (_store, id) => { calls.push(id); return { status: "updated" }; } });
  const token = action(job.id);
  const before = structuredClone(await store.get(`pull-list-job:${job.id}`));
  const get = await handlers.GET(request(job.id, "pull-list", token));
  const html = await get.text();
  assert.equal(get.status, 200); assert.match(html, /Confirm Pull List Printed/); assert.match(html, /method="post"/);
  assert.equal(get.headers.get("referrer-policy"), "strict-origin");
  assert.deepEqual(await store.get(`pull-list-job:${job.id}`), before); assert.equal(calls.length, 0);
  assert.ok(!html.includes(env.TEAMS_ACTION_SIGNING_SECRET)); assert.ok(!html.includes(env.FORMATTED_LIST_WRITE_SECRET));
  const post = await handlers.POST(request(job.id, "pull-list", token, "POST"));
  assert.equal(post.status, 200); assert.match(await post.text(), /Print status saved/);
  const saved = await store.get(`pull-list-job:${job.id}`);
  for (const field of ["customer", "input", "output", "formatterItems", "pricingState", "teams", "emailDisplay", "source", "fingerprint", "search"]) assert.deepEqual(saved[field], before[field]);
  assert.equal(saved.printStatus.pullListPrintedAt, new Date(now).toISOString());
  clock += 60000;
  await handlers.POST(request(job.id, "pull-list", token, "POST"));
  assert.equal((await store.get(`pull-list-job:${job.id}`)).printStatus.pullListPrintedAt, saved.printStatus.pullListPrintedAt);
  await handlers.POST(request(job.id, "pricing", action(job.id, "pricing"), "POST"));
  const both = await repo.getPullListJob(store, job.id, clock);
  assert.equal(both.printStatus.pullListPrintedAt, saved.printStatus.pullListPrintedAt);
  assert.equal(both.printStatus.pricingPrintedAt, new Date(clock).toISOString());
  for (const method of ["GET", "POST"]) assert.equal((await handlers[method](request(job.id, "pricing", "invalid", method))).status, 404);
  for (const method of ["GET", "POST"]) assert.equal((await handlers[method](request(job.id, "pricing", action(job.id, "pricing", Math.floor(now / 1000)), method))).status, 404);
  const crossOrigin = request(job.id, "pricing", action(job.id, "pricing"), "POST");
  crossOrigin.headers.set("origin", "https://untrusted.example");
  assert.equal((await handlers.POST(crossOrigin)).status, 404);
});
test("callback requires internal secret, stores identity idempotently, rejects replacement, synchronizes earlier prints", async () => {
  const { store, job } = await setup(false);
  const syncCalls = [];
  const handlers = api.createTeamsActionHandlers({ getStore: () => store, env, now: () => now, sync: async (_store, id) => { syncCalls.push(id); return { status: "updated" }; } });
  const teams = { teamId: "team", channelId: "channel", conversationId: "conversation", messageId: "message", messageLink: "https://teams.microsoft.com/l/message/test", postedAt: new Date(now).toISOString() };
  const callback = (secret, replacement = teams) => handlers.POST(new Request("https://pullsmith.example.test/api/teams-actions?action=register-message", {
    method: "POST", headers: { "content-type": "application/json", "x-formatted-list-secret": secret }, body: JSON.stringify({ jobId: job.id, teams: replacement }),
  }));
  assert.equal((await callback("wrong")).status, 404);
  assert.equal((await repo.getPullListJob(store, job.id, now)).teams, undefined);
  await repo.mutatePullListJobPrintStatus(store, job.id, "pricing", new Date(now).toISOString(), now);
  assert.equal((await callback(env.FORMATTED_LIST_WRITE_SECRET)).status, 200);
  assert.equal((await callback(env.FORMATTED_LIST_WRITE_SECRET)).status, 200);
  assert.deepEqual((await repo.getPullListJob(store, job.id, now)).teams, teams);
  assert.equal((await callback(env.FORMATTED_LIST_WRITE_SECRET, { ...teams, messageId: "replacement" })).status, 409);
  assert.equal(syncCalls.length, 2);
});
test("initial workflow claim allows only one Post Card attempt even when callback is lost", async () => {
  const { store, job } = await setup(false);
  const handlers = api.createTeamsActionHandlers({ getStore: () => store, env, now: () => now });
  const claim = (secret) => handlers.POST(new Request("https://pullsmith.example.test/api/teams-actions?action=claim-post", {
    method: "POST", headers: { "content-type": "application/json", "x-formatted-list-secret": secret }, body: JSON.stringify({ jobId: job.id }),
  }));
  assert.equal((await claim("wrong")).status, 404);
  const results = await Promise.all([claim(env.FORMATTED_LIST_WRITE_SECRET), claim(env.FORMATTED_LIST_WRITE_SECRET)]);
  const bodies = await Promise.all(results.map(r => r.json()));
  assert.equal(bodies.filter(b => b.shouldPost).length, 1);
  assert.equal((await (await claim(env.FORMATTED_LIST_WRITE_SECRET)).json()).shouldPost, false);
  assert.equal((await repo.getPullListJob(store, job.id, now)).teams.initialPostClaimedAt, new Date(now).toISOString());
});
test("full replacement rendering preserves complete original content and independent Chicago timestamps", async () => {
  const { job } = await setup();
  const initial = sync.renderJobTeamsCard(job, env);
  assert.match(JSON.stringify(initial), /Pull List: Not printed/); assert.match(JSON.stringify(initial), /Pricing: Not printed/);
  assert.ok(initial.body[1].text.includes(job.emailDisplay.body));
  assert.deepEqual(initial.actions.map(a => a.title), ["Open Formatted List", "Check Email Now", "Mark Pull List Printed", "Mark Pricing Printed"]);
  assert.ok(initial.actions.every(a => a.type === "Action.OpenUrl"));
  for (const button of initial.actions.slice(2)) {
    const url = new URL(button.url);
    assert.ok(tokens.verifyTeamsAction(url.searchParams.get("token"), env.TEAMS_ACTION_SIGNING_SECRET, job.id, url.searchParams.get("target"), now));
  }
  const updated = sync.renderJobTeamsCard({ ...job, printStatus: { pullListPrintedAt: "2026-09-07T05:41:00Z", pricingPrintedAt: "2026-09-07T06:08:00Z" } }, env);
  assert.equal(updated.body[1].text, initial.body[1].text);
  assert.match(updated.body[2].text, /Sep 7, 12:41 AM/); assert.match(updated.body[3].text, /Sep 7, 1:08 AM/);
  for (const secret of [env.TEAMS_ACTION_SIGNING_SECRET, env.FORMATTED_LIST_WRITE_SECRET, env.TEAMS_UPDATE_WORKFLOW_SECRET]) assert.ok(!JSON.stringify(updated).includes(secret));
});
test("in-place transport uses stored identity, stable retries, explicit ack and no root-message fallback", async () => {
  const { store, job } = await setup();
  await repo.mutatePullListJobPrintStatus(store, job.id, "pull-list", new Date(now).toISOString(), now);
  const requests = [];
  const fetcher = async (url, init) => {
    const payload = JSON.parse(init.body); requests.push({ url, init, payload });
    if (requests.length === 1) return new Response("failed", { status: 503 });
    return Response.json({ status: "updated", jobId: payload.jobId, messageId: payload.teams.messageId, idempotencyKey: payload.idempotencyKey });
  };
  const deps = { env, now: () => now, sleep: async () => {}, fetch: fetcher };
  assert.deepEqual(await sync.syncTeamsCard(store, job.id, deps), { status: "updated" });
  assert.equal(requests.length, 2);
  for (const { url, init, payload } of requests) {
    assert.equal(url, env.TEAMS_UPDATE_WORKFLOW_URL); assert.equal(payload.operation, "update-card"); assert.equal(payload.teams.messageId, "message");
    assert.equal(payload.teams.teamId, "team"); assert.equal(payload.teams.channelId, "channel"); assert.equal(payload.teams.conversationId, "conversation");
    assert.equal(init.headers["x-pullsmith-workflow-secret"], env.TEAMS_UPDATE_WORKFLOW_SECRET);
    assert.ok(payload.card.body[1].text.includes(job.emailDisplay.body)); assert.equal(payload.attachments, undefined);
  }
  assert.equal(requests[0].payload.idempotencyKey, requests[1].payload.idempotencyKey);
  await sync.syncTeamsCard(store, job.id, deps); assert.equal(requests.length, 2);
  await repo.mutatePullListJobPrintStatus(store, job.id, "pricing", new Date(now + 60000).toISOString(), now + 60000);
  await sync.syncTeamsCard(store, job.id, deps); assert.equal(requests.length, 3);
  assert.notEqual(requests[2].payload.idempotencyKey, requests[1].payload.idempotencyKey);
  assert.ok(requests[2].payload.card.body.slice(2).every(block => !block.text.includes("Not printed")));
});
test("missing transport/identity and three failed updates preserve status without posting fallback", async () => {
  const { store, job } = await setup();
  await repo.mutatePullListJobPrintStatus(store, job.id, "pricing", new Date(now).toISOString(), now);
  const before = await store.get(`pull-list-job:${job.id}`);
  let calls = 0;
  const fetcher = async () => { calls++; return new Response(null, { status: 202 }); };
  const deps = { env, now: () => now, sleep: async () => {}, fetch: fetcher };
  assert.equal((await sync.syncTeamsCard(store, job.id, { ...deps, env: { ...env, TEAMS_UPDATE_WORKFLOW_URL: "" } })).reason, "missing-update-configuration"); assert.equal(calls, 0);
  const result = await sync.syncTeamsCard(store, job.id, deps);
  assert.equal(result.status, "failed"); assert.equal(calls, 3); assert.deepEqual(await store.get(`pull-list-job:${job.id}`), before);
  const unposted = await setup(false);
  assert.equal((await sync.syncTeamsCard(unposted.store, unposted.job.id, deps)).reason, "missing-message-identity"); assert.equal(calls, 3);
});
test("a print between the final status read and lock release still updates the same card", async () => {
  const { store, job } = await setup();
  await repo.mutatePullListJobPrintStatus(store, job.id, "pull-list", new Date(now).toISOString(), now);
  const requests = [];
  const deps = { env, now: () => now, sleep: () => new Promise(resolve => setImmediate(resolve)), fetch: async (_url, init) => {
    const payload = JSON.parse(init.body); requests.push(payload);
    return Response.json({ status: "updated", jobId: job.id, messageId: "message", idempotencyKey: payload.idempotencyKey });
  } };
  const originalGet = store.get.bind(store);
  let reads = 0;
  let second;
  store.get = async (key) => {
    const value = await originalGet(key);
    if (key === `pull-list-job:${job.id}` && ++reads === 3) {
      await repo.mutatePullListJobPrintStatus(store, job.id, "pricing", new Date(now + 60000).toISOString(), now + 60000);
      second = sync.syncTeamsCard(store, job.id, deps);
    }
    return value;
  };
  assert.equal((await sync.syncTeamsCard(store, job.id, deps)).status, "updated");
  assert.equal((await second).status, "updated");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].card.body[3].text, "Pricing: Not printed");
  assert.ok(!requests[1].card.body[3].text.includes("Not printed"));
  assert.ok(requests.every(r => r.operation === "update-card" && r.teams.messageId === "message"));
});

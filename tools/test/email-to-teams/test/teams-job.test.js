import assert from "node:assert/strict";
import test from "node:test";
import { buildPullListTeamsCard } from "../../../../shared/pull-list-teams-card.mjs";
import { formatEmailForTeams, makeTeamsPayload } from "../src/format-email.js";
import { prepareEmailForTeams, postPreparedEmail } from "../src/email-job.js";
import { saveEmailPullListJob } from "../src/formatted-list-store.js";
import { formatterLinkForSavedJob, formatterLinkForSavedList } from "../src/share-link.js";
import { validateConfig } from "../src/config.js";

const summary = formatEmailForTeams({ from: { text: "Pat Example" }, subject: "MTG list", date: new Date("2026-09-07T05:41:00Z"), text: "2 Lightning Bolt" });
const config = { formatterBaseUrl: "https://pullsmith.example/", formattedListWriteSecret: "write-secret", checkEmailNowUrl: "https://pullsmith.example/api/check-email-now?secret=button%2Bkey" };

for (const checkEmailNowUrl of [config.checkEmailNowUrl, ""]) {
  test(`normal cards include exactly the configured Check Email Now action (${Boolean(checkEmailNowUrl)})`, () => {
    const payload = makeTeamsPayload({ ...summary, jobId: "pl_example", formatterUrl: "https://pullsmith.example/?job=pl_example", checkEmailNowUrl });
    const actions = payload.card.actions.filter((action) => action.title === "Check Email Now");
    assert.deepEqual(actions, checkEmailNowUrl ? [{ type: "Action.OpenUrl", title: "Check Email Now", url: checkEmailNowUrl }] : []);
    assert.equal(payload.card.version, "1.2");
    assert.equal(payload.operation, "post-card");
    assert.equal(payload.jobId, "pl_example");
    assert.equal(payload.idempotencyKey, "pull-list:pl_example:initial");
    assert.deepEqual(payload.attachments[0].content, payload.card);
    assert.ok(payload.card.body.some((block) => block.text === "Pull List: Not printed"));
    assert.ok(payload.card.body.some((block) => block.text === "Pricing: Not printed"));
  });
}

test("replacement card keeps full email and both independent Chicago print timestamps", () => {
  const body = "1 Lightning Bolt\n".repeat(1000);
  const card = buildPullListTeamsCard({ jobId: "pl_example", emailDisplay: { sender: "Pat", subject: "List", receivedAt: "2026-09-07T05:41:00Z", body },
    statusUrls: { "pull-list": "https://example.test/pull", pricing: "https://example.test/pricing" },
    printStatus: { pullListPrintedAt: "2026-09-07T05:41:00Z", pricingPrintedAt: "2026-09-07T06:08:00Z" } });
  assert.ok(card.body[1].text.endsWith(body));
  assert.equal(card.body[2].text, "Pull List: Printed Sep 7, 12:41 AM");
  assert.equal(card.body[3].text, "Pricing: Printed Sep 7, 1:08 AM");
  assert.deepEqual(card.actions.map(({ type, title }) => ({ type, title })), [
    { type: "Action.OpenUrl", title: "Mark Pull List Printed" }, { type: "Action.OpenUrl", title: "Mark Pricing Printed" },
  ]);
});

test("email preprocessing retains compact items and trusts server job card and canonical URL", async () => {
  const compact = [{ quantity: 2, inputName: "Lightning Bolt", requestedPrinting: { setCode: "2XM" } }];
  const card = buildPullListTeamsCard({ jobId: "pl_saved" });
  let captured;
  const formatted = await prepareEmailForTeams(summary, config, {
    processPullListText: async () => ({ items: [{ status: "found" }], customer: { name: "Pat" }, output: "formatted", processedAt: "2026-09-07T05:41:00Z" }),
    compactFormatterItems: () => compact,
    save: async (_config, data, emailDisplay) => { captured = { data, emailDisplay }; return { id: "pl_saved", url: "https://pullsmith.example/?job=pl_saved", card }; },
  });
  assert.deepEqual(captured.data.formatterItems, compact);
  assert.deepEqual(captured.data.formatterSettings, { useCheckboxes: true });
  assert.deepEqual(captured.emailDisplay, { sender: summary.from, subject: summary.subject, receivedAt: summary.receivedAt, body: summary.body });
  assert.equal(formatted.formatterUrl, "https://pullsmith.example/?job=pl_saved");
  assert.equal(makeTeamsPayload(formatted).card, card);
});

test("failed ingestion does not return a disconnected legacy or compressed-link fallback", async () => {
  await assert.rejects(prepareEmailForTeams(summary, config, {
    processPullListText: async () => ({ items: [] }), compactFormatterItems: () => [], save: async () => { throw new Error("unavailable"); },
  }), /unavailable/);
});

test("one mailbox run posts once per resolved job; revised jobs can post separately", async () => {
  const posted = [], ids = new Set();
  const post = async (payload) => { posted.push(payload); };
  const base = { ...summary, jobId: "pl_original" };
  assert.equal(await postPreparedEmail(base, ids, post), true);
  assert.equal(await postPreparedEmail(base, ids, post), false);
  assert.equal(await postPreparedEmail({ ...base, jobId: "pl_revised" }, ids, post), true);
  assert.equal(await postPreparedEmail({ ...base, jobId: "pl_registered", alreadyPosted: true }, ids, post), false);
  assert.deepEqual(posted.map((payload) => payload.jobId), ["pl_original", "pl_revised"]);
});

test("protected ingestion sends secret only in header and never accepts missing saved identity", async () => {
  let request;
  await saveEmailPullListJob(config, { input: "list" }, { body: "list" }, async (url, init) => {
    request = { url, ...init };
    return Response.json({ id: "pl_saved", url: "https://pullsmith.example/?job=pl_saved", card: {} });
  });
  assert.equal(request.url, "https://pullsmith.example/api/teams-actions?action=ingest");
  assert.equal(request.headers["x-formatted-list-secret"], "write-secret");
  assert.ok(!request.body.includes("write-secret"));
  assert.ok(!request.url.includes("write-secret"));
  await assert.rejects(saveEmailPullListJob(config, {}, {}, async () => Response.json({ id: "legacy", url: "https://example.test/?list=legacy" })), /complete saved job/);
});

test("new job link clears stale legacy parameters while legacy links remain supported", () => {
  assert.equal(formatterLinkForSavedJob("https://example.test/?list=old#input=stale", "pl_saved"), "https://example.test/?job=pl_saved");
  assert.equal(new URL(formatterLinkForSavedList("https://example.test", "old-list", "input")).searchParams.get("list"), "old-list");
});

test("missing Check Email URL warns without failing an otherwise configured email post", (t) => {
  const warnings = [];
  t.mock.method(console, "warn", (message) => warnings.push(message));
  validateConfig({ ...config, imap: { host: "imap.example.test", user: "mailbox", password: "password" }, teamsWebhookUrl: "https://workflow.example.test", checkEmailNowUrl: "", dryRun: false });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /CHECK_EMAIL_NOW_URL.*omit Check Email Now/);
  assert.ok(!warnings[0].includes("password"));
});

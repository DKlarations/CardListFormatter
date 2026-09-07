# Pullsmith email cards and shared print status

This guide describes the checked-in contract introduced in `071cc03`. During the [repository cleanup audit](REPOSITORY-CLEANUP-AUDIT.md), that Vercel deployment had failed the function limit and the canonical alias still served READY deployment `878647f`, whose email/diagnostic flow writes legacy formatted lists. The new main-branch runner expects the newer ingestion endpoint; resolve that deployment mismatch before running it against the older server. The external Teams Workflows are configuration outside this repository, and their actual wiring was not verified by the cleanup.

The checked-in path is GitHub Actions running `tools/test/email-to-teams` over IMAP, followed by Vercel job ingestion and an external Teams initial-post workflow. Microsoft Graph remains [read-only smoke tooling](MICROSOFT-GRAPH.md); it does not process pull lists or replace the IMAP runner.

In this contract, each new email resolves to one `PullListJob` before Teams receives a card. The card's **Open Formatted List** URL uses `?job=pl_<id>`. `printStatus.pullListPrintedAt` and `printStatus.pricingPrintedAt` are the sole status source. Printing records use of the corresponding Pullsmith print action, not physical printer confirmation.

The original Adaptive Card is the only root-channel representation of the list. **Status changes always use Update Card.** There is no root-post or thread-reply fallback in this implementation. An unavailable Teams update leaves the saved timestamps intact, records a safe diagnostic, and shows a warning in Pullsmith. This supersedes the older proposed “simple follow-up status card” behavior.

The narrow print mutation persists immediately while printing continues. If that request never reaches the server but autosave later saves a newer timestamp, the ordinary PUT also attempts Teams synchronization. Pricing-only saves skip Teams updates. Synchronization failures never turn a successful saved-list write into a failed save.

## A. Existing workflow and Check Email Now

`CHECK_EMAIL_NOW_URL` adds one `Action.OpenUrl` that dispatches the configured GitHub workflow. The workflow has both manual dispatch and a 15-minute schedule. Both normal cards and `/teams-test` use `shared/pull-list-teams-card.mjs`; an empty URL omits the button and logs a configuration warning without stopping the email post. GitHub errors are sanitized before returning HTML.

Use this exact shape, URL-encoding the placeholder secret value:

```text
https://<pullsmith-host>/api/check-email-now?secret=<CHECK_EMAIL_NOW_SECRET>
```

This deliberately retains the existing restricted Check Email capability URL. The URL must never contain a GitHub token, mailbox password, internal write secret, signing secret, or update-workflow secret. Keep capability links within the intended Teams channel. The status action URLs instead carry an HMAC signature scoped to one job, one print target, and an expiration.

Use the [canonical environment-variable inventory](ENVIRONMENT-VARIABLES.md) for required/optional names, consumers and GitHub/Vercel/local/Workflow placement. The initial webhook, internal write secret, signing key and independent update-workflow secret have different roles. The historical configuration listing in the [implementation report](archive/TEAMS-IMPLEMENTATION-REPORT.md) is not a current deployment/configuration check; the cleanup did not inspect values or change configuration.

With `MARK_PROCESSED_SEEN` enabled, as in GitHub Actions, the IMAP runner marks mail read after a successful HTTP response from the initial webhook, or after finding it already represented. HTTP acceptance alone does not establish that Post Card or message registration completed. The job claim/callback protocol below is required for durable original-message identity. A failed message aborts that run's remaining candidates; a later poll can retry eligible unread mail. The local processed-ID JSON file is not restored between GitHub runners, which cache only npm dependencies. See the [runner guide](../tools/test/email-to-teams/README.md) for these retry boundaries.

### Diagnostic protection and verification

`/teams-test` remains a setup/recovery diagnostic and uses the shared production renderer. Its `/api/send-test-teams` POST has **no incoming application authentication**, permits wildcard CORS, and uses the server write secret only for its outgoing ingestion call. The page explicitly targets the production API when opened on localhost or 127.0.0.1. Deployment-level access protection is unproven; do not describe this route or Saved Pull List APIs as staff-authenticated. Protect the diagnostic and customer-data APIs in a separate security task. Saved job responses can also contain the retained Check Email capability URL; details are in the [audit security findings](REPOSITORY-CLEANUP-AUDIT.md#security-findings-requiring-separate-work).

For a separately authorized operational check after deployment, protection and external Workflow configuration are verified:

1. Submit an unmistakably synthetic list through `/teams-test`. This is a real Teams post; perform only the planned test and inspect it before retrying.
2. Confirm one **Check Email Now** button and an **Open Formatted List** link with `?job=`.
3. Click Check Email Now once. Confirm the success page, then inspect GitHub Actions → **Email pull lists to Teams** for a new run with event `workflow_dispatch` and ref `main` (or configured overrides). Opening the link runs mailbox processing, so use the intended environment.
4. To test the optional status buttons, finish section B first, open one Mark Printed link, verify no change before confirmation, then confirm and inspect the saved timestamp and original card.

An unchanged simple webhook can still receive initial cards, but **does not meet the shared Teams status requirement** until section B is configured. Do not configure a new top-level “follow-up status card.”

## B. Required workflow branches and original-message updates

These are the mappings for this repository's request contract. Teams connector fields are dynamic; select the corresponding dynamic field or expression in your designer. Microsoft documents the **Post card in a chat or channel** and **Update an adaptive card in a chat or channel** actions, and post response properties `id`, `messageLink`, and `conversationId`. [Microsoft Teams connector reference](https://learn.microsoft.com/en-us/connectors/teams/).

### Trigger and parsing

1. Open the existing workflow in Teams Workflows / Power Automate. Keep its existing Teams connection and record its **Post as**, Team, and Channel values. Add a co-owner as described below.
2. Create a **separate update workflow** using Power Automate's generic **When an HTTP request is received** trigger with the custom JSON schema below and a synchronous **Response** action. Retain the initial Teams trigger. The native Teams webhook trigger expects a message envelope; the update request deliberately has no `type`/`attachments`. Do not point the update URL at an unmodified Teams webhook template. Separate workflows also prevent a registration callback from waiting on an update queued behind its own initial-post run. HTTP capabilities/licensing must be available in your tenant. These are setup instructions; the cleanup did not change or verify the live workflow.
3. Parse `operation`, `jobId`, `idempotencyKey`, `card`, and optional `teams`, `statusRevision`, `updatedAt`. Use an object schema for `card`, not a string. Existing `type`/`attachments` remain in initial envelopes for compatibility; use `card` in the configured branches.
4. Route by `operation`: the initial workflow accepts exactly `post-card`; the separate update workflow accepts exactly `update-card`. Reject everything else. The update branch validates `triggerOutputs()?['headers']?['x-pullsmith-workflow-secret']` against the protected configured value before proceeding. Keep the initial webhook trigger URL secret, as in the existing workflow.
5. Enable trigger concurrency control with degree **1** for the updating workflow. This serializes retries and prevents an older queued execution from overwriting a newer one. All updates must use this same serialized update workflow.
6. Enable Secure Inputs/Outputs on actions carrying secrets/capability links; never paste real secrets into sample JSON, Compose output, or diagnostics. Store internal secrets in the workflow's secure configuration, not card JSON.

Sanitized initial request (actual `card` includes the full cleaned email and actions):

```json
{
  "operation": "post-card",
  "jobId": "pl_00000000-0000-4000-8000-000000000001",
  "idempotencyKey": "pull-list:pl_00000000-0000-4000-8000-000000000001:initial",
  "card": {
    "type": "AdaptiveCard",
    "version": "1.2",
    "body": [{"type":"TextBlock","text":"Synthetic test list","wrap":true}],
    "actions": []
  }
}
```

### Initial-post branch

1. Add HTTP **POST** to `https://<pullsmith-host>/api/teams-actions?action=claim-post`. Set `Content-Type: application/json` and `x-formatted-list-secret: <internal-write-secret>`. Body: `{"jobId":"<trigger jobId>"}`. Map the value with `triggerBody()?['jobId']`.
2. Continue to Post Card **only** when the response has `shouldPost: true`. False means an original message exists or an earlier post attempt was already claimed. Stop successfully without posting. This claim is stored with the job and is preserved across autosave and TTL refresh.
3. Add **Post card in a chat or channel**. Keep the existing **Post as**, Team, Channel, and Teams connection. Map the Adaptive Card body to `triggerBody()?['card']`. Set this Post action's retry policy to **None**: an ambiguous posting failure must not issue another root post.
4. Name the Post action `Post_original_card` for the expressions below. After success, read its Message ID, Message link, and Conversation ID. Add HTTP **POST** to `https://<pullsmith-host>/api/teams-actions?action=register-message` with the same internal-secret header.
5. Send the callback below. Use `body('Post_original_card')?['id']`, `body('Post_original_card')?['messageLink']`, and `body('Post_original_card')?['conversationId']`. Team and Channel are the same configured IDs used to post; `postedAt` is `utcNow()`. Omit unavailable optional fields instead of sending null/empty strings. Message ID, Team ID, and Channel ID are required.
6. Retry a failed **callback**, using the same identifiers. A repeat is idempotent. A conflicting original message ID is rejected with 409. If posting succeeded but the callback never did, use the Post action's run output to register the original message manually; do not repost the list.

```json
{
  "jobId": "pl_00000000-0000-4000-8000-000000000001",
  "teams": {
    "teamId": "<same-team-id>",
    "channelId": "<same-channel-id>",
    "conversationId": "<Post_original_card body conversationId>",
    "messageId": "<Post_original_card body id>",
    "messageLink": "https://teams.microsoft.com/l/message/<original-message>",
    "postedAt": "2026-09-07T05:41:00.000Z"
  }
}
```

The callback returns `registered: true`, the same job ID, stored Teams identity, and a synchronization result. If someone printed before message registration completed, registration attempts an update immediately. Registration does not create a job or a post.

If the Post action definitely failed before creating anything, the job retains its claim and will not blindly repost. Investigate the workflow run before any intentional administrative recovery. There is deliberately no public “clear post claim” endpoint.

### Status-update branch

1. Validate the update header secret and operation before doing anything. This branch must contain **no Post Card or Post Message action**, including error-handling branches.
2. Add HTTP **GET** to `https://<pullsmith-host>/api/teams-actions?action=card&id=<trigger-jobId>`, with `x-formatted-list-secret`. Name it `Load_current_card`. It reads the current complete job and renders its full replacement card without mutating status. Fetching current state inside the serialized workflow prevents a delayed retry from installing stale timestamps.
3. Verify `body('Load_current_card')?['jobId']` equals `triggerBody()?['jobId']` and its `teams.messageId` matches the incoming stored identity. Reject missing or mismatched identity. Do not replace it with a channel's latest message ID.
4. Add **Update an adaptive card in a chat or channel**, named `Update_original_card`. Use the **same Post as and connection** as the initial post. Team = `body('Load_current_card')?['teams']?['teamId']`; Channel = `body('Load_current_card')?['teams']?['channelId']`; Message ID = `body('Load_current_card')?['teams']?['messageId']`; Adaptive Card body = `body('Load_current_card')?['card']`. Conversation ID is provided for compatible chat mappings; the implemented setup targets the original channel message.
5. Set Update action retry policy to **None**; Pullsmith performs up to three bounded attempts, each loading fresh job state, with an eight-second HTTP timeout and short backoff. A concurrent server request waits up to thirty seconds for the current update before trying. This prevents unbounded retry storms.
6. Add a synchronous HTTP **Response** on Update success, status 200 and `Content-Type: application/json`, with the body below. Echo the **incoming** idempotency key so Pullsmith can verify this attempt; the card applied may include newer status from `Load_current_card`, which is safe. Configure a failure/timeout Response with status 502 and a generic error, using Run after on the failed Update scope. Keep the response fast enough for the caller's timeout; 202 alone is treated as unconfirmed.
7. Save the workflow and set `TEAMS_UPDATE_WORKFLOW_URL` plus `TEAMS_UPDATE_WORKFLOW_SECRET` in Vercel. Configure the signing secret and canonical formatter URL there as well. Deploy the repository changes only when authorized.
8. Test one synthetic initial card. Print Pull List from Pullsmith: verify the same message changes to the Chicago timestamp. Then Print Pricing: verify both statuses coexist on that same message. Reopen/reload `?job=` and verify the printer and dollar icons. Reconfirm a signed action: the same original card remains the only root message.

Sanitized update request:

```json
{
  "operation": "update-card",
  "jobId": "pl_00000000-0000-4000-8000-000000000001",
  "teams": {
    "teamId": "<same-team-id>",
    "channelId": "<same-channel-id>",
    "conversationId": "<original-conversation-id>",
    "messageId": "<original-message-id>"
  },
  "card": {"type":"AdaptiveCard","version":"1.2","body":[],"actions":[]},
  "idempotencyKey": "update:<job-id>:<sha256-revision>",
  "statusRevision": "<sha256-revision>",
  "updatedAt": "2026-09-07T06:08:00.000Z"
}
```

Success response (map trigger values, not these placeholders):

```json
{
  "status": "updated",
  "jobId": "<trigger jobId>",
  "messageId": "<trigger teams.messageId>",
  "idempotencyKey": "<trigger idempotencyKey>"
}
```

Pullsmith records a revision acknowledgement in Redis and skips already acknowledged replacements. Retries use the same message ID and stable revision key. There are **zero fallback notification posts or replies** to duplicate. Reprinting generates a newer timestamp and replaces the same original card again.

### Ownership and troubleshooting

In Teams, open the channel's **More options → Workflows → Your workflows**, open the workflow details, then add a colleague in **Owners**. Confirm the co-owner can maintain the workflow and its Teams connection. [Microsoft workflow ownership instructions](https://support.microsoft.com/en-US/Workflows/use-workflows-from-chats-or-channels-in-teams).

| Symptom | Inspect / fix |
| --- | --- |
| Check Email missing only in `/teams-test` or replacement cards | Add Vercel `CHECK_EMAIL_NOW_URL`, redeploy, and verify its secret matches `CHECK_EMAIL_NOW_SECRET`. GitHub and Vercel configuration are independent. |
| Check Email opens an unavailable page | Verify the restricted secret and configured URL. Do not put `GITHUB_WORKFLOW_TOKEN` into the URL. |
| Dispatch fails | Check token scope, repository/workflow/ref and Actions enablement. Returned HTML deliberately omits raw GitHub errors. |
| `missing-message-identity` | Inspect initial Post output, callback authentication/result, Team/Channel mapping. Register the existing card; never repost. |
| `initial-post-already-claimed` without message identity | Inspect the original workflow run. Recover its Post output and retry registration. An ambiguous Post result remains held to prevent duplicates. |
| Card posts but cannot update | Check same identity/connection, Team/Channel, original Message ID, and Update action. A successful webhook HTTP response alone does not prove the action completed. |
| `missing-update-configuration` | Add both update-workflow variables in the correct Vercel environment and deploy. |
| `separate-update-workflow-required` | Give the update workflow its own HTTP trigger URL. A registration callback can need an immediate update before the initial workflow run finishes. |
| `update-not-confirmed` | Check header validation, action runtime, explicit acknowledgement shape, and run history. The saved status remains valid. Retry the same confirmation after fixing configuration. |
| Large card fails | The complete cleaned original email is preserved. Teams has an approximately 28 KB message limit including markup; oversized cards may be rejected. The code does not silently shorten the original list. [Connector limits](https://learn.microsoft.com/en-us/connectors/teams/). |
| Optional signed action unavailable | Signing key absent/rotated, expired link, or expired/deleted job. Use Pullsmith's print action; signatures cannot be reused for another job or target. |

Legacy `/api/formatted-lists` and `?list=` URLs retain their existing behavior, including the protected writer. The observed older production deployment still generates them. Retain this compatibility until all writers are retired, the last possible record has expired, and remaining consumers are checked; the [audit sunset gates](REPOSITORY-CLEANUP-AUDIT.md#compatibility-sunset-gates) define the evidence required. No historical records are migrated, deleted, or retroactively associated with Teams messages by this cleanup.

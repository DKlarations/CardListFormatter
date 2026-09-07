# Pullsmith email cards and shared print status

Each new email resolves to one `PullListJob` before Teams receives a card. The card's **Open Formatted List** URL uses `?job=pl_<id>`. `printStatus.pullListPrintedAt` and `printStatus.pricingPrintedAt` are the sole status source. Printing records use of the corresponding Pullsmith print action, not physical printer confirmation.

The original Adaptive Card is the only root-channel representation of the list. **Status changes always use Update Card.** There is no root-post or thread-reply fallback in this implementation. An unavailable Teams update leaves the saved timestamps intact, records a safe diagnostic, and shows a warning in Pullsmith. This supersedes the older proposed “simple follow-up status card” behavior.

The narrow print mutation persists immediately while printing continues. If that request never reaches the server but autosave later saves a newer timestamp, the ordinary PUT also attempts Teams synchronization. Pricing-only saves skip Teams updates. Synchronization failures never turn a successful saved-list write into a failed save.

## A. Existing workflow and Check Email Now

The existing code already read `CHECK_EMAIL_NOW_URL`, added one `Action.OpenUrl`, and dispatched the configured GitHub workflow. Both normal cards and `/teams-test` now use the same card renderer. An empty URL omits the button and logs a configuration warning without stopping the email post. GitHub errors are sanitized before returning HTML.

Use this exact shape, URL-encoding the placeholder secret value:

```text
https://<pullsmith-host>/api/check-email-now?secret=<CHECK_EMAIL_NOW_SECRET>
```

This deliberately retains the existing restricted Check Email capability URL. The URL must never contain a GitHub token, mailbox password, internal write secret, signing secret, or update-workflow secret. Keep capability links within the intended Teams channel. The status action URLs instead carry an HMAC signature scoped to one job, one print target, and an expiration.

Configure these before testing:

| Variable | Where | Purpose / default |
| --- | --- | --- |
| `IMAP_HOST`, `IMAP_PORT`, `IMAP_SECURE`, `IMAP_USER`, `IMAP_PASSWORD` | GitHub repository secrets | Existing mailbox connection. Port defaults to 993; secure defaults to true. |
| `IMAP_MAILBOX` | GitHub repository variable | Existing mailbox; workflow defaults to `INBOX`. |
| `MAX_EMAIL_AGE_DAYS` | GitHub repository variable | Existing lookback; workflow defaults to 7. |
| `TEAMS_WEBHOOK_URL` | GitHub secret and Vercel | Initial-post workflow trigger URL; Vercel uses it for `/teams-test`. Never use it as an automatic status fallback. |
| `FORMATTED_LIST_WRITE_SECRET` | GitHub secret, Vercel, secure workflow configuration | Same value for ingestion, initial-post claim, message registration, and workflow card refresh. Sent only in `x-formatted-list-secret` request headers. |
| `CHECK_EMAIL_NOW_URL` | GitHub secret **and Vercel** | Normal cards use GitHub's value; `/teams-test` uses Vercel's value. Replacements use Vercel's value or preserve the original protected URL stored at ingestion. Set the same URL in both places. |
| `CHECK_EMAIL_NOW_SECRET` | Vercel | Existing restricted dispatch secret used by the URL above. |
| `GITHUB_WORKFLOW_TOKEN` | Vercel only | Token authorized to dispatch Actions in the target repository; fine-grained token requires repository Actions write access. |
| `GITHUB_WORKFLOW_REPOSITORY` | Vercel, optional | Defaults to `DKlarations/CardListFormatter`. |
| `GITHUB_WORKFLOW_ID` | Vercel, optional | Defaults to `email-to-teams.yml`. |
| `GITHUB_WORKFLOW_REF` | Vercel, optional | Defaults to `main`. |
| `FORMATTER_BASE_URL` | Vercel; GitHub repository variable; email tool config | Canonical deployed Pullsmith URL. Set explicitly per environment. GitHub defaults to `https://card-list-formatter.vercel.app/` and accepts its repository variable override. |
| `PULLSMITH_KV_REST_API_URL`, `PULLSMITH_KV_REST_API_TOKEN` | Vercel | Existing writable Redis REST pair. Existing complete-pair Upstash and legacy fallbacks remain supported. A read-only token cannot perform mutations. |
| `TEAMS_ACTION_SIGNING_SECRET` | Vercel only | New high-entropy HMAC key, at least 32 random bytes recommended. Never give it to GitHub, Teams, or browser code. Missing key omits optional Mark Printed buttons. |
| `TEAMS_UPDATE_WORKFLOW_URL` | Vercel only | New HTTPS trigger for a separate `update-card` workflow with an explicit completion response. Must differ from the initial-post trigger. |
| `TEAMS_UPDATE_WORKFLOW_SECRET` | Vercel and secure workflow configuration | New independent header secret; workflow must validate `x-pullsmith-workflow-secret` before any update. |

The email tool also retains local `.env` controls `SUBJECT_FILTER`, `DRY_RUN`, `MARK_PROCESSED_SEEN`, `POLL_INTERVAL_SECONDS`, and `PROCESSED_STORE`; the GitHub workflow sets the first three explicitly. No Graph, bot, or new browser authentication is required by this feature.

Read-only configuration audit on September 7, 2026: GitHub had `CHECK_EMAIL_NOW_URL`, `FORMATTED_LIST_WRITE_SECRET`, the IMAP connection secrets, and `TEAMS_WEBHOOK_URL`. Vercel Production had `CHECK_EMAIL_NOW_SECRET` and `GITHUB_WORKFLOW_TOKEN`, but lacked `CHECK_EMAIL_NOW_URL`, `FORMATTER_BASE_URL`, `TEAMS_ACTION_SIGNING_SECRET`, `TEAMS_UPDATE_WORKFLOW_URL`, and `TEAMS_UPDATE_WORKFLOW_SECRET`. Values were not compared or changed. A listed secret's presence does not prove validity.

After the code is deployed and configuration is saved:

1. Submit an unmistakably synthetic list through `/teams-test`. This is a real Teams post; perform only the planned test and inspect it before retrying.
2. Confirm one **Check Email Now** button and an **Open Formatted List** link with `?job=`.
3. Click Check Email Now once. Confirm the success page, then inspect GitHub Actions → **Email pull lists to Teams** for a new run with event `workflow_dispatch` and ref `main` (or configured overrides). Opening the link runs mailbox processing, so use the intended environment.
4. To test the optional status buttons, finish section B first, open one Mark Printed link, verify no change before confirmation, then confirm and inspect the saved timestamp and original card.

An unchanged simple webhook can still receive initial cards, but **does not meet the shared Teams status requirement** until section B is configured. Do not configure a new top-level “follow-up status card.”

## B. Required workflow branches and original-message updates

These are the mappings for this repository's request contract. Teams connector fields are dynamic; select the corresponding dynamic field or expression in your designer. Microsoft documents the **Post card in a chat or channel** and **Update an adaptive card in a chat or channel** actions, and post response properties `id`, `messageLink`, and `conversationId`. [Microsoft Teams connector reference](https://learn.microsoft.com/en-us/connectors/teams/).

### Trigger and parsing

1. Open the existing workflow in Teams Workflows / Power Automate. Keep its existing Teams connection and record its **Post as**, Team, and Channel values. Add a co-owner as described below.
2. Create a **separate update workflow** using Power Automate's generic **When an HTTP request is received** trigger with the custom JSON schema below and a synchronous **Response** action. Retain the initial Teams trigger. The native Teams webhook trigger expects a message envelope; the update request deliberately has no `type`/`attachments`. Do not point the update URL at an unmodified Teams webhook template. Separate workflows also prevent a registration callback from waiting on an update queued behind its own initial-post run. HTTP capabilities/licensing must be available in your tenant. No changes to the live workflow were made by this repository task.
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

Legacy `/api/formatted-lists` and `?list=` URLs remain readable with their existing behavior. No historical records are migrated, deleted, or retroactively associated with Teams messages by this task.

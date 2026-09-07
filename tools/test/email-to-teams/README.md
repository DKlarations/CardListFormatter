# Email to Teams Test

Local prototype for watching a mailbox, extracting likely pull-list text, and posting it to a Teams channel.

This IMAP/GitHub Actions workflow is legacy test infrastructure. A future production inbound-mail path is expected to use Microsoft Graph with `Service@RedRaccoonGames.com`; Teams posting remains a separate transport concern. No Graph or Teams migration is implemented here.

This is intentionally separate from the browser app while the workflow is experimental. It imports the shared formatter from `src/formatter.ts` so Teams posts can match the browser app's formatted output.

## Setup

1. Copy `.env.example` to `.env`.
2. Fill in IMAP settings for the mailbox.
3. Add the Teams Workflow trigger URL and shared `FORMATTED_LIST_WRITE_SECRET`.
4. Install dependencies from this folder:

```powershell
npm install
```

## Commands

Run one dry pass without posting to Teams:

```powershell
npm run dry-run
```

Run one pass using `.env`:

```powershell
npm run once
```

Keep polling:

```powershell
npm run watch
```

## GitHub Actions Test

The repo includes a manual workflow at `.github/workflows/email-to-teams.yml`.

Add these GitHub repository secrets:

```text
IMAP_HOST
IMAP_PORT
IMAP_SECURE
IMAP_USER
IMAP_PASSWORD
TEAMS_WEBHOOK_URL
CHECK_EMAIL_NOW_URL
FORMATTED_LIST_WRITE_SECRET
```

Optional GitHub repository variables:

```text
IMAP_MAILBOX=INBOX
```

Then run the workflow manually from GitHub Actions:

```text
Actions -> Email pull lists to Teams -> Run workflow
```

Running the workflow manually checks the mailbox and posts matching unread pull lists to Teams.

The GitHub workflow uses `MARK_PROCESSED_SEEN=true`, so successfully posted or already represented emails are marked read. Runs are serialized. The resolved job ID prevents duplicate cards within one run; registered original-message metadata also prevents reposting an existing job. The Workflow must honor the initial-post idempotency key, as described in [the Teams setup guide](../../../docs/TEAMS-WORKFLOW.md).

The scheduled workflow polls every 15 minutes.

## Check Email Now Button

The Teams card can include a `Check Email Now` button. The button opens a Vercel endpoint that triggers this GitHub Action immediately.

Add these Vercel environment variables:

```text
CHECK_EMAIL_NOW_SECRET
CHECK_EMAIL_NOW_URL
GITHUB_WORKFLOW_TOKEN
FORMATTED_LIST_WRITE_SECRET
TEAMS_WEBHOOK_URL
UPSTASH_REDIS_REST_URL
UPSTASH_REDIS_REST_TOKEN
TEAMS_ACTION_SIGNING_SECRET
TEAMS_UPDATE_WORKFLOW_URL
TEAMS_UPDATE_WORKFLOW_SECRET
```

If Vercel created prefixed names for the Redis store, these are also supported:

```text
lists_REDIS_URL
lists_KV_REST_API_TOKEN
```

Optional Vercel environment variables:

```text
GITHUB_WORKFLOW_REPOSITORY=DKlarations/CardListFormatter
GITHUB_WORKFLOW_ID=email-to-teams.yml
GITHUB_WORKFLOW_REF=main
```

Create `CHECK_EMAIL_NOW_URL` as a GitHub repository secret with this shape:

```text
https://card-list-formatter.vercel.app/api/check-email-now?secret=YOUR_CHECK_EMAIL_NOW_SECRET
```

`GITHUB_WORKFLOW_TOKEN` should be a GitHub token that can trigger Actions workflow dispatches for this repository. Keep it only in Vercel environment variables, not in GitHub Actions or Teams card URLs.

Set the same `CHECK_EMAIL_NOW_URL` in Vercel so `/teams-test` and replacement cards retain the button. If absent, the tool and test endpoint warn and still post a card without it. Full Workflow callback, update, and signing configuration is documented in [the Teams setup guide](../../../docs/TEAMS-WORKFLOW.md).

## Notes

- The local `npm run dry-run` formats matching mail and reports the action count without saving jobs, posting cards, or logging action URLs.
- `MARK_PROCESSED_SEEN=true` marks an email read after a successful Teams post.
- `FORMATTER_BASE_URL=https://card-list-formatter.vercel.app/` controls the Teams button link target.
- `CHECK_EMAIL_NOW_URL` controls the optional Teams button for manually triggering the email check workflow.
- `/teams-test` opens a temporary public manual Teams test page. It uses `FORMATTED_LIST_WRITE_SECRET` and `TEAMS_WEBHOOK_URL` on the server.
- Processed email IDs are stored in `data/processed-messages.json`.
- The GitHub workflow currently leaves `SUBJECT_FILTER` blank, so it uses pull-list content heuristics without requiring specific subject text.
- Teams cards include an `Open Formatted List` button that opens a real Saved Pull List via `?job=pl_...`. The protected `/api/teams-actions?action=ingest` request stores compact formatter items, customer, settings, original input/output, and the original cleaned email before posting.
- The job begins with empty pricing and print status. Updates refresh its normal 30-day TTL. Existing `/api/formatted-lists` records and `?list=` links remain readable; this tool no longer creates legacy records or disconnected fallback links if ingestion fails.
- Each initial Workflow request includes `operation: "post-card"`, `jobId`, a stable `idempotencyKey`, and `card` (also repeated in the legacy-compatible `attachments` envelope). Configure a single Post Card action and register its message identity before acknowledging success. Do not post once from each representation.
- Subsequent printing updates replace the original card through the protected update Workflow. A failed update leaves the saved status intact and never creates another root-channel post.
- The Teams post keeps the original cleaned email content; the formatter work happens before posting so the button opens the finished list without waiting while the saved result exists.
- For Gmail/Outlook, use an app password or OAuth-compatible mailbox setup. Do not put real credentials in git.
- Print status records that an employee used the corresponding print action; it does not confirm physical paper output.

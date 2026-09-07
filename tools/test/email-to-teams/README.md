# Email to Teams mailbox runner

This is the IMAP runner executed by `.github/workflows/email-to-teams.yml`, with manual dispatch and a 15-minute schedule. The historical `tools/test` directory and package name do not make it test-only. It reads unread mail, filters likely pull lists, and imports the shared formatter from `src/formatter.ts`.

At checked-in commit `071cc03`, the runner creates or reuses a `PullListJob` through protected Vercel ingestion before sending the shared card to an external Teams Workflow. Microsoft Graph is separate [read-only smoke tooling](../../../docs/MICROSOFT-GRAPH.md); it has no connected mailbox-processing replacement.

The [cleanup audit](../../../docs/REPOSITORY-CLEANUP-AUDIT.md) found the canonical Vercel alias still serving `878647f` after the newer deployment failed the function limit. That older server/runner contract writes legacy formatted lists. Resolve the deployment mismatch before running the new runner against that server. Historical successful GitHub runs do not prove a successful run of the new contract or healthy current polling. No external Graph flow or Teams Workflow configuration was verified in the cleanup.

## Setup

1. Copy `.env.example` to `.env`.
2. Configure the intended mailbox and transport using the [canonical environment-variable inventory](../../../docs/ENVIRONMENT-VARIABLES.md). It identifies required and optional local, GitHub, Vercel and Microsoft Workflow settings; `.env.example` is the local template.
3. Verify the matching Vercel deployment and external [Teams Workflow contract](../../../docs/TEAMS-WORKFLOW.md) before a live run.
4. Install dependencies from this folder:

```powershell
npm ci
```

## Commands

Run one dry pass. It reads the configured mailbox and formats matching text, but does not save jobs, post cards, mark messages read or save processed IDs:

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

## GitHub Actions

The workflow installs this folder independently with Node 22 and `npm ci`, then runs `npm run once`. Configure the GitHub secrets/variables and matching server settings listed in the [inventory](../../../docs/ENVIRONMENT-VARIABLES.md). To run it manually in the intended environment:

```text
Actions -> Email pull lists to Teams -> Run workflow
```

Running the workflow manually checks the mailbox and posts matching unread pull lists to Teams.

Runs are serialized. The resolved job ID prevents duplicate cards within one run; registered original-message metadata prevents reposting an existing job. The external Workflow must use the protected initial-post claim and message-registration callbacks described in [the Teams setup guide](../../../docs/TEAMS-WORKFLOW.md). A payload idempotency key alone does not prove the Workflow enforces that protocol.

The scheduled workflow polls every 15 minutes.

## Check Email Now Button

The Teams card can include a `Check Email Now` button. Its capability URL opens `/api/check-email-now`, which validates the restricted secret and dispatches this GitHub Action. It does not call Graph. Configuration names and override behavior are in the [inventory](../../../docs/ENVIRONMENT-VARIABLES.md); the URL shape is:

```text
https://<pullsmith-host>/api/check-email-now?secret=<CHECK_EMAIL_NOW_SECRET>
```

Keep the GitHub dispatch token only in Vercel configuration, never in the URL. Opening a valid capability URL starts mailbox processing; a successful dispatch response is not proof that processing completed.

Set the same `CHECK_EMAIL_NOW_URL` in Vercel so `/teams-test` and replacement cards retain the button. If absent, the tool and test endpoint warn and still post a card without it. Full Workflow callback, update, and signing configuration is documented in [the Teams setup guide](../../../docs/TEAMS-WORKFLOW.md).

## Processing and retry boundaries

The workflow enables `MARK_PROCESSED_SEEN`. The runner marks mail read after the initial webhook returns a successful HTTP status, or after the job is already represented. That response does not by itself prove Post Card or message registration completed. Inspect the external Workflow result and original-message identity when delivery is uncertain; retry registration for an existing card instead of reposting it.

A failed message aborts the remaining candidates in that run. Previously completed IDs are saved locally in `data/processed-messages.json`; eligible unread mail can be retried on a later poll. GitHub runners cache npm dependencies only and do not restore that JSON file, so durable cross-run protection relies on mailbox read flags and server fingerprint/message/claim state. A claimed post with an ambiguous or failed result remains claimed and needs the recovery procedure in the Teams guide.

## Manual Teams diagnostic

`/teams-test` supports store setup and verification through `/api/send-test-teams`. It uses the same shared renderer and server ingestion as this runner. The API has no incoming application authentication and allows wildcard CORS; its server write secret authenticates the outgoing ingest request, not the person calling the diagnostic. Deployment-level protection is unverified. Protect this diagnostic and Saved Pull List APIs in a separate security task.

Opening `/teams-test` on localhost or 127.0.0.1 explicitly targets the production API. Sending creates real saved data and a Teams post when configured; a local Vite page is not an isolated test environment. Use only a separately authorized synthetic operational check after the deployment and protection issues are resolved. The cleanup did not send test posts or read live mail.

## Notes

- The local `npm run dry-run` formats matching mail and reports the action count without saving jobs, posting cards, or logging action URLs.
- The GitHub workflow currently leaves `SUBJECT_FILTER` blank, so it uses pull-list content heuristics without requiring specific subject text.
- Teams cards include an `Open Formatted List` button that opens a real Saved Pull List via `?job=pl_...`. The protected `/api/teams-actions?action=ingest` request stores compact formatter items, customer, settings, original input/output, and the original cleaned email before posting.
- The job begins with empty pricing and print status. Updates refresh its normal 30-day TTL. This checked-in runner no longer creates legacy records or disconnected fallback links if ingestion fails. Existing `/api/formatted-lists` records, its protected writer and `?list=` links remain supported; the observed older production deployment still writes them. Follow the [compatibility sunset gates](../../../docs/REPOSITORY-CLEANUP-AUDIT.md#compatibility-sunset-gates) before retirement.
- Each initial Workflow request includes `operation: "post-card"`, `jobId`, a stable `idempotencyKey`, and `card` (also repeated in the legacy-compatible `attachments` envelope). Configure a single Post Card action and register its message identity before acknowledging success. Do not post once from each representation.
- Subsequent printing updates replace the original card through the protected update Workflow. A failed update leaves the saved status intact and never creates another root-channel post.
- The Teams post keeps the original cleaned email content; the formatter work happens before posting so the button opens the finished list without waiting while the saved result exists.
- The current IMAP client supplies username/password authentication from configuration. Graph client credentials do not configure this runner. Do not put real credentials in git.
- Print status records that an employee used the corresponding print action; it does not confirm physical paper output.

# Email jobs and original Teams card status — implementation report

> **Historical implementation-session report.** The implementation below subsequently entered `main` in commit `071cc03`. Repository cleanup verification on September 7, 2026 found that its Vercel deployment failed because it exceeded the Hobby plan's 12-function limit; the canonical production alias still served commit `878647f`. The session's local checks and configuration observations below describe that earlier implementation session, not current deployment proof. Current architecture and release findings are recorded in [the repository cleanup audit](../REPOSITORY-CLEANUP-AUDIT.md), and current operational instructions are in [the Teams workflow guide](../TEAMS-WORKFLOW.md).

**Status as of the original implementation session, before commit `071cc03`:** September 7, 2026. Implemented and validated locally. Not yet committed, pushed, deployed, or tested against live Teams. Existing Microsoft Graph work was preserved.

## Check Email Now audit

The GitHub workflow already supplied `CHECK_EMAIL_NOW_URL`; the tool already read it and conditionally emitted an `Action.OpenUrl`; `/teams-test` had equivalent conditional behavior; the dispatch endpoint already used repository `DKlarations/CardListFormatter`, workflow `email-to-teams.yml`, and ref `main`, with environment overrides.

The visible `/teams-test` absence is a **configuration gap**: a read-only listing confirmed GitHub has `CHECK_EMAIL_NOW_URL`, while Vercel Production lacks it. The normal GitHub path is already configured; secret values and live dispatch were not tested. The code needed hardening and regression coverage: missing-URL warnings, one shared card builder, and sanitized GitHub/transport errors. No button is duplicated and configured URLs are preserved exactly. Replacement cards preserve the original restricted Check Email URL when Vercel has no override.

## Architecture and preservation

- Protected ingestion: `POST /api/teams-actions?action=ingest`, authenticated by the existing `x-formatted-list-secret` / `FORMATTED_LIST_WRITE_SECRET` convention. It builds a complete email draft with customer, original input, output, compact items, empty normalized pricing/status, processed time, statistics, settings, and original cleaned email display content.
- Job identity: atomic creation resolves matching fingerprints to the existing job. The email tool posts once per resolved job per mailbox run. Changed card lists remain distinct jobs. When an existing manual job is reused, the first trusted email association preserves its pricing/content/status and attaches the email origin and display data. Already registered Teams cards are not reposted.
- Legacy compatibility: `api/formatted-lists.ts` is unchanged. Existing `?list=` loading and helper exports remain supported. No old record was migrated or deleted.
- Metadata: ordinary browser POST cannot invent email origin or Teams identity. Ordinary PUT preserves stored `source`, `teams`, and `emailDisplay`; it cannot erase or forge them by omission or replacement. Teams metadata includes Team, Channel, Conversation, Message ID/link, posting time, and a durable initial-post claim. The callback uses the internal header secret and rejects conflicting message identity.
- Print persistence: `POST /api/pull-list-jobs?action=print-status` accepts only a validated job ID, target (`pull-list` or `pricing`), and valid normalized timestamp. Redis compare-and-set writes atomically preserve all unrelated fields, fingerprint, index membership, original email, exact formatter items, and pricing. Both statuses are monotonic under stale/repeated requests. Normal job/fingerprint/index TTL behavior is retained at 30 days from updates. Missing jobs return 404.
- Browser printing: local timestamps/icons update immediately, and network synchronization does not block the print window. A saved-job status response is never loaded over current pricing work. Warnings are dismissible and scoped to the current job/target. Autosave also attempts synchronization when it saves a newer print timestamp, covering recovery if the narrow request never reached the server; pricing-only autosaves skip Teams.
- Signed actions: HMAC-SHA256 tokens bind version, job, target, and expiration, with constant-time signature comparison. Valid GET requests only show confirmation. Native POST confirmation records one server timestamp per token; replay is safe. Pages escape content, use a restrictive CSP, and use `strict-origin` referrers so signed query strings do not leak while native form Origin remains valid. No arbitrary redirects are accepted.

## Original-card updating and failure behavior

The repository-side in-place updating path is implemented and verified with mocked external transport. The initial workflow must claim the initial post, run **Post card in a chat or channel**, and register the output identity. A protected job-level claim prevents another root post if a callback or posting result is lost.

Status synchronization loads the complete job, renders the complete original content plus both Chicago timestamps, and sends `operation: update-card`, stored original identity, full replacement card, stable idempotency key, revision, and update time. It never uses the initial posting webhook as a fallback. The update workflow must use **Update an adaptive card in a chat or channel** with the original message and same Teams posting connection.

Server updates serialize per job, reload current state, and retry up to three times with bounded timeouts/backoff. Acknowledgement requires the correct job, original message ID, and idempotency key; webhook acceptance alone is insufficient. A late competing print waits for the active synchronization and then reads the new state. Already acknowledged revisions skip transport.

On missing configuration/identity or failed update, timestamps remain saved, diagnostics contain safe reason codes, and Pullsmith shows a synchronization warning. **There is no new-root-card or thread-reply fallback.** No status path can post the email body as another message. If initial posting is ambiguous, the claim remains held; recover the existing message identity from workflow history instead of blindly reposting.

## Derek's remaining setup

Exact numbered workflow actions, expressions, sanitized requests/callbacks/responses, ownership instructions, all environment variables and defaults, troubleshooting, and controlled live verification steps are in [TEAMS-WORKFLOW.md](../TEAMS-WORKFLOW.md).

The Vercel Production audit found these missing:

- `CHECK_EMAIL_NOW_URL`
- `FORMATTER_BASE_URL` (existing production fallback works, but explicit per-environment configuration is documented)
- `TEAMS_ACTION_SIGNING_SECRET`
- `TEAMS_UPDATE_WORKFLOW_URL`
- `TEAMS_UPDATE_WORKFLOW_SECRET`

The existing write secret, Teams webhook, GitHub workflow token, Check Email secret, and Redis credentials were listed as present. GitHub's existing secrets were present. No secret values were changed or compared.

Required manual sequence:

1. Configure the initial workflow's protected post-claim call, single Post Card action with retries disabled, and protected message-registration callback.
2. Create a **separate** HTTP update workflow, validate its header secret, serialize it with concurrency 1, reload the current card from Pullsmith, update the original message, and return the explicit success/failure response. Separate triggers avoid a callback waiting behind its own initial-post run.
3. Set the missing Vercel variables, preserving the same internal write secret in GitHub/Vercel/workflow configuration, and add a workflow co-owner.
4. Deploy when authorized, then run a controlled synthetic live test to verify both statuses change the same original Teams card. No live deployment or workflow alteration occurred in this task.

The native Teams webhook template alone cannot consume the custom update envelope or prove an in-place update. The update workflow needs the documented generic HTTP trigger/Response capability available in the tenant.

## Tests and validation

Added focused regressions for configured/unconfigured Check Email parity and secret-safe workflow dispatch; complete email ingestion and duplicate/revised identities; exact original action URL retention; source and Teams metadata protection; narrow status validation, TTL/index preservation, deleted/missing jobs, repeat requests and explicit races with autosave; job-level post claims and message registration; both signed targets and tampering/expiry; nonmutating GET and confirmed POST; full card retention, Chicago statuses, original-message-only transport, bounded failure, acknowledgement/idempotency, and the final-read/lock-release race. Browser tests cover immediate updates, safe warnings, job switching, exact request bodies, reload, and badge overlays. Native ESM tests load 13 separate application modules without bundling.

| Command / check | Final result |
| --- | --- |
| Root `npm test` | **275 passed, 0 failed, 0 skipped**, exit 0. Includes server formatter/pricing builds. |
| Root `npm run typecheck` | Passed, exit 0. |
| Root `npm run build` | Passed, exit 0; 1,718 Vite modules transformed. |
| Root `git diff --check` | Passed; only Git line-ending advisories, no whitespace errors. |
| Email tool `npm test` | **12 passed, 0 failed, 0 skipped**, exit 0. |
| Email tool `npm run check` | Passed, exit 0. |
| Targeted repository/API tests | 34 passed. |
| Targeted Teams action/update tests | 8 passed. |
| Targeted email API + native ESM tests | 12 passed (10 API + 2 ESM). |
| Fresh generated formatter comparison | Byte-identical after another `npm run build:server-formatter`; SHA-256 `935972CC0F25473536E5B6390413C8BEFBA33ABEC5DE8370490FE1E76E2640B1`. No manual generated-file edit or resulting formatter diff. |

Local browser verification used isolated Vite configurations with the production proxy disabled and all external boundaries intercepted. It exercised real app UI, then the actual local API handlers/repository with in-memory Redis and an acknowledged mock update workflow. Confirmed both native signed POST actions, nonmutating GET, repeated confirmation, `?job=` opening, both icons, both print actions, pricing/exact UUID preservation, reload, warning/dismiss behavior, legacy `?list=` loading, and desktop/390px mobile confirmation layout. Browser `print()` was stubbed; no physical printing is claimed.

Remaining limits: no real Teams post/edit or GitHub dispatch was performed; tenant HTTP capabilities, connection permissions, message rendering/size, callback outputs, and deployed behavior remain unverified. Redis Lua behavior was checked through atomic interleaving fixtures and installed client serialization, not a live Redis engine. There is no local Redis server installed. Complete email content is retained; oversized Teams cards may be rejected rather than silently truncated.

## Every file changed for this task

### Server and shared renderer

- `.github/workflows/email-to-teams.yml`
- `api/_email-ingest.ts` (new)
- `api/_pull-list-job-repository.ts`
- `api/_teams-action-token.ts` (new)
- `api/_teams-sync.ts` (new)
- `api/check-email-now.ts`
- `api/pull-list-jobs.ts`
- `api/send-test-teams.ts`
- `api/teams-actions.ts` (new)
- `shared/pull-list-teams-card.mjs` (new)
- `shared/pull-list-teams-card.d.mts` (new)

### Browser and model

- `src/main.tsx`
- `src/SavedPullListsPicker.tsx`
- `src/pull-list-job-client.ts`
- `src/pull-list-job.ts`
- `src/pull-list-print-status-sync.ts` (new)
- `src/saved-pull-list-diagnostics.ts`
- `src/saved-pull-list-picker.ts`

### Email tool

- `tools/test/email-to-teams/.env.example`
- `tools/test/email-to-teams/README.md`
- `tools/test/email-to-teams/package.json`
- `tools/test/email-to-teams/src/config.js`
- `tools/test/email-to-teams/src/email-job.js` (new)
- `tools/test/email-to-teams/src/format-email.js`
- `tools/test/email-to-teams/src/formatted-list-store.js`
- `tools/test/email-to-teams/src/index.js`
- `tools/test/email-to-teams/src/share-link.js`
- `tools/test/email-to-teams/src/teams.js`

### Tests and documentation

- `test/email-teams-api.test.mjs` (new)
- `test/fake-pull-list-redis.mjs` (new)
- `test/pull-list-job.test.mjs`
- `test/pull-list-print-status-sync.test.mjs` (new)
- `test/saved-pull-list-picker.test.mjs`
- `test/teams-actions.test.mjs` (new)
- `test/teams-server-esm-runtime.test.mjs` (new)
- `tools/test/email-to-teams/test/teams-job.test.js` (new)
- `docs/TEAMS-WORKFLOW.md` (new)
- `docs/TEAMS-IMPLEMENTATION-REPORT.md` (new)

Pre-existing unrelated work remains untouched: `api/_microsoft-graph.ts`, `api/graph-mail-smoke.ts`, `docs/MICROSOFT-GRAPH.md`, `test/microsoft-graph.test.mjs`, and the two pre-existing Graph entries in `test/saved-pull-list-server-esm-imports.test.mjs`. `src/formatter.ts`, `src/pricing.ts`, `src/PricingPanel.tsx`, and the legacy formatted-list endpoint were inspected and left unchanged. Generated formatter/pricing outputs were rebuilt only through the existing commands and have no content diff.

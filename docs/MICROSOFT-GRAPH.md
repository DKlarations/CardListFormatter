# Microsoft Graph read-only smoke tooling

The checked-in Graph work is a staged migration scaffold, not mailbox ingestion. `api/_microsoft-graph.ts` supplies server-only authentication and metadata reads; `api/graph-mail-smoke.ts` exposes the operational smoke test. The connected mailbox runner remains the IMAP tool invoked by `.github/workflows/email-to-teams.yml`. Check Email Now dispatches that workflow and does not call Graph. No complete Graph mailbox-processing endpoint or external Graph flow is established by this repository.

The [cleanup audit](REPOSITORY-CLEANUP-AUDIT.md) records the deployment distinction: the canonical Vercel alias was READY at `878647f`, while the newer `071cc03` deployment failed the function limit. This document describes checked-in code, not proof that the smoke route or newer Teams contract is available on that alias.

Configuration names, consuming files and requirements are in the [canonical environment-variable inventory](ENVIRONMENT-VARIABLES.md). Authentication uses the OAuth 2.0 client-credentials flow with the `https://graph.microsoft.com/.default` scope.

Pass 1 is deliberately read-only. `GET /api/graph-mail-smoke` requires `Authorization: Bearer <CRON_SECRET>`, acquires a short-lived app token in memory, and reads at most three metadata-only records from the configured mailbox Inbox. The mailbox address comes only from server configuration; the request cannot choose another mailbox. Message bodies and attachments are not requested. The response includes the configured mailbox address, reachability/count, and each sample's received timestamp, sender domain, read flag and presence indicators. It omits message IDs, subject text, sender names/full addresses, bodies, attachments and credentials.

The smoke test does not find ingestion candidates, retrieve message content, filter pull lists, deduplicate or create jobs, post Teams cards, mark messages processed, retry ingestion, or trigger Check Email Now. A future replacement must implement and test all of those responsibilities and connect the scheduler/manual trigger before the IMAP runner can be retired. Keep both paths during this staged migration; do not broaden Graph permissions as repository cleanup.

No Microsoft credential or access token belongs in source code, browser environment variables, frontend bundles, logs, persistence, or API responses. Do not create `VITE_MICROSOFT_*` variables.

`Mail.Send` is out of scope for Pass 1. Tenant-granted permissions and cross-mailbox restrictions are external configuration; the previous smoke work did not independently test a second mailbox. The cleanup did not inspect or change Entra configuration.

`test/microsoft-graph.test.mjs` verifies authorization, metadata-only requests and sanitized responses with mocked transport. `test/saved-pull-list-server-esm-imports.test.mjs` retains Graph's explicit `.js` import checks; the separate native Teams/Saved Jobs runtime test does not execute the Graph route. These checks are not a live mailbox test.

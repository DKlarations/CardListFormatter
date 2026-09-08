# Environment-variable inventory

Canonical name-only configuration inventory, audited against executable code and the checked-in GitHub workflow on 2026-09-07. No configured values are included. Defaults and example URLs remain in code/the local example; this table describes whether configuration is required. Presence or validity in deployed environments is not asserted.

Environments: **Actions** = `.github/workflows/email-to-teams.yml`; **local tool** = `tools/test/email-to-teams`; **Vercel** = server runtime; **Microsoft Workflow** = external secure trigger/action configuration prescribed by [TEAMS-WORKFLOW.md](TEAMS-WORKFLOW.md). External workflow names below are shared configuration contracts, not proof of literal environment variables or wiring in Power Automate. No browser secret variables are supported.

## Mailbox runner and initial posting

`tools/test/email-to-teams/src/config.js` consumes every name in this table. Actions wiring is explicit in the workflow; local watch/dry-run/once scripts read the same configuration through `dotenv/config`.

| Name | Additional consuming file / workflow | Environment | Required? / purpose | Active / replacement status |
| --- | --- | --- | --- | --- |
| `IMAP_HOST` | Actions secret mapping; `src/index.js` connection | Actions, local tool | Required, including dry run; mailbox host | Active; no connected Graph replacement |
| `IMAP_PORT` | Actions secret mapping; `src/index.js` | Actions, local tool | Optional; connection port | Active |
| `IMAP_SECURE` | Actions secret mapping; `src/index.js` | Actions, local tool | Optional; TLS connection setting | Active |
| `IMAP_USER` | Actions secret mapping; `src/index.js` | Actions, local tool | Required, including dry run; login identity | Active |
| `IMAP_PASSWORD` | Actions secret mapping; `src/index.js` | Actions, local tool | Required, including dry run; login credential | Active |
| `IMAP_MAILBOX` | Actions repository-variable mapping; `src/index.js` | Actions, local tool | Optional; selected mailbox folder | Active |
| `MAX_EMAIL_AGE_DAYS` | Actions repository-variable mapping; `src/index.js` | Actions, local tool | Optional; unread candidate lookback | Active |
| `SUBJECT_FILTER` | Actions explicit setting; `src/index.js` | Actions, local tool | Optional; subject filter plus pull-list heuristics | Active; Actions leaves filter empty |
| `DRY_RUN` | Actions explicit setting; `src/index.js` | Actions, local tool | Optional; suppress job save, post and processing mutations | Active; Actions selects live mode; CLI dry-run also overrides |
| `MARK_PROCESSED_SEEN` | Actions explicit setting; `src/index.js` | Actions, local tool | Optional; mark represented/acknowledged messages Seen | Active; Actions enables; acknowledgement is not confirmed Teams delivery |
| `POLL_INTERVAL_SECONDS` | `src/index.js` watch loop | Local tool; Actions does not set it | Optional; watch polling interval | Active; `once` exits without watch polling |
| `PROCESSED_STORE` | `src/processed-store.js` via runner | Local tool; Actions uses default ephemeral file | Optional; local processed-message ledger path | Active; workflow does not persist this file across runs |
| `TEAMS_WEBHOOK_URL` | Actions secret mapping; tool `src/teams.js`; `api/send-test-teams.ts`; `api/_teams-sync.ts` compares initial/update URLs | Actions, local tool, Vercel; external Microsoft Workflow trigger | Required for non-dry initial posting and diagnostic posting | Active; never a status-update fallback |
| `FORMATTER_BASE_URL` | Actions repository-variable mapping; tool store/link helpers; `src/formatter.ts` (and generated bundle), `api/_email-ingest.ts`, `api/_teams-sync.ts` | Actions, local tool, Vercel | Optional in code with production/request-origin fallback; configure explicitly to target intended environment | Active; canonical job/provider/link origin |
| `FORMATTED_LIST_WRITE_SECRET` | Actions secret mapping; tool `src/formatted-list-store.js`; `api/formatted-lists.ts`, `api/_email-ingest.ts`, `api/teams-actions.ts`, `api/send-test-teams.ts` | Actions, local tool, Vercel, secure Microsoft Workflow configuration | Required for live ingest, protected claims/registration/card reads and legacy POST; sent in internal header | Active despite legacy name; not staff authentication |
| `CHECK_EMAIL_NOW_URL` | Actions secret mapping; tool card preparation; `api/send-test-teams.ts`, `api/_email-ingest.ts`, `api/_teams-sync.ts` | Actions, local tool, Vercel; card consumed in Teams | Optional; capability link for dispatch action; original can persist on job | Active; missing URL omits button; replacements can retain original URL |

## Dispatch and original-card updates

| Name | Consuming file / external contract | Environment | Required? / purpose | Active / replacement status |
| --- | --- | --- | --- | --- |
| `CHECK_EMAIL_NOW_SECRET` | `api/check-email-now.ts` | Vercel | Required for capability authorization before GitHub dispatch | Active; distinct from GitHub token and internal write secret |
| `GITHUB_WORKFLOW_TOKEN` | `api/check-email-now.ts` | Vercel only | Required for GitHub dispatch Authorization header | Active; never belongs in card URLs |
| `GITHUB_WORKFLOW_REPOSITORY` | `api/check-email-now.ts` | Vercel | Optional dispatch repository override | Active |
| `GITHUB_WORKFLOW_ID` | `api/check-email-now.ts` | Vercel | Optional dispatch workflow override | Active |
| `GITHUB_WORKFLOW_REF` | `api/check-email-now.ts` | Vercel | Optional dispatch branch/ref override | Active |
| `TEAMS_ACTION_SIGNING_SECRET` | `api/_teams-sync.ts`, `api/teams-actions.ts` via `_teams-action-token.ts` | Vercel only | Required only for optional signed Mark Printed actions | Active checked-in implementation; absence omits buttons |
| `TEAMS_UPDATE_WORKFLOW_URL` | `api/_teams-sync.ts` | Vercel; separate external Microsoft Workflow trigger | Required for original-card sync; separate HTTPS update endpoint | Active checked-in implementation; deployment/wiring must be verified |
| `TEAMS_UPDATE_WORKFLOW_SECRET` | `api/_teams-sync.ts`; external workflow validates `x-pullsmith-workflow-secret` | Vercel, secure Microsoft Workflow configuration | Required for original-card sync | Active checked-in contract; separate secret from ingestion/signing |

Microsoft Workflow also holds its existing Teams connection, destination and internal-secret header mapping. Those are external connection/action fields, not additional repository environment variables. `GITHUB_WORKFLOW_*` here means exactly the four listed names (including TOKEN); there is no generic wildcard loader.

## Redis persistence

`api/_redis.ts:redisConfigFromEnv` chooses the first **complete pair** below, in listed order. One writable pair is required for Saved Pull Lists, Teams state, and legacy formatted lists. Do not mix values from different pairs or databases. Names only are shown.

| Name | Consumer | Environment | Required? / purpose | Active / replacement status |
| --- | --- | --- | --- | --- |
| `PULLSMITH_KV_REST_API_URL` | `api/_redis.ts` | Vercel | Preferred pair's REST endpoint | Active preferred pair |
| `PULLSMITH_KV_REST_API_TOKEN` | `api/_redis.ts` | Vercel | Preferred pair's write-capable credential | Active preferred pair |
| `UPSTASH_REDIS_REST_URL` | `api/_redis.ts` | Vercel | Fallback pair's REST endpoint | Active compatibility; do not delete without configuration audit |
| `UPSTASH_REDIS_REST_TOKEN` | `api/_redis.ts` | Vercel | Fallback pair's write-capable credential | Active compatibility |
| `lists_REDIS_URL` | `api/_redis.ts:restUrlFromEnv` | Vercel | Legacy endpoint; accepts existing secure Redis URL form | Active compatibility |
| `lists_KV_REST_API_TOKEN` | `api/_redis.ts` | Vercel | Legacy pair's write-capable REST credential | Active compatibility |
| `PULLSMITH_KV_REST_API_READ_ONLY_TOKEN` | No executable consumer; `test/redis-config.test.mjs` verifies this variable name is not selected | Vercel integration name, if present | Not supported for persistence | Inactive as application configuration; no substitute for write token |

The helper selects configured pairs; it does not inspect token permissions. A read-only credential placed under a write-token name would fail when Redis rejects a mutation.

## Graph smoke tooling

Graph has no production mailbox-processing path here. These names configure the retained migration scaffold and operational smoke route only. See [MICROSOFT-GRAPH.md](MICROSOFT-GRAPH.md); this audit did not inspect or broaden granted Microsoft permissions.

| Name | Consumer | Environment | Required? / purpose | Active / replacement status |
| --- | --- | --- | --- | --- |
| `MICROSOFT_TENANT_ID` | `api/_microsoft-graph.ts` | Vercel / isolated local server tests | Required for smoke token acquisition | Active smoke configuration; not IMAP replacement |
| `MICROSOFT_CLIENT_ID` | `api/_microsoft-graph.ts` | Vercel / isolated local server tests | Required for smoke client-credentials flow | Active smoke configuration |
| `MICROSOFT_CLIENT_SECRET` | `api/_microsoft-graph.ts` | Vercel only in deployment; test fixtures local | Required for smoke client-credentials flow | Active server-only smoke configuration |
| `PULLSMITH_MAILBOX_ADDRESS` | `api/_microsoft-graph.ts` | Vercel / isolated local server tests | Required configured mailbox for metadata sample | Active smoke configuration |
| `CRON_SECRET` | `api/graph-mail-smoke.ts`; both refresh routes as fallback | Vercel | Required for smoke bearer authorization; also scheduled refresh authorization when no refresh-specific secret overrides | Active shared operations credential; no Graph ingestion cron |

`MICROSOFT_LOGIN_BASE_URL`, `MICROSOFT_GRAPH_BASE_URL` and `MICROSOFT_GRAPH_SCOPE` in the helper are constants, not environment variables. `VITE_MICROSOFT_*` appears only in documentation prohibiting browser credential exposure, not as a supported configuration family.

## MTGJSON / Blob operations

| Name | Consumer | Environment | Required? / purpose | Active / replacement status |
| --- | --- | --- | --- | --- |
| `BLOB_READ_WRITE_TOKEN` | `api/mtgjson-index.ts`, `api/mtgjson-pricing-index.ts`, both refresh routes | Vercel | Blob store credential for index reads/writes; passed explicitly when set, otherwise SDK environment resolution applies | Active |
| `MTGJSON_REFRESH_SECRET` | Both refresh routes | Vercel | Optional override of CRON_SECRET for authorized refresh requests; one of the two must be configured | Active; override takes precedence, so verify scheduled authorization when both exist |
| `MTGJSON_SET_LIST_URL` | Both refresh routes | Vercel | Optional upstream set-list URL override | Active |
| `MTGJSON_SET_FILE_BASE_URL` | Both refresh routes | Vercel | Optional upstream set-file base URL override | Active |
| `MTGJSON_SET_FETCH_CONCURRENCY` | `api/refresh-mtgjson-index.ts` | Vercel | Optional builder worker-count setting | Active |
| `MTGJSON_PRICING_SET_FETCH_CONCURRENCY` | `api/refresh-mtgjson-pricing-index.ts` | Vercel | Optional pricing builder worker-count setting | Active |
| `MTGJSON_PRICES_URL` | `api/refresh-mtgjson-pricing-index.ts` | Vercel | Optional upstream prices URL override | Active |

Scryfall request intervals/cache policy and TCGplayer URLs are implemented constants and code paths, not secret environment variables. This inventory does not change those protections.

## Resolution-index readiness check

The separate `.github/workflows/resolution-index-readiness.yml` workflow performs one read-only manifest request after a successful main production deployment or manual dispatch on main. It does not refresh data or run the mailbox. See [RESOLUTION-INDEX-READINESS.md](RESOLUTION-INDEX-READINESS.md) for the release sequence and one-time setup.

| Name | Consumer | Environment | Required? / purpose | Active / replacement status |
| --- | --- | --- | --- | --- |
| `FORMATTER_BASE_URL` | Readiness workflow repository-variable mapping; `tools/check-resolution-index-readiness.mjs` | Actions; optional local authorized read-only check | Required for this check; exact canonical HTTPS application origin, without credentials, query or fragment | Existing name; readiness check deliberately has no fallback target |
| `RESOLUTION_INDEX_READINESS_BYPASS_SECRET` | Readiness workflow secret mapping; `tools/check-resolution-index-readiness.mjs` | Actions only when manifest is protected | Optional Vercel protection-bypass header; public manifests need no secret | New optional read-access setup; not a refresh or write credential |

## Obsolete documentation and platform-provided names

| Name | References / environment | Required? / purpose | Active / replacement status |
| --- | --- | --- | --- |
| `PULL_LIST_STAFF_PASSCODE` | Former README claim; no executable consumer | Not consumed | Obsolete since staff-gate removal in `89ab8b4`; setting it provides no authentication |
| `PULL_LIST_STAFF_SESSION_SECRET` | Former README claim; no executable consumer | Not consumed | Obsolete; Entra is a TODO, not an implemented replacement |
| `GITHUB_SHA` | Workflow's commit-report step; GitHub Actions supplies it | Platform-provided run commit identity | Active diagnostic; not a secret users must configure |

No other `PULL_LIST_STAFF_*` consumer was found. Future authentication is a separate security task. Historical environment-presence snapshots in the archived report are not current configuration instructions. This inventory contains names and roles, never configured secret values.

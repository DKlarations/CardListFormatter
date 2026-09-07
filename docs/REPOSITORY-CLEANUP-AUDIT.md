# Repository cleanup audit

Audit of CardListFormatter / Mike Pullsmith on 2026-09-07. This is repository archaeology and conservative documentation/artifact cleanup. No runtime behavior, credentials, external workflows, data, version, or retention policy is changed. No commit or push is authorized for this pass.

The original cleanup results below are preserved. The separately requested deployment repair moves generated libraries out of `api/`; current paths are reflected in the generation inventory, with build evidence in [Deployment repair](#deployment-repair-generated-libraries-outside-api).

## Safety gates and baseline

Read `AGENTS.md` before inspecting application files. All required gates passed before edits:

| Command | Starting result |
| --- | --- |
| `git branch --show-current` | `chore/repository-cleanup-2026-09-07` |
| `git status --short` | Empty: clean working tree |
| `git rev-parse HEAD` | `071cc03d5c9dc19be542c2616a45dca518b88ede` |
| `git rev-parse origin/main` | `071cc03d5c9dc19be542c2616a45dca518b88ede` |
| `git show-ref --verify refs/heads/backup/pre-cleanup-2026-09-07` | Exists at the starting commit |
| `git show-ref --verify refs/tags/pre-cleanup-2026-09-07` | Exists: annotated tag object `ef44c4231908cdf7ce0c8e49033557100852b9a2` |
| `git rev-parse 'refs/tags/pre-cleanup-2026-09-07^{}'` | Tag resolves to the starting commit |

Baseline: root `npm test` 275 passed / 0 failed / 0 skipped; root `npm run typecheck` passed; root `npm run build` passed (1,718 Vite modules); email-tool `npm test` 12 passed / 0 failed / 0 skipped; email-tool `npm run check` passed. Each exited 0. `git diff --check` exited 0 with only generated-file LF/CRLF advisories, and `git status --short` remained empty after builds. There were no unexplained local baseline failures.

## Checked-in architecture versus deployed evidence

**The connected mailbox runner in this repository is IMAP. Microsoft Graph is only a read-only smoke test. External Microsoft Workflows perform the Teams post/update transport; their live configuration is not stored here.** There is no evidence in this repository of an external Graph mailbox-processing flow, and its existence or absence outside the repository cannot be established here.

Read-only remote metadata revealed a separate, pre-existing deployment failure:

- GitHub's production deployment `6312862662` for starting commit `071cc03` reports failure. Vercel deployment `dpl_EkcWHr2vg4nY9A9GXUEqjV5piSgm` confirms `ERROR`, code `exceeded_serverless_functions_per_deployment`, at `patchBuild`: the deployment exceeds the account's 12-function limit.
- Vercel inspection of `card-list-formatter.vercel.app` resolves to READY deployment `dpl_EwibmuHeaPijX7xhtpon29Jkdte3`, commit `878647f970a396c1640c4d6220dfaff3ccb64c08`, a September 7 redeployment. It reports 11 Node functions. This is alias/deployment metadata, not an end-to-end live workflow test.
- Consequently the new job-based email/Teams code is on main but the canonical production alias still points to the prior implementation. At `878647f`, both the email runner and `/api/send-test-teams` write legacy formatted-list records. A new main-branch mailbox run would expect the newer ingest endpoint on an older server; that mismatch requires a separate deployment task.
- GitHub reports `.github/workflows/email-to-teams.yml` active. The five latest runs returned by `gh run list --workflow email-to-teams.yml --limit 5` are completed successful scheduled runs on `17caf16850b6d2c96eb87a2563d84b99c8eb81fd`, newest `30795836806` at `2026-08-03T08:02:21Z`. This is historical runner evidence, not proof of a successful run at the starting commit or healthy polling now.
- No Teams Workflow export, tenant configuration, mailbox read, secret value, or customer record was inspected. Vercel protection settings were not exposed by the project metadata inspected; deployment-level protection is unproven.

### Entry points and indirect connections

| Entry | Dependency / execution map |
| --- | --- |
| `index.html` | Loads `/src/main.tsx` and `/favicon-peek.png`. |
| `src/main.tsx` | React application, formatter, Saved Pull Lists and `/teams-test` UI; lazy-imports `src/PricingPanel.tsx`. |
| `src/PricingPanel.tsx` | Pricing logic, exact printing search, catalog recovery and diagnostics; dynamically imports `src/mtgjson-live-pricing.ts`. |
| Browser URLs | `/api/pull-list-jobs` for CRUD/recent/search/print status; `/api/formatted-lists?id=...` for `?list=`; `?job=` for resumable jobs; `#formatted=` v1-v5 and `#input=` compatibility; `/api/send-test-teams` for the diagnostic page. |
| Browser provider paths | `/api/mtgjson-index`, `/api/mtgjson-pricing-index`, their two refresh routes, `/api/tcgplayer-listed-median`; local TCGplayer proxy paths in `vite.config.ts`; direct Scryfall, MTGJSON/Blob and exchange-rate requests. |
| `.github/workflows/email-to-teams.yml` | `workflow_dispatch` and `*/15 * * * *`; serialized concurrency group; Node 22, `npm ci`, `npm run once` in `tools/test/email-to-teams`; npm cache points to its lockfile. |
| Nested runner | `tsx src/index.js --once` -> IMAP/MIME -> `src/formatter.ts` -> `email-job.js` -> protected ingest -> shared card -> initial Teams webhook. |
| Teams initial workflow contract | Receives `post-card`; calls `POST /api/teams-actions?action=claim-post`; posts once if claimed; calls protected `POST ...?action=register-message`. These external actions are prescribed by docs, not checked-in executable workflow exports. |
| Teams update workflow contract | Server `_teams-sync.ts` sends `update-card` to a separate protected HTTP workflow; workflow calls protected `GET /api/teams-actions?action=card&id=...`, updates stored message ID, returns matching acknowledgement. |
| Signed print action | HMAC links to `/api/teams-actions`: GET confirmation is read-only; form POST validates signature, origin when present, job/target/expiry and records an idempotent print timestamp. |
| Check Email Now | `/api/check-email-now` checks a capability secret, then dispatches the GitHub workflow. It does not call Graph. |
| `vercel.json` | Two refresh functions have `maxDuration: 300`; crons invoke formatter refresh Monday 05:00 UTC and pricing refresh Monday 06:00 UTC; sole rewrite `/teams-test` -> `/index.html`. No mailbox/Graph cron or auth boundary. |
| Native runtime imports | Server TypeScript uses explicit relative `.js` specifiers; shared `.mjs` renderer and generated `.mjs` formatter are runtime inputs. Extensionless browser imports are bundled by Vite. |

The 11 HTTP-handler TypeScript routes are `api/check-email-now.ts`, `api/formatted-lists.ts`, `api/graph-mail-smoke.ts`, `api/mtgjson-index.ts`, `api/mtgjson-pricing-index.ts`, `api/pull-list-jobs.ts`, `api/refresh-mtgjson-index.ts`, `api/refresh-mtgjson-pricing-index.ts`, `api/send-test-teams.ts`, `api/tcgplayer-listed-median.ts`, and `api/teams-actions.ts`. At the cleanup baseline, `api/` also contained helpers and two generated libraries. HTTP-export counting alone did not reveal the packaging problem: the separate repair below verifies 13 emitted Functions before relocation and 11 afterward. A successful hosted deployment remains unverified.

### Complete mailbox-processing comparison

| Requirement | Checked-in IMAP path | Graph path |
| --- | --- | --- |
| Candidate discovery | `index.js`: unread messages within lookback in configured mailbox | `readMicrosoftGraphMailboxSmokeSample`: at most three Inbox metadata records; no ingestion selection |
| Retrieve content | IMAP source fetch, `mailparser.simpleParser`, text/HTML normalization | No bodies or attachments requested |
| Pull-list filtering | Subject filter plus content heuristics in `index.js` / `format-email.js` | Absent |
| Duplicates / revised mail | Local processed IDs, per-run job IDs, server fingerprint dedupe, original Teams metadata and protected post claim; changed card requests get distinct jobs | Absent |
| Create job | `saveEmailPullListJob` -> `POST /api/teams-actions?action=ingest` -> repository | Absent |
| Initial card | `postPreparedEmail` -> shared payload -> `postToTeams` -> external initial workflow | Absent |
| Record success | Processed-store JSON and optional IMAP Seen after accepted post or already represented job | No mailbox mutation or processing state |
| Failures / retry | A failed message aborts remaining candidates in that run; later polls can retry eligible unread work; job/claim dedupe limits reposts; ambiguous post claim requires operational recovery | Sanitized smoke errors only |
| Check Email Now | Secret-gated GitHub workflow dispatch | No connection |

The GitHub workflow does not persist `data/processed-messages.json` across runners; only npm dependencies are cached. Cross-run protection depends on mailbox Seen state and Redis/job/workflow state. `postToTeams` accepts HTTP `response.ok`; it does not prove the external workflow completed Post Card or registered the message. Seen therefore means the tool recorded an acknowledged post request or an already represented job, not confirmed delivery. Actual workflow claim/callback wiring must be verified separately.

## Classification rules

Each inventory row has exactly one category: A active production path, B active support/operations, C compatibility, D experimental/migration, E generated, F test-only, G historical documentation, H dead/artifact. A means a connected checked-in production path, not proof that the newest revision is deployed. A file can contain a narrower suspect symbol; those symbol-level candidates are separately listed. High confidence in a category does not imply permission to delete anything except H.

Reference evidence combines complete `git ls-files`, `git grep`/`rg` scans (including hidden workflows and path strings), imports, package scripts, route conventions, tests and relevant history. Ignored dependency/build/deployment directories are not deletion candidates. No secret-bearing `.env` or local data file was opened.

### All active production files (A)

Every path in the following table is category A, high confidence, retained. Removing any would break its named consumer; the relevant baseline/final suite and build are the validation required before considering a replacement. Test consumers are additionally indexed below.

| Path(s) | References and role |
| --- | --- |
| `index.html`, `src/main.tsx` | Vite HTML script / React entry and application route strings. |
| `src/formatter.ts` | `main.tsx`, `PricingPanel.tsx`, email `index.js`, server generation; parsing/resolution/output. |
| `src/PricingPanel.tsx`, `src/pricing.ts` | Lazy main import; panel and catalog/search modules consume pure pricing; pricing bundle generation. |
| `src/customer.ts` | Formatter, pricing UI, main, job schema, share links, formatted-list API; customer normalization. |
| `src/document-title.ts`, `src/workspace-ui.ts` | `main.tsx`; page title and formatter controls. |
| `src/generated-sample.ts` | Formatter and job schema; generated starter-list recognition and persistence exclusion. This is authored runtime source, not generated output. |
| `src/exact-printing-search.ts` | `PricingPanel.tsx`; exact physical selection. |
| `src/printing-normalization.ts` | Formatter, panel, live fallback and pricing refresh; provider treatment normalization. |
| `src/mtgjson-live-pricing.ts` | Dynamic panel import; ZIP catalog/price fallback. |
| `src/pricing-catalog-state.ts`, `src/pricing-catalog-recovery.ts` | Panel/recovery imports; loading/failure/readiness and bounded recovery. |
| `src/pricing-data-diagnostics.ts`, `src/pricing-ui-state.ts` | Panel and main UI; safe diagnostics and visibility state. |
| `src/pricing-session.ts` | `pricing.ts`, job schema; persisted row normalization shared by browser and native server graph. |
| `src/pull-list-job.ts` | Main, client, picker, print sync types, server repository/Redis/ingest/Teams; schema and 30-day TTL. |
| `src/pull-list-fingerprint.ts` | `_pull-list-job-repository.ts`; deterministic duplicate identity. |
| `src/pull-list-job-client.ts` | Main and picker; browser Saved Pull List HTTP requests. |
| `src/pull-list-print-status-sync.ts` | Main; immediate print status and late-response isolation. |
| `src/SavedPullListsPicker.tsx`, `src/DeleteSavedPullListDialog.tsx` | Main -> picker -> dialog; recent/search/open/delete. |
| `src/saved-pull-list-picker.ts`, `src/saved-pull-list-diagnostics.ts`, `src/saved-session-state.ts` | Main, picker/dialog, HTTP client; summaries, diagnostics and autosave lifecycle. |
| `src/share-link.ts` | Main Copy Link encoder and loaders; current links plus compatibility decoders. |
| `src/styles.css` | Main style import, including dynamic `is-*` classes and print styles. |
| `images/LOGO_PNG_HEADER.png`, `images/Logo-LineArt.png`, `public/favicon-peek.png` | Main logo imports/print HTML and index favicon URL. |
| `api/pull-list-jobs.ts`, `api/_pull-list-job-repository.ts`, `api/_redis.ts` | Browser/API routes and Teams ingest/sync; persistence, indexes, CAS, credential selection. |
| `api/_email-ingest.ts` | `api/teams-actions.ts`; protected complete email draft and job creation. |
| `api/teams-actions.ts`, `api/_teams-action-token.ts`, `api/_teams-sync.ts` | HTTP workflow/signed action routes, repository print mutations and shared rendering. |
| `shared/pull-list-teams-card.mjs` | `_teams-sync.ts`, `send-test-teams.ts`, email `format-email.js`; one canonical card renderer/envelope. |
| `api/check-email-now.ts` | Card capability URL; GitHub dispatch. |
| `api/mtgjson-index.ts`, `api/mtgjson-pricing-index.ts` | Browser/formatter URL fetches; Blob manifests. |
| `api/refresh-mtgjson-index.ts`, `api/refresh-mtgjson-pricing-index.ts` | Vercel crons and browser refresh requests; index builders. |
| `api/tcgplayer-listed-median.ts` | PricingPanel fetch URL; server price proxy/cache. |
| `.github/workflows/email-to-teams.yml` | GitHub schedule/dispatch; nested package/lock paths and configured IMAP env names. |
| `tools/test/email-to-teams/src/index.js`, `tools/test/email-to-teams/src/config.js` | `once`, `watch`, `dry-run` scripts; IMAP runner/config. |
| `tools/test/email-to-teams/src/format-email.js`, `tools/test/email-to-teams/src/email-job.js` | Runner and tests; MIME normalization, heuristics and canonical job preparation/post. |
| `tools/test/email-to-teams/src/formatted-list-store.js` | `email-job.js` calls active `saveEmailPullListJob`; legacy writer exports also remain. Filename is transitional. |
| `tools/test/email-to-teams/src/processed-store.js`, `tools/test/email-to-teams/src/teams.js` | Runner imports; local processing ledger and HTTP webhook transport. |
| `tools/test/email-to-teams/src/share-link.js` | Runner dry-run `formatterLinkForInput`; tests exercise retained legacy/job link helpers. |
| `package.json`, `package-lock.json`, `tools/test/email-to-teams/package.json`, `tools/test/email-to-teams/package-lock.json` | Root builds and GitHub `npm ci`/runner; executable scripts and dependency resolution. |
| `vercel.json`, `vite.config.ts` | Deployment crons/routes and Vite build/development proxies. |

### Support, compatibility, migration, generated and tests

| Path / candidate | Category | References / role | Confidence | Action, removal risk and required validation |
| --- | --- | --- | --- | --- |
| `AGENTS.md`, `README.md` | B | Repository contributor entry points | High | Retain; correct README. Removal loses operational guidance; check links and code claims. AGENTS rules match current ownership. |
| `tsconfig.json`, `src/vite-env.d.ts` | B | `tsc`, Vite asset/ambient types | High | Retain; typecheck/build required. |
| `.gitignore`, `tools/test/email-to-teams/.gitignore` | B | Git generated/dependency/local-data exclusions | High | Retain; loss risks accidental artifacts or local data staging. |
| `docs/PRINTING-MODEL.md`, `docs/SAVED-PULL-LISTS.md`, `docs/TEAMS-WORKFLOW.md` | B | Current design/setup and README links | High | Retain; correct stale integration/auth wording, link to canonical environment inventory. |
| `tools/test/email-to-teams/README.md`, `tools/test/email-to-teams/.env.example` | B | Runner setup and config names | High | Correct prototype label and doc links; keep existing config behavior. |
| `api/send-test-teams.ts` and `/teams-test` branch in `src/main.tsx` | B | Vercel route, rewrite, UI POST, setup guide, email API tests | High | Retain operational diagnostic; shared renderer is used. Missing inbound auth is a priority finding, not grounds for silent removal. |
| `api/formatted-lists.ts` | C | Browser `?list=` fetch; protected POST still exported; old deployed diagnostic and runner write it; share/API and ESM tests | High | Retain GET and POST. Deleting breaks existing and still-generated links; use sunset gate below. |
| `?list=` loader, `#input=`, formatted hash v1-v4 decoders | C | Main loader, both share-link modules, share/print-sync tests | High | Retain; old records/links deliberately readable. Hash links have no server TTL. |
| Old `customer.contact`, missing print metadata, legacy saved pricing and Redis credential pairs | C | Customer/job/pricing normalization, `_redis.ts`; dedicated regression tests | High | Retain until persisted records and deployment configuration are proven migrated. |
| `formatterLinkForSavedList`, `formatterLinkForFormattedOutput`, `encodeInputHash`, legacy `saveFormattedList`/date-ID helpers | C | Share-link tests, live decoders/legacy POST and prior `878647f` runner; some exports now definition-only in HEAD | Medium | Defer removal while older deployment/external scripts may use legacy writer/link contracts. No normal HEAD email writer calls legacy POST. |
| `formatterLinkForSavedJob` in nested share-link module | F | `tools/test/email-to-teams/test/teams-job.test.js`; runtime trusts server URL | High | Retain test utility; no behavior benefit from pruning. |
| `api/_microsoft-graph.ts` | D | Imported by smoke route and Graph tests; token + metadata read helper | High | Retain staged migration foundation; no full ingestion consumer or evidence of abandonment. |
| `api/graph-mail-smoke.ts`, `docs/MICROSOFT-GRAPH.md` | B | URL-addressed authorized read-only diagnostic, Graph tests and setup docs | High | Retain smoke support; document limited scope. No Graph cron/browser/Teams caller. |
| `server/generated/server-formatter.mjs`, `server/generated/server-pricing.mjs` | E | Root build/test scripts; formatter imported by diagnostic API; pricing imported by tests | High | Retained and relocated from `api/` by the separate deployment repair. Pricing has build/test consumers even without a production route import. Byte checks below. |
| `server/generated/server-formatter.d.ts`, `shared/pull-list-teams-card.d.mts` | B | Type declarations for `.mjs` import consumers | High | Hand-maintained declarations, not emitted by generation scripts; formatter declaration moved beside its bundle. No server-pricing declaration exists. |
| Every `test/*.test.mjs` (29 files) | F | Root `node --test test/*.test.mjs`; individual subjects described below | High | Retain all regressions; includes Graph and native ESM checks. |
| `test/fake-pull-list-redis.mjs`, `test/test-module-bundle.mjs` | F | Repository/Teams tests; fake Redis and esbuild test loader | High | Retain; fake storage avoids production mutation. |
| `tools/test/email-to-teams/test/email-normalization.test.js`, `tools/test/email-to-teams/test/teams-job.test.js` | F | Nested `node --test test/*.test.js` | High | Retain all 12 tests. |
| `docs/TEAMS-IMPLEMENTATION-REPORT.md` | G | Historical implementation handoff, duplicated current workflow guide | High | Move to `docs/archive/TEAMS-IMPLEMENTATION-REPORT.md`, add dated historical banner, repair relative guide link. Preserve evidence; distinguish commit from failed deployment. |
| `docs/REPOSITORY-CLEANUP-AUDIT.md` | B | This classification, evidence and deprecation plan | High | Keep as audit record, not live deployment guarantee. |
| `docs/ENVIRONMENT-VARIABLES.md` | B | Canonical configuration-name inventory linked by operational docs | High | Keep; contains no configured values. |

### Suspected dead items and conservative decisions

| Path / candidate | Category | All references found / role | Confidence | Proposed action | Risk if removed / proof needed |
| --- | --- | --- | --- | --- | --- |
| `foundation.patch` | H | Zero tracked source/script/workflow/doc consumers before this audit. Added only in `8c45657ccc60bd0cf0a6ae91ceb8be4405d225c6`; UTF-16 patch artifact. Its printing-intent/provider-normalization work is already represented in `ee3d754` and current formatter/pricing code. | High | Delete this one file after classification | No executable role. Retain formatter/pricing/printing-normalization regression suites; verify no reference except this removal record; backup/tag/history preserve it. |
| `src/customer.ts:customerHasValue` | H | Definition-only across tracked source, tests and docs; no normal consumer | Medium | Defer | Small exported API with uncertain external consumer; deletion adds avoidable runtime diff to this pass. Confirm external usage and add targeted export-removal coverage before later pruning. |
| `src/pricing.ts:finishOptions` | H | Source definition and generated pricing export; no other caller | Medium | Defer | Generated/public helper surface; source and bundle must be considered together. No pricing refactor in this pass. |
| `.eyebrow`, `.checkbox-option`, `.disabled-option`, `.help-option`, `.pricing-print-option`, `.pricing-empty--center` in `src/styles.css` | H | Selector definitions only in source/test/doc search; adjacent rules and runtime variants exist | Medium | Defer | Require rendered state/print-layout coverage and dynamic-class audit before deletion. `is-${...}` classes are actively constructed and are not dead. |
| `images/LOGO_PNG_LARGE.png`, `images/LOGO_PNG_SMALL-1.png` | B | No checked-in runtime import; retained branding/source assets without confirmed archival intent | Medium | Defer | Owner/source-asset purpose uncertain; search history and external design references first. |
| `public/favicon.png` | C | No checked-in reference; public URL asset can be fetched directly or cached by older clients | Medium | Defer | Require request/cached-client usage evidence before deleting URL-addressed asset. |
| `tools/test/email-to-teams` location/package name | A | Workflow working-directory/cache lock path, root MIME tests, nested imports/scripts/docs | High | Retain path and manifest name; correct documentation | Repository references are controlled but external local/ops automation paths are not verified. Atomic rename deferred until owners confirm no external old-path callers. |

Only the high-confidence H patch is removed. No runtime imports, helpers, exports, CSS, assets or dependencies are deleted in this pass.

## Compatibility sunset gates

1. **Legacy `?list=` / formatted-list POST:** Current HEAD no longer writes these records from its normal email/diagnostic paths, but the route still exports a valid protected writer and production currently serves `878647f`, which writes them. That deployment is the latest verified deployment capable of generating links; no last actual write was observed. A calendar removal date cannot be set now.
2. First verify a successful deployment of job ingestion and all external callers; retire/disable every legacy writer in a separately reviewed change. Record the latest successful POST across canonical, retained deployment and externally configured URLs. The minimum waiting window is **30 days (2,592,000 seconds) after the last possible successful legacy write**, not after this audit or push. Reads do not extend this record TTL.
3. During that window, collect privacy-safe counts of legacy POST/GET and `?list=` loads (no IDs, customer content, query strings or capability URLs). Use an authorized aggregate key count/TTL search for `formatted-list:*` after expiry; do not read record contents. Confirm no unexpired keys, no continuing writers and no unexplained callers. Agree on an expired-link response before removing GET/loader/helpers. None of that production telemetry/data work was performed here.
4. **Compressed links:** `#formatted=` versions 1-4 and `#input=` have no server TTL and fragments do not reach HTTP logs. Retain until owners approve an explicit end-of-support policy with client version-only telemetry or an inventory of distributed links. Current v5 Copy Link remains active.
5. **Old Saved Pull List fields:** Missing print state, `customer.contact`, old pricing rows and exact UUID/printing intent remain normalization contracts. Autosave can extend old jobs' life; use a measured migration/version policy plus a complete 30-day no-old-writes window before removing normalizers.
6. **Redis aliases:** Keep whole-pair fallback precedence until configuration-name-only audits prove no deployed environment/runner uses older pairs. Never select a read-only token as a writable replacement.

## Dependency and generation audit

| Manifest dependency | Proven consumer | Decision |
| --- | --- | --- |
| Root `@upstash/redis` | `api/_redis.ts`, repository tests | Keep runtime dependency |
| Root `@vercel/blob` | Both manifest routes and refresh builders | Keep runtime dependency |
| Root `fflate` | Both refresh builders, `src/mtgjson-live-pricing.ts` | Keep runtime/browser dependency |
| Root `keyrune`, `lucide-react`, `react`, `react-dom` | Pricing CSS/fonts and React/icon/portal UI imports | Keep |
| Root `lz-string` | `src/share-link.ts` | Keep independent root consumer |
| Root `@vitejs/plugin-react`, `vite`, `typescript` | Vite config, dev/build/preview, `tsc`, ESM tests | Build/development packages currently in `dependencies`; defer manifest-only reclassification until deployment/install policy is verified |
| Root `@types/node`, `@types/react`, `@types/react-dom` | TypeScript and TSX declarations | Keep dev dependencies |
| Nested `dotenv`, `imapflow`, `mailparser` | `config.js`, `index.js` | Keep active runner dependencies |
| Nested `lz-string` | `src/share-link.js` including active dry-run input link | Keep; independently installed GitHub package cannot rely on root installation |
| Nested `tsx` | `once`, `watch`, `dry-run`; imports root formatter TypeScript | Keep runtime runner dependency |
| Transitive root `esbuild` | Both generation commands and test loaders; resolved through Vite | Not dead; explicit direct dev declaration is a separate dependency hygiene task |

No dependency removed, no manifest/lockfile changed, and no package installed. Root scripts remain `dev`, `typecheck`, `build:server-formatter`, `build:server-pricing`, `build`, `test`, `preview`; nested scripts remain `test`, `once`, `watch`, `dry-run`, `check`. All point at retained files.

`src/formatter.ts` is the formatter source of truth: `npm run build:server-formatter` generates `server/generated/server-formatter.mjs`. `src/pricing.ts` is the pricing source of truth: `npm run build:server-pricing` generates `server/generated/server-pricing.mjs`. Both use esbuild bundle/platform=node/format=esm, and root `test` and `build` regenerate both first. Keep these libraries outside `/api`, where each deployable file can consume a Vercel Function slot. Declaration files are maintained separately. The original baseline hashes below are unchanged by relocation; do not hand-edit generated output.

| File | Bytes | SHA-256 |
| --- | --- | --- |
| `server/generated/server-formatter.mjs` | 72,547 | `935972CC0F25473536E5B6390413C8BEFBA33ABEC5DE8370490FE1E76E2640B1` |
| `server/generated/server-pricing.mjs` | 38,717 | `693F99486DE5FAE6A433CD952EFE479DB5B9D8131598274BAB65BF577EC2B997` |

Scryfall's normal/careful request intervals (120/500 ms), abort/retry/cache paths and MTGJSON promise caches remain untouched. Index builders, manifest paths, v6 pricing-schema fallback and Vercel crons remain untouched.

## Security findings requiring separate work

- **High priority: Saved Pull List APIs have no application authentication.** `api/pull-list-jobs.ts` contains an Entra TODO; GET/create/update/delete/recent/search and narrow print status do not require a staff session. `test/pull-list-job.test.mjs` explicitly verifies this. History `89ab8b46d099d78843850136cba8f288f97bed48` removed `_staff-auth.ts` / `staff-session.ts` on August 23. README's passcode/session claims were stale; those environment names have zero executable consumers.
- Public exact loads return complete jobs, including customer name/phone/email, original email display, pricing state and stored `emailDisplay.checkEmailNowUrl`. The latter can carry the dispatch capability secret. Random job IDs and hashed search indexes are not authorization, and recent/search expose discoverable summaries. Signed Teams actions protect only their own route; they do not protect the public job API. Deployment-level protection is not proven by this audit.
- **High priority: `/api/send-test-teams` has no inbound authentication or origin restriction and allows wildcard CORS.** Its server-side write secret authenticates the outgoing ingest request, not the caller. Retain the diagnostic/shared renderer for setup, but separately protect both page and API and review abuse controls before treating it as staff-only.
- `vite.config.ts` proxies local development **and preview** Saved Pull List calls to production. The local `/teams-test` UI explicitly chooses the production API origin. Use intercepted synthetic APIs/in-memory Redis for UI QA; do not use ordinary local UI persistence/testing as an isolated environment.
- Review authorization for job read/write/search/delete/print; protect diagnostic posting; review capability storage/return boundaries and refresh diagnostics in a separate scoped security task. Do not expand Graph permissions or install authentication as cleanup. No live protection, secret, workflow or data was changed.

## Regression coverage and limits

Retained test families cover manual parsing and metadata/provider behavior (`formatter`), pricing/exact printing/catalog recovery (`pricing*`, `exact-printing-search`, `printing-normalization`), generated sample exclusion, customer/document title/workspace state, Saved Pull List CRUD/search/TTL/autosave/duplicate/delete (`pull-list-job`, picker/session/diagnostics), both print statuses and UI (`print-status-ui`, `pull-list-print-status-sync`), Teams initial claims/callback/signed actions/update acknowledgement and failures (`teams-actions`, `email-teams-api`), old/new shared links (`share-link`, browser wiring assertions), Redis aliases, MIME ingestion and duplicate/revised jobs (root and nested email suites), Graph metadata/auth tests, and native server import/runtime tests.

`test/saved-pull-list-server-esm-imports.test.mjs` validates explicit server `.js` import graphs including Graph. `test/teams-server-esm-runtime.test.mjs` executes unbundled native Node imports for 13 separate application modules with external boundaries stubbed. Graph request tests use an esbuild test bundle; the native runtime execution list does not independently execute Graph. Generated modules remain explicit test inputs.

These are local automated checks, not a fresh interactive browser session, physical printing, live Redis Lua validation, live mailbox ingestion, GitHub dispatch, or Teams post/update proof. Index builders are built/typechecked; no production refresh was triggered. Runtime source is unchanged, so this pass preserves existing coverage and its limitations rather than claiming new end-to-end deployment proof.

## Cleanup decisions and final validation

Classification above preceded artifact deletion and documentation corrections. No files are staged.

### Actual changes

- Deleted only `foundation.patch` (129,796 bytes). It was an unconsumed UTF-16 patch across 12 already existing source/generated/test paths. History `ee3d75421a69a9eb61bd53f141d927ae8a8295da` and current canonical code semantically supersede its printing-intent work; this is not a claim of byte-identical historical patch application. Retained formatter, pricing, printing-normalization and share-link tests prove the canonical behavior remains.
- Moved `docs/TEAMS-IMPLEMENTATION-REPORT.md` to `docs/archive/TEAMS-IMPLEMENTATION-REPORT.md`. Added an archive banner, qualified the original pre-commit statement, and changed its operational guide target to `../TEAMS-WORKFLOW.md`. The remaining historical body matches the original after accounting for these changes and line endings. There were no pre-existing external document links to its old path; the new README/Teams guide link to the archive. Its historical changed-file list intentionally retains the former path.
- Corrected `README.md`, `docs/MICROSOFT-GRAPH.md`, `docs/SAVED-PULL-LISTS.md`, `docs/TEAMS-WORKFLOW.md`, and `tools/test/email-to-teams/README.md`: connected IMAP path, limited Graph role, main/deployment mismatch, auth truth, shared renderer, acknowledgement/retry limits, local production proxy, and legacy retention. Removed duplicated configuration lists in favor of the new canonical inventory.
- Added `docs/ENVIRONMENT-VARIABLES.md` and this audit. Reviewed `AGENTS.md`, `docs/PRINTING-MODEL.md`, and the local `.env.example`; their instructions/contracts/names remain applicable and unchanged.
- Renamed no executable file or folder. Removed no dependency. Changed no runtime, test, manifest, lockfile, workflow, generated output, CSS or asset file. No version/date field was bumped; dates in this audit identify the observation, not a product release.

### Baseline versus final command results

| Command / check | Baseline | Final |
| --- | --- | --- |
| Root `npm test` | Exit 0; 275 passed, 0 failed, 0 skipped | Exit 0; 275 passed, 0 failed, 0 skipped; 13 native unbundled application modules loaded |
| Root `npm run typecheck` | Exit 0 | Exit 0 |
| Root `npm run build` | Exit 0; 1,718 modules transformed | Exit 0; 1,718 modules transformed; same emitted asset filenames |
| Email tool `npm test` in retained `tools/test/email-to-teams` | Exit 0; 12 passed, 0 failed, 0 skipped | Exit 0; 12 passed, 0 failed, 0 skipped |
| Email tool `npm run check` | Exit 0 | Exit 0; all eight retained JS files checked |
| `git diff --check` | Exit 0 | Exit 0; only normal LF/CRLF conversion advisories, no whitespace errors |
| `git status --short` | Exit 0; empty | Exit 0; exactly the ten paths shown below (archive directory expanded); nothing staged |
| `git diff --stat` | Not applicable before changes | Exit 0; 7 tracked paths, 95 insertions, 274 deletions, including binary patch deletion; excludes the three untracked additions |
| `git diff` | Not applicable before changes | Exit 0; reviewed tracked diff, with new audit/inventory/archive inspected separately |
| Deleted/renamed-path search with `rg` | No consumer of `foundation.patch` | Matches only this audit's deletion/staging record and archived report's historical original path; no broken operational consumer |
| Removed-dependency import search | All manifest dependencies have consumers | No dependency removed; executable/manifests diff assertion empty |
| Stale environment/documentation search | Found false staff-gate and legacy/test integration claims | Obsolete staff names occur only as explicitly inactive inventory entries; old pre-commit claims are scoped to archived history |
| Fresh generated comparison / `git diff --exit-code -- api/server-formatter.mjs api/server-pricing.mjs` | Baseline hashes above; no Git diff | Exit 0; both outputs byte-identical to baseline and independent in-memory esbuild rebuild |
| Local Markdown target and env inventory scan (Node, no installation) | Not required | Exit 0; 37 relative links resolve, all 42 discovered executable environment names documented, zero runtime/dependency changes, zero staged files |
| GitHub workflow syntax tool availability | `actionlint` absent; installed `yaml`/`js-yaml` absent | Dedicated syntax validation unavailable; none installed. Workflow unchanged, paths/scripts manually verified, GitHub metadata reports workflow active. This does not replace a syntax validator. |

Test counts changed by **zero**. No tests were added or removed: the only deleted file was a nonexecuted patch, and all canonical replacement/compatibility tests remain. Expected negative-case Teams diagnostic warnings appeared in the root suite in both baseline and final runs; they are mock failure-path coverage, not live errors.

Final unstaged paths:

```text
 M README.md
 M docs/MICROSOFT-GRAPH.md
 M docs/SAVED-PULL-LISTS.md
 D docs/TEAMS-IMPLEMENTATION-REPORT.md
 M docs/TEAMS-WORKFLOW.md
 D foundation.patch
 M tools/test/email-to-teams/README.md
?? docs/ENVIRONMENT-VARIABLES.md
?? docs/REPOSITORY-CLEANUP-AUDIT.md
?? docs/archive/TEAMS-IMPLEMENTATION-REPORT.md
```

### Suggested commit grouping and exact stage set (not executed)

One cohesive commit is recommended: **Document active repository paths and remove obsolete patch artifact**. Keeping the documentation links, audit and report move together avoids an intermediate commit with missing document targets. Stage exactly these paths, including both sides of the report move and the deleted patch:

```text
README.md
docs/ENVIRONMENT-VARIABLES.md
docs/MICROSOFT-GRAPH.md
docs/REPOSITORY-CLEANUP-AUDIT.md
docs/SAVED-PULL-LISTS.md
docs/TEAMS-IMPLEMENTATION-REPORT.md
docs/TEAMS-WORKFLOW.md
docs/archive/TEAMS-IMPLEMENTATION-REPORT.md
foundation.patch
tools/test/email-to-teams/README.md
```

Do not include generated modules, manifests, lockfiles, API/browser code, environment files, or external configuration in that stage set. HEAD and the index remain unchanged. Deferred work belongs in separately scoped tasks: deployment packaging, customer-data/diagnostic authorization, external Teams wiring verification, measured legacy-link sunset, any future complete Graph migration, verified tool-folder rename, and optional helper/CSS/asset/dependency-section pruning.

### Recommendation

**Ship the reviewed documentation/artifact cleanup as a future commit; do not deploy this branch as a production release yet.** The baseline main deployment already fails the platform function limit and the canonical host serves older code. Resolve that packaging/deployment issue in a separate task without deleting live Graph/compatibility functions. Verify Teams wiring and address the documented authentication exposure separately. This pass neither fixes nor worsens those existing runtime issues.

## Deployment repair: generated libraries outside API

This separately requested repair began on `chore/repository-cleanup-2026-09-07` at unchanged HEAD `071cc03d5c9dc19be542c2616a45dca518b88ede`, with exactly the ten intentional cleanup paths listed above. `AGENTS.md`, this audit and the environment inventory were read before repair edits. The branch/status/stat/last-three-commits checks matched that baseline. No files were staged, committed, pushed or deployed.

### Verified Function count

The authenticated Vercel CLI was already linked to this project. The first `npx --yes vercel@latest build` exited 1 with `project_settings_required` before compilation because the existing local link lacked cached build settings. No login, environment pull or relink was performed. A read-only project API request supplied only an allowlist of non-secret build settings for local validation; `.vercel/project.json` was temporarily supplemented for each build and restored byte-for-byte afterward. Remote settings and environment variables were unchanged. Vercel CLI 59.11.7 ran through the temporary npm cache, with no permanent dependency added.

Both the baseline and final local `npx --yes vercel@latest build` then exited 0. The baseline emitted **13 Functions**, including both generated libraries; the repaired build emits **11 Functions**. Local build success alone does not enforce the account's deployment limit: the emitted output supplies the count evidence.

Every path below is relative to the repository root. No other `.func` directory was emitted.

| Emitted Function path | Baseline | Final |
| --- | --- | --- |
| `.vercel/output/functions/api/check-email-now.func` | Present | Present |
| `.vercel/output/functions/api/formatted-lists.func` | Present | Present |
| `.vercel/output/functions/api/graph-mail-smoke.func` | Present | Present |
| `.vercel/output/functions/api/mtgjson-index.func` | Present | Present |
| `.vercel/output/functions/api/mtgjson-pricing-index.func` | Present | Present |
| `.vercel/output/functions/api/pull-list-jobs.func` | Present | Present |
| `.vercel/output/functions/api/refresh-mtgjson-index.func` | Present | Present |
| `.vercel/output/functions/api/refresh-mtgjson-pricing-index.func` | Present | Present |
| `.vercel/output/functions/api/send-test-teams.func` | Present | Present |
| `.vercel/output/functions/api/server-formatter.func` | Present: generated library | Absent |
| `.vercel/output/functions/api/server-pricing.func` | Present: generated library | Absent |
| `.vercel/output/functions/api/tcgplayer-listed-median.func` | Present | Present |
| `.vercel/output/functions/api/teams-actions.func` | Present | Present |

All 11 legitimate Functions retain their baseline handler paths and `nodejs24.x` runtime. Both refresh Functions retain `maxDuration: 300`; `vercel.json` is unchanged. The diagnostic Function contains `server/generated/server-formatter.mjs` inside its own emitted bundle. Its packaged `api/send-test-teams.js` imported successfully under native Node ESM, and a synthetic missing-configuration POST returned the expected 500 with all network access forbidden. There are no old-path proxy/re-export files and no Functions for `/api/server-formatter` or `/api/server-pricing`. Pricing remains an importable generated test library and is not an HTTP route.

### Exact repair changes

| File or move | Change |
| --- | --- |
| `api/server-formatter.mjs` -> `server/generated/server-formatter.mjs` | Regenerated from unchanged `src/formatter.ts`; byte-identical, 72,547 bytes, same 16 exports. |
| `api/server-pricing.mjs` -> `server/generated/server-pricing.mjs` | Regenerated from unchanged `src/pricing.ts`; byte-identical, 38,717 bytes, same 64 exports. |
| `api/server-formatter.d.ts` -> `server/generated/server-formatter.d.ts` | Moved unchanged beside the formatter bundle; 185 bytes. No TypeScript configuration change required. |
| `package.json` | Only the two esbuild `--outfile` paths changed. Source files, Node/ESM flags and generation-before-test/build order are unchanged. |
| `api/send-test-teams.ts` | Formatter import changed from `./server-formatter.mjs` to `../server/generated/server-formatter.mjs`. |
| `test/email-normalization.test.mjs`, `test/formatter.test.mjs` | Formatter imports changed from `../api/server-formatter.mjs` to `../server/generated/server-formatter.mjs`. |
| `test/pricing.test.mjs`, `test/share-link.test.mjs` | Pricing imports changed from `../api/server-pricing.mjs` to `../server/generated/server-pricing.mjs`. |
| `tools/test/email-to-teams/test/email-normalization.test.js` | Formatter import changed from `../../../../api/server-formatter.mjs` to `../../../../server/generated/server-formatter.mjs`. |
| `test/teams-server-esm-runtime.test.mjs` | Added the existing diagnostic route to native unbundled graph/runtime checks; requires the relocated formatter and validates diagnostic exports without network calls. The generic graph walker already supports modules outside `api/`. |
| `test/generated-server-layout.test.mjs` | Added three relative-path tests for old-path absence/new-file existence, generation settings/output paths, and available library exports without HTTP handlers. |
| `README.md` | Updated only its generated-code paragraph relative to the cleanup baseline. |
| `docs/REPOSITORY-CLEANUP-AUDIT.md` | Updated generated paths, count explanation and generation guidance, and appended this separate repair report. Earlier cleanup findings/results remain historical evidence. |

No other application source, test consumer or build script refers to the old generated locations. Old-path text remains only in historical verification records and this move/staging inventory; the structure test intentionally checks their absence. Existing Graph/native-import tests were retained. No dependency, lockfile content, endpoint URL, workflow, duration, retention rule, pricing/parser logic, Scryfall protection, browser source or asset was changed. Vercel's install step touched the root lockfile's working-file state: Git may report it modified, but `git diff -- package-lock.json` is empty and its normalized Git blob still matches the index (`dbdd45219a74de913e45c50ee6de7c1ef157793f`). Exclude it from the repair staging set.

### Repair baseline versus final validation

| Command / check | Baseline | Final |
| --- | --- | --- |
| Root `npm test` | Exit 0; 275 passed, 0 failed, 0 skipped | Exit 0; 278 passed, 0 failed, 0 skipped |
| Root `npm run typecheck` | Exit 0 | Exit 0 |
| Root `npm run build` | Exit 0; 1,718 modules | Exit 0; 1,718 modules; all 15 `dist/` files byte-identical to baseline |
| Email `npm test` in `tools/test/email-to-teams` | Exit 0; 12 passed, 0 failed, 0 skipped | Exit 0; 12 passed, 0 failed, 0 skipped |
| Email `npm run check` | Exit 0 | Exit 0; eight JS files checked |
| Local `npx --yes vercel@latest build`, with cached non-secret settings | Exit 0; 13 emitted Functions | Exit 0; 11 emitted Functions |
| Native unbundled server runtime suite | 13 application modules | 15 application modules; diagnostic route and generated formatter added, no tests removed |
| Additional `npm run build:server-formatter` and `npm run build:server-pricing` | Baseline outputs preserved for comparison | Both exit 0; byte equality and complete export-name parity against original files |
| Emitted Function inspection and packaged diagnostic import (Node assertions) | 13-path inventory captured | Exit 0; exactly the baseline set minus two library Functions; all retained handlers/runtime/durations match |
| `git diff --check` | Earlier cleanup passed | Exit 0; no whitespace errors |
| `git status --short`, `git diff --stat`, `git diff` and new-file review | Ten intentional cleanup paths | Reviewed expected cleanup and repair paths; lockfile has no content diff; nothing staged |
| Old generated-path/import/output search | Consumers mapped before edits | No executable old-path import or generation destination remains |
| Cleanup/configuration preservation assertions | Existing cleanup files and local link snapshotted | Exit 0; all eight untouched cleanup paths byte-identical or still deleted, README/audit changes confined to repair documentation; `.vercel/project.json` and `.gitignore` byte-identical; index and HEAD unchanged |

The root count increased by exactly **three** new structure/export tests; no test was removed or weakened. The email count is unchanged. The formatter/pricing SHA-256 values in the generation table above remain unchanged after relocation and the additional generation pass. The moved declaration's SHA-256 remains `001D04622C8F64BF83038E97021F28EAD4031E44C236ED1FE71B3057DB3F0B8F`. Byte-identical browser artifacts confirm these generated server modules were not added to the browser build.

### Recommendation and separate suggested staging set

**Ship this narrow deployment repair after review.** The reproduced 13-Function packaging cause is fixed locally at 11, leaving one slot under the reported 12-Function limit. Future deployable files under `api/` could cross that limit again. A hosted deployment and live mailbox/Teams flows remain unverified because deployment was not authorized; this repair does not resolve or expand the previously documented authentication and external-workflow findings.

Suggested commit: **Move generated server libraries outside Vercel API routes**. These are the exact 17 paths for the repair, including both sides of each move:

```text
api/server-formatter.mjs
api/server-formatter.d.ts
api/server-pricing.mjs
server/generated/server-formatter.mjs
server/generated/server-formatter.d.ts
server/generated/server-pricing.mjs
api/send-test-teams.ts
package.json
test/email-normalization.test.mjs
test/formatter.test.mjs
test/pricing.test.mjs
test/share-link.test.mjs
test/teams-server-esm-runtime.test.mjs
test/generated-server-layout.test.mjs
tools/test/email-to-teams/test/email-normalization.test.js
README.md
docs/REPOSITORY-CLEANUP-AUDIT.md
```

This is a staging plan, not an executed command. README and this audit also contain the earlier cleanup work, and the audit is currently untracked. For separate commits, first stage the original cleanup versions/hunks, then the repair additions listed here; staging these two entire current documents before separating the cleanup would mix the tasks. Leave the other eight cleanup paths out of the repair commit. Do not stage the unchanged-content lockfile, `.vercel/`, temporary build metadata, environment files or external configuration. No staging, commit, push or deployment was performed.

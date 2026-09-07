# Saved Pull Lists

A Saved Pull List is a resumable working session. It is distinct from both a customer and a Copy Link.

This document describes the checked-in implementation at `071cc03`. At the cleanup audit, the canonical Vercel production alias still served `878647f`: deployment of `071cc03` failed the function-count limit. The new email/Teams job integration therefore must not be assumed live. See the [repository audit](REPOSITORY-CLEANUP-AUDIT.md) for deployment evidence and release blockers.

## Data and lifecycle

The structured customer record contains human-formatted `name`, `phone`, and `email` fields. Compatibility normalization extracts clear phone/email values from older `customer.contact` records and retains unclassifiable legacy text without guessing.

Each pull-list job has an independent random ID, created/updated/processed/expiration timestamps, customer, input, output, compact formatter items, formatter statistics, Saved Pricing State, last-initiated Pull List/Pricing print timestamps, source, exact duplicate fingerprint, and normalized search fields. Email jobs also retain the original cleaned email display content and may have Teams post-claim, team/channel/conversation/message identity, link, and posted-at metadata. Browser creation and autosave cannot supply or replace those protected email/Teams fields. A successful Process List run creates the manual job; later coherent formatter, customer, Pricing Assistant, or print-status changes autosave after 750 ms. Standalone Add Card work does not create a job by itself.

**Print Pull List** and **Print Pricing** record their respective timestamps only after a print window opens, its document is created, and Pullsmith is about to invoke the browser print flow. A blocked print window records nothing. The timestamps describe the latest initiated browser print attempt; a browser cannot verify whether staff completed or canceled the operating-system dialog or whether physical paper printed. Reprinting replaces only the corresponding timestamp. A fresh successful **Process List** or reprocess clears both indicators, while ordinary pricing edits, Found states, customer fields, quantities, and selections leave them intact.

Jobs and their active secondary indexes expire 30 days after the latest meaningful successful save. Updating a job refreshes its job, current fingerprint, recent, and applicable exact customer-index TTLs. Queries prune expired or missing index members.

Each Saved Pull List can also be permanently deleted one at a time from the Recent/Search picker. Manual deletion requires explicit confirmation and removes the job object, its owned duplicate-fingerprint mapping, Recent membership, exact customer-name membership, every customer-name prefix membership, and exact phone/email memberships. This is additive to the existing 30-day expiration policy; it does not change retention timing.

**New List** clears the local workspace, current job identity, customer, formatter state, every pricing row, and both local print timestamps. It never deletes the persisted job. Saved work clears immediately; dirty, stale, saving, or failed work asks for confirmation.

## Exact duplicate protection

The server computes a deterministic SHA-256 fingerprint from sorted, grouped processed card requests. Identity includes canonical card, grouped requested quantity, explicit requested set, Finish, foil technology, visual Treatment, and meaningful requested flavor/reskin. It ignores raw paste formatting, line order, capitalization/punctuation, and customer identity.

Redis maps the fingerprint directly to one unexpired job ID. A match to another active job returns a compact summary and prevents a second record; a match to the current job updates normally. Changed jobs release their prior mapping when it is still owned by that job. Stale mappings are removed when the referenced job is missing, expired, or has a different fingerprint.

## Saved Pull Lists picker and API

The small arrow immediately beside **Customer** opens an anchored Saved Pull Lists picker. It shows the 15 most recently updated unexpired jobs, newest first. One field searches a normalized customer-name prefix or an exact normalized phone/email value after a 300 ms debounce. Prefix matching starts at the beginning of the normalized full name, so `john` matches both John Smith and Johnny Appleseed without fuzzy typo matching. Name prefix indexes and exact phone/email indexes use hashed Redis lookup tokens; the browser receives compact job summaries rather than complete private pricing payloads. Recent/Search rows show compact, noninteractive Printer and DollarSign status badges immediately before Delete when those print flows have been used; their tooltips and accessible labels include the saved timestamp. Old jobs without the additive fields show no fake badges or fallback dates.

Each result remains a separate pull-list job even when several belong to the same customer. **Open** uses the same loader as direct `?job=` URLs and duplicate-warning actions. Dirty, stale, saving, or failed local work requires confirmation before replacement. This confirmation protects unsaved local work; it does not authenticate the caller. A successful load restores customer fields, formatter state, all persisted Pricing Assistant work, and current job identity so autosave continues. Escape, outside click, or a successful Open closes the picker.

The compact red trash action beside **Open** asks staff to confirm the specific list and warns that deletion cannot be undone. Deleting an ordinary, noncurrent result removes that row after the server confirms deletion and leaves the current workspace untouched. Deleting the currently open job also preserves the complete visible local workspace, but detaches it from the deleted server record: the current job ID and `?job=` URL parameter are removed and the save state becomes **Not saved**. Current-job deletion is blocked while a save request is active, and queued/debounced persistence is invalidated so a stale save cannot recreate the deleted record. Later processing follows the normal new-job creation path with a new ID.

`/api/pull-list-jobs` currently has no application-level authentication requirement for exact job loading, create/update/delete, recent summaries, normalized name-prefix lookup, or exact normalized phone/email lookup. The former staff passcode/session gate was removed in `89ab8b4`; the current Microsoft Entra ID TODO is not an implemented boundary. Same-origin credentials and the narrow print-status route's origin/JSON checks do not authenticate a user. Deployment-level protection was not established by the audit.

This is a high-priority security gap. Recent/Search exposes customer summaries, and exact load returns the complete job, including customer contact details, formatter and pricing state, and any stored original email/Teams metadata. The checked-in email model also retains `emailDisplay.checkEmailNowUrl`, which may contain a trigger secret or other capability. Hashed search-index keys do not restrict API access. A separate security task must verify deployment protection and establish an authenticated boundary for these reads and writes; this cleanup does not add authentication.

When Diagnostics is enabled, Pullsmith also shows a session-only Saved Pull List request report for persistence troubleshooting. It retains the five newest API outcomes without storing customer data, request payloads, or credentials.

## Redis deployment configuration

Saved Pull Lists and the legacy formatted-list API share the Upstash REST configuration helper in `api/_redis.ts`. It selects a complete URL/write-token pair, preferring the Pullsmith integration and retaining standard Upstash and legacy integration fallbacks. Read-only tokens are not used for persistence. The canonical [environment-variable inventory](ENVIRONMENT-VARIABLES.md) records the consumed names, precedence, environments, and obsolete staff-auth variables without values.

A newly provisioned Redis database begins with no historical Saved Pull Lists. Empty Recent/Search results are expected until new jobs are processed and saved.

For local QA, `vite.config.ts` proxies `/api/pull-list-jobs` to the production origin in both dev and preview. The localhost `/teams-test` page also calls the production API directly. Use isolated local routing or intercepted API requests for synthetic browser checks so ordinary saves, deletes, and diagnostic posts do not modify production.

## Saved Pull List versus Copy Link

- Saved Pull List load restores the exact staff Pricing Assistant working state and then rehydrates current external catalogs/prices.
- Copy Link shares processed formatter identity/intent and deliberately starts a fresh Pricing Assistant without print-status metadata.

## Email, Teams, and legacy links

The connected mailbox runner is `tools/test/email-to-teams`, executed by GitHub Actions through IMAP. Its checked-in flow creates or reuses a Saved Pull List through the protected ingestion action before sending the initial Teams card with a `?job=` link. Exact duplicate ingestion reuses the existing job and preserves its pricing, print status, and original email; revised card requests can create a distinct job. Microsoft Graph remains a separate read-only mailbox smoke test, with no connected Graph ingestion replacement. See [Microsoft Graph status](MICROSOFT-GRAPH.md).

External Microsoft Workflows post the initial card, register its message identity, and update that same card after persisted print-status changes. `printStatus` remains the status source; a Teams update failure does not roll back a saved print timestamp. Signed Teams actions and **Check Email Now** are described in [Teams workflow operations](TEAMS-WORKFLOW.md). Their live wiring and deployment must be verified separately from the checked-in implementation.

Legacy `/api/formatted-lists` and `?list=` links remain supported, along with compressed `#input=` and older `#formatted=` links. The legacy API still exposes its secret-protected POST writer; it is not a read-only route. At the audited production revision, email and diagnostic posts still create legacy records. Keep these paths until the [audit's compatibility sunset criteria](REPOSITORY-CLEANUP-AUDIT.md) are satisfied. The 30-day record TTL does not expire compressed links, and does not establish a removal date while legacy writers remain active.

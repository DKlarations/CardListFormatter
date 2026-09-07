# CardListFormatter / Mike Pullsmith

Pullsmith turns a customer Magic: The Gathering list into a printable pull list, then helps staff record found cards, preserve requested printing details, price them, and print the priced result.

## Store workflow

1. Paste or import a customer list and **Process List**.
2. Print the pull list, mark cards found, select printing details, and price them.
3. Print the priced result, resume a Saved Pull List later, or use **Copy Link** to share the processed formatter result with fresh pricing work.

Input and output sit side by side on desktop and stack on narrow screens. Pricing Assistant also supports standalone **Add Card** quick pricing without processing a list first. Its normal Printing menu searches sets; Exact Printing Search selects physical editions by collector number, artist, finish/treatment and stable UUID.

Successful processing creates or updates a Saved Pull List. Customer, formatter and Pricing Assistant changes autosave after 750 ms. The picker supports recent lists, customer name/phone/email search, open and confirmed delete. Saved jobs retain work for 30 days from their latest meaningful update. Both print indicators record the latest initiated browser print flow; they cannot confirm physical printing. Standalone quick pricing stays transient. See [Saved Pull Lists](docs/SAVED-PULL-LISTS.md) and the [printing model](docs/PRINTING-MODEL.md).

## Current architecture

- `index.html` loads the React/TypeScript browser app in `src/main.tsx`; Vite builds it. Pricing Assistant and its live MTGJSON fallback are loaded dynamically.
- `src/formatter.ts` owns parsing, resolution and output. `src/pricing.ts` owns pure pricing/printing selection; `src/PricingPanel.tsx` owns its UI and state. MTGJSON indexes, Scryfall caching/throttling and TCGplayer pricing remain separate provider paths.
- Vercel `api/` routes provide Saved Pull Lists, legacy formatted lists, pricing/index services, Teams actions and operational diagnostics. `api/_pull-list-job-repository.ts` stores jobs, duplicate fingerprints and search indexes in Redis.
- `.github/workflows/email-to-teams.yml` schedules and manually dispatches the **IMAP** runner in `tools/test/email-to-teams`. The historical folder name does not make it test-only. At the checked-in revision, it normalizes mail through the shared formatter, creates/reuses a job through protected Teams ingestion, and sends an initial card to an external Microsoft Workflow.
- `shared/pull-list-teams-card.mjs` is the common initial/update/diagnostic card renderer. External Teams Workflows must claim the initial post, register the original message, and update that same card when print status changes. **Check Email Now** dispatches the IMAP GitHub workflow. See the [Teams setup and recovery contract](docs/TEAMS-WORKFLOW.md).
- Microsoft Graph is staged, read-only smoke tooling. It reads at most three Inbox metadata records; it does not ingest, deduplicate, mark mail, create jobs or post cards. There is no connected Graph mailbox replacement in this repository. See [Microsoft Graph status](docs/MICROSOFT-GRAPH.md).
- Current email links use `?job=`. Legacy `?list=`, `#input=` and old formatted hash links remain supported. `src/share-link.ts` creates current formatter-only links; Saved Pull Lists separately retain exact pricing work.

Deployment evidence from the September 7 cleanup audit: main contains `071cc03`, but its Vercel production deployment failed the account's function-count limit. The canonical production alias still resolves to READY revision `878647f`, whose email/diagnostic flow creates legacy formatted lists. Checked-in job ingestion and original-card synchronization must not be described as verified live. The [cleanup audit](docs/REPOSITORY-CLEANUP-AUDIT.md) records the evidence, full file map, compatibility sunset gates and deferred work.

## Access and operational boundaries

**Saved Pull List APIs currently have no application-level staff authentication.** They can return customer contact information, original email, pricing state and stored Check Email capability URLs, and allow create/update/delete/search/print-status operations. The old staff passcode/session variables have no executable consumers; the Entra TODO is not authentication. Deployment-level protection was not proven in this audit. Address this as a separate priority security task.

`/teams-test` remains an operational setup page using the shared production card renderer. Its `/api/send-test-teams` API has no inbound authentication in checked-in code; server secrets authorize its outgoing calls only. Sending a test creates records and posts to the configured Teams destination. Use synthetic content only in an explicitly planned operational test.

Local development and preview proxy Saved Pull List API calls to production, and the localhost Teams test page explicitly targets production. Isolate or intercept these boundaries for browser QA. A local Vite page is not an isolated data environment.

## Development and generated files

Follow [AGENTS.md](AGENTS.md). Root commands:

```bash
npm run dev
npm test
npm run typecheck
npm run build
npm run preview
```

Run `npm test`, `npm run typecheck`, and `npm run build` before handing off a change. For email changes, also run `npm test` and `npm run check` in `tools/test/email-to-teams`.

`npm run build:server-formatter` bundles the formatter source of truth, `src/formatter.ts`, to committed `server/generated/server-formatter.mjs`, which the diagnostic API imports at runtime. `npm run build:server-pricing` bundles the pricing source of truth, `src/pricing.ts`, to committed `server/generated/server-pricing.mjs`, used by tests. Root test/build scripts regenerate both with esbuild's Node platform and ESM format. Keep generated server libraries outside `/api`: each deployable file there can consume a Vercel Function slot. Do not hand-edit generated output; retain `server/generated/server-formatter.d.ts` beside the formatter bundle and the separate shared-card type declaration.

The canonical [environment-variable inventory](docs/ENVIRONMENT-VARIABLES.md) lists names, consumers, environments and active/deprecated status without configured values. Keep secrets out of source, browser bundles, logs and documentation. The [email runner guide](tools/test/email-to-teams/README.md) covers its commands; the [archived Teams implementation report](docs/archive/TEAMS-IMPLEMENTATION-REPORT.md) is historical evidence, not current deployment status.

# CardListFormatter

CardListFormatter turns a customer Magic: The Gathering pull list into a readable, printable work list, then helps staff record what was found, select its printing details, price it, and print the priced result.

## Workflow

1. Paste or import a customer list.
2. Parse and resolve cards.
3. Create a printable pull list.
4. Mark cards found.
5. Select printing details.
6. Price cards.
7. Print the priced result or copy a link to the processed pull list for a fresh pricing session.

Input Text and Output Text use a side-by-side desktop workspace and automatically stack on narrow screens.

Pricing Assistant is also available as a standalone quick-pricing workspace: open **Add Card**, resolve a card, and use the normal printing and pricing controls without processing a pull list first.

Successful **Process List** runs create or update a private Saved Pull List working session. The compact Customer / Phone / Email row includes a small Saved Pull Lists picker for recent jobs and customer name/phone/email search, plus the current autosave state and **New List** action. Saved Pull Lists retain formatter and Pricing Assistant work for 30 days from the latest meaningful update and show compact badges for the latest initiated Pull List/Pricing print flows; browser/physical print completion cannot be verified, and a fresh process clears those indicators. Standalone quick-pricing work remains transient until a list is processed. See [docs/SAVED-PULL-LISTS.md](docs/SAVED-PULL-LISTS.md).

The normal Pricing Assistant **Printing** menu can be searched by set code or set name. **Exact Printing Search** remains the separate advanced tool for collector number, artist, finish/treatment, and exact physical selection.

## Technology

React, TypeScript, Vite, Vercel API routes, MTGJSON, Scryfall, and a TCGplayer pricing integration.

## Important files

- `src/formatter.ts` — pull-list parsing, resolution, enrichment, sorting, and printable output.
- `src/pricing.ts` — pure pricing, printing-selection, price-entry, and TCGplayer URL helpers.
- `src/PricingPanel.tsx` — Pricing Assistant state and UI.
- `src/share-link.ts` — compressed, versioned processed-formatter share state; pricing-session work is intentionally excluded.
- `src/pull-list-job.ts` — Saved Pull List schema, pricing-session normalization, summaries, and 30-day retention contract.
- `api/_pull-list-job-repository.ts` — Redis job, duplicate-fingerprint, recent-job, normalized name-prefix, and exact phone/email lookup indexes.
- `api/pull-list-jobs.ts` — staff-authorized exact load/save and compact search API.
- `src/printing-normalization.ts` — provider-record treatment normalization shared by price-index and fallback paths.
- `api/refresh-mtgjson-index.ts` — normal formatter MTGJSON index refresh.
- `api/refresh-mtgjson-pricing-index.ts` — UUID-keyed pricing index refresh.

## Development

Commands from `package.json`:

```bash
npm run dev
npm test
npm run typecheck
npm run build
npm run preview
```

Run `npm test`, `npm run typecheck`, and `npm run build` before handing off a change. Keep secrets in deployment configuration; do not place secret values in source, docs, or shared links.

Private Saved Pull List APIs use the temporary server-side `PULL_LIST_STAFF_PASSCODE` and signed-session `PULL_LIST_STAFF_SESSION_SECRET` environment variables. This early boundary is intentionally isolated so Microsoft Entra ID can replace it later.

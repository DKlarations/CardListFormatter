# CardListFormatter

CardListFormatter turns a customer Magic: The Gathering pull list into a readable, printable work list, then helps staff record what was found, select its printing details, price it, and print or share the priced result.

## Workflow

1. Paste or import a customer list.
2. Parse and resolve cards.
3. Create a printable pull list.
4. Mark cards found.
5. Select printing details.
6. Price cards.
7. Print or share the priced result.

## Technology

React, TypeScript, Vite, Vercel API routes, MTGJSON, Scryfall, and a TCGplayer pricing integration.

## Important files

- `src/formatter.ts` — pull-list parsing, resolution, enrichment, sorting, and printable output.
- `src/pricing.ts` — pure pricing, printing-selection, price-entry, and TCGplayer URL helpers.
- `src/PricingPanel.tsx` — Pricing Assistant state and UI.
- `src/share-link.ts` — compressed, versioned input/formatted/pricing share state.
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

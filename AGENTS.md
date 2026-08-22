# Working in this repository

- `src/formatter.ts` owns parsing, card resolution, and formatted-output behavior.
- Keep pure pricing and printing-selection logic in `src/pricing.ts` where practical; `src/PricingPanel.tsx` owns Pricing Assistant UI/state and should not duplicate it.
- MTGJSON index builders live in `api/`. Preserve Scryfall throttling and caching protections.
- Preserve customer-requested printing metadata through pricing; do not silently replace it with defaults. Prefer stable printing IDs (MTGJSON UUID) over display strings.
- Add regression tests for parser or pricing changes, including legacy persisted/shared data when a field is added.
- Before finishing, run `npm test`, `npm run typecheck`, and `npm run build`.
- Do not commit or push unless explicitly asked.

# Structured deck exports and bulk-miss safety

Local corrective pass, 2026-09-08, on `fix/structured-export-printing-metadata`, based on fetched `origin/main` / HEAD `877aeea7143c857d248d3b02b71b5d0fd0d2064d`. This pass carries forward the uncommitted [Scryfall retry-control work](SCRYFALL-RELIABILITY.md). Nothing was staged, committed, pushed, merged, deployed, or refreshed. The unrelated untracked `df` was not read or changed.

## Reproduced parsing defect

Before this pass, `1 Consecrated Sphinx (2X2) 43` became `inputName: "Consecrated Sphinx (2X2) 43"`, `lookupKey: "consecrated sphinx 2x2 43"`, and no requested printing preference. `1 Mox Diamond (V10) 10 *F*` similarly produced `inputName: "Mox Diamond (V10) 10 *F*"` and key `mox diamond v10 10 f`. The mojibake example retained the export suffix and normalized to `palantar of orthanc ltr 247`.

Quantity parsing worked. The existing metadata grammar recognized complete prose suffixes and tabular pricing rows, but had no anchored `(SET) COLLECTOR [*F*]` production. Its name-preserving behavior therefore left these suffixes inside the identity passed to exact MTGJSON lookup. This is distinct from the retry multiplication addressed in the preceding pass.

The corrected pipeline is: retain original row → remove quantity once → parse the complete raw export suffix from the right → cautiously repair recognized mojibake in the name only → preserve clean name and exact requested printing fields → form the existing accent-insensitive lookup key → exact MTGJSON resolution → carry the same printing preference into Pricing Assistant. Token colors and power/toughness also come only from the stripped name, never the set code or collector token.

## Grammar and printing intent

`src/structured-export.ts` provides the pure parser for `[quantity] NAME (SET) COLLECTOR [*F*]`. The final parenthetical candidate must contain 2–8 alphanumeric characters and be followed by a single collector token. Collector text retains letters, digits, leading zeroes, suffix letters, hyphens, periods, slashes, plus signs and supported star/special-number characters (`★ ☆ * † ‡ ∞`). The suffix is anchored to the end; unsupported trailing text is not silently consumed.

The greedy name capture retains earlier parentheses, so `B.F.M. (Big Furry Monster) (UGL) 28a` becomes `B.F.M. (Big Furry Monster)`. Commas, apostrophes, hyphens, colons and `//` separators remain part of the name. Bare trailing numbers and ordinary parenthetical text do not become imported collector hints. No card names are hard-coded.

Only a terminal, separate `*F*` marker, case-insensitively, means foil with standard foil treatment. Asterisks elsewhere in the name or collector number do not become foil markers. Imported foil still prints the existing `FOIL` pull instruction. Set and collector metadata do not add new text to the printed pull list.

The shared `RequestedPrintingPreference` is the single source of printing intent. It adds `collectorNumber` and `sourceFormat: "set-collector-export"` to the existing set/finish/treatment fields. Imported hints remain preferences for later pricing validation: they do not make an ordinary current-complete-v3 card require Scryfall history during initial formatting. Genuine prose foil/showcase/borderless/set requests, flavor verification, Case Check and selective pricing recovery retain their verification paths. An unavailable exact imported printing does not undo a valid name resolution.

Rows for the same name and identical imported printing combine quantities. Different set/collector/finish hints remain separate rows while sharing the clean name identity. Original source rows remain available on parsed items. Compact persistence keeps the small preference object and excludes raw provider print arrays. Saved pricing rows retain the collector text, source format and selected MTGJSON UUID; share links carry the same compact preference. Legacy records without these fields continue to load, and fingerprints without collector metadata retain their exact previous hashes.

## Pricing selection and fallback

Catalog selection prioritizes exact set + collector + requested finish, then the same collector with an available finish, then the requested set and finish, then the existing set/default and newest/default rules. Set and collector comparisons are case-insensitive; collector numbers are never converted to numbers or stripped of suffixes/zeroes. Equivalent candidates select a stable UUID deterministically.

When the requested finish is unavailable for that collector, the row warns that an available finish is selected. A missing collector warns that another collector in the requested set is selected; a missing set warns that the available default set is selected. The card remains resolved. These are catalog decisions, not triggers for formatter-wide provider recovery. Staff changes to Set, Finish, Treatment or Art are marked manual and remain authoritative through hydration, saving and repeated Found initialization.

## Mojibake and bulk safety

Mojibake repair runs only on recognizable UTF-8 byte sequences misdecoded as Latin-1/Windows-1252. Each proposed segment must decode as valid UTF-8, re-encode to the exact original bytes, avoid control/replacement characters, and reduce known mojibake markers. Up to three correction passes handle repeated encoding damage. Correct surrounding Unicode is untouched. `PalantÃ­r` becomes `Palantír`; correctly encoded `Lórien`, curly apostrophes and unrelated Unicode remain unchanged. Display names retain accents; the existing lookup key remains accent-insensitive.

The bulk guard evaluates unique ordinary names after MTGJSON exact lookup and before collection/fuzzy work. It triggers only with **at least 20 names**, **strictly more than 60% true exact misses**, and **at least 60% of missing names showing structured-export evidence**. Evidence is either the parsed source-format hint or a recognizable raw suffix, including conservatively unsupported trailing markers. Duplicate printing rows cannot inflate the denominator. Tokens, basics, ambiguity and genuine special-printing exceptions are excluded from the ordinary-miss calculation.

Guarded ordinary misses immediately become Needs Review; known cards and selective exceptions remain usable. The printable list finishes and displays: “Most card names failed exact matching. The pasted list may use an unsupported export format. Automatic provider lookups were stopped.” The guard does not open a provider circuit, alter a future run, or disable small typo/new-card recovery. Reprocessing a corrected or small selected subset starts fresh; an unchanged catastrophic full list is guarded again. The preceding per-run Scryfall budgets remain in force for other failure shapes.

Diagnostics adds `structuredExportRowsDetected`, `structuredExportRowsParsed`, `importedPrintingHints`, `mojibakeCorrections`, `exactMissRatio`, `bulkMissGuardTriggered`, and `fuzzyLookupsPrevented`. The four parsing counters count raw rows; miss ratio and prevented fuzzy lookups use unique ordinary names. Initial browser/server processing and review subsets populate them. Copyable reports retain only aggregate allowlisted values, never customer details, card names, original rows, URLs or tokens.

## Deterministic evidence

The 215-unique-row fixture includes all supplied examples, punctuation, multiface names, numeric/promo set codes, collector suffixes, foil and one mojibake repair. A separate 220-row variant adds five duplicates. Both use mocked complete v3 index data and mocked fetch with injected clocks. Pricing fixtures verify exact collector UUIDs and foil defaults independently.

The before measurement below replayed the actual working-source bundle saved immediately before parser changes, SHA-256 `c5a8d5e2a64bcb84f3499b486c4db92e2316dbb6001829536099985e7e93f8b5`. It already contained the first pass's request budget. It is not a replay of the user's older live 720-second incident.

| 215-row fixture metric | Before parser correction | After |
| --- | ---: | ---: |
| MTGJSON exact matches | 0 | 215 |
| MTGJSON exact misses | 215 | 0 |
| Collection requests | 5 | 0 |
| Fuzzy requests | 35 | 0 |
| History requests | 0 | 0 |
| Total provider attempts | 40 | 0 |
| Completed cards | 0 | 215 |
| Simulated duration | 4,980 ms | 220 ms |

A 215-row unsupported-marker fixture produces 215 Needs Review entries, 215 prevented fuzzy lookups, zero provider requests and 220 simulated ms. A mixed 20-name fixture with 13 export misses retains seven completed cards and reviews 13, with zero provider requests. The 20-name/12-miss boundary, 19-name lists, insufficient export evidence, a few genuine typos and an individual new card retain normal recovery.

`npm run benchmark:formatter` retains all 26 preceding output/performance/reliability comparisons and adds the structured-export scenario. Without an optional local `STRUCTURED_EXPORT_BASELINE_PATH`, the new before row is explicitly labeled a recorded measurement; the current result always executes. With that path, the baseline executes against the same deterministic harness. No test contacts real Scryfall. These simulated durations are not live production latency claims.

## Validation and release boundary

The baseline for this follow-up was 401 passing root tests, 12 passing email tests, typecheck/build success and 26 benchmark scenarios. Final source verification passes 451 root tests (zero failures/skips), 12 email tests, email syntax checks, typecheck, build and all 27 benchmark scenarios. The 50 additional tests comprise 25 structured parser/processing tests, 11 pricing/persistence tests, 12 bulk-miss tests and two aggregate diagnostic tests. Existing UI wiring assertions were extended. Coverage retains parser punctuation, CSV/prose metadata, tokens/basic lands, multiface names, Case Check, pricing recovery, saved/legacy links, v1/v2/v3 compatibility, provider pacing and cancellation. Whitespace diff validation passes, with repository LF/CRLF advisories only.

Unsupported variants intentionally remain conservative: arbitrary terminal markers other than `*F*`, combined prose-plus-export annotations such as `NAME FOIL (SET) 123`, multiword collector tokens, set codes outside 2–8 alphanumeric characters, alternate bracket/order conventions, and collector symbols outside the documented grammar. Existing CSV/tabular/prose support remains separate. The bulk guard catches recognized systematic suffix failures; other unsupported formats remain protected by the bounded provider run. This change does not claim universal deck-export format support.

No production refresh or new secret is required for this parser/pricing change. The prior read-only readiness workflow's optional one-time setup remains documented in [RESOLUTION-INDEX-READINESS.md](RESOLUTION-INDEX-READINESS.md). No live mailbox, Teams, Blob refresh or deployed UI workflow was exercised.

The fresh `npx vercel@latest build --prod --yes` succeeded and emitted exactly **11 Functions**: check-email-now, formatted-lists, graph-mail-smoke, mtgjson-index, mtgjson-pricing-index, pull-list-jobs, refresh-mtgjson-index, refresh-mtgjson-pricing-index, send-test-teams, tcgplayer-listed-median and teams-actions. Both refresh Functions retain `maxDuration: 300`. No generated library exists under `/api` or emits a separate Function. The source-regenerated bundles match their hashes taken before that fresh build: formatter `319C0930C8EB2B3DFFA99A8D4BD085F08B186BE892F9912925917B2870D6DFF2`; pricing `31D0FA1421A0A34EFBB341DDEFAFDB0F61091C14F28F7B101AD625EECB1CCEC3`. Vercel's install step again synchronized two pre-existing package/lock version fields; only those incidental edits were restored. No dependency/version change is included.

Recommendation: **ship candidate for an authorized code release**. All requested local gates pass, the full original retry-control regressions remain green, and the new failure shape resolves without provider requests. Live production latency, deployed UI interactions, mailbox/Teams behavior and live catalog completeness remain unverified; no live-service test or release was performed.

## Exact changed files and suggested staging list

This is the complete **combined** intended 42-path staging inventory, including the preceding uncommitted retry-control pass. It is a suggestion only; no staging command was run. Both generated bundles now contain intentional source changes. This inventory supersedes the earlier pass's narrower 30-file suggestion.

```text
.github/workflows/resolution-index-readiness.yml
api/refresh-mtgjson-index.ts
docs/ENVIRONMENT-VARIABLES.md
docs/FORMATTER-PERFORMANCE.md
docs/PRINTING-MODEL.md
docs/RESOLUTION-INDEX-READINESS.md
docs/SAVED-PULL-LISTS.md
docs/SCRYFALL-RELIABILITY.md
docs/STRUCTURED-EXPORT-PARSING.md
server/generated/server-formatter.mjs
server/generated/server-pricing.mjs
src/PricingPanel.tsx
src/formatter.ts
src/main.tsx
src/mtgjson-index-cache.ts
src/mtgjson-resolution-index.ts
src/pricing-session.ts
src/pricing.ts
src/processing-performance.ts
src/pull-list-fingerprint.ts
src/requested-printing.ts
src/scryfall-reliability.ts
src/structured-export.ts
test/fixtures/README.md
test/fixtures/scryfall-card-multiface-nullable.json
test/fixtures/scryfall-list-prints-page-1.json
test/fixtures/scryfall-list-prints-page-2.json
test/formatter-bulk-miss.test.mjs
test/formatter-performance.test.mjs
test/formatter-retry-control.test.mjs
test/formatter.test.mjs
test/imported-printing-pricing.test.mjs
test/main-processing-performance.test.mjs
test/mtgjson-index-cache.test.mjs
test/mtgjson-resolution-index.test.mjs
test/processing-performance.test.mjs
test/resolution-index-readiness.test.mjs
test/scryfall-reliability.test.mjs
test/structured-export-processing.test.mjs
tools/benchmark/formatter-harness.mjs
tools/benchmark/formatter.mjs
tools/check-resolution-index-readiness.mjs
```

Exclude `df`, `.vercel`, `dist`, environment files, temporary logs/snapshot bundles and the unchanged lockfile. Do not use broad staging. HEAD and origin/main remain at the starting commit, and all edits remain unstaged.

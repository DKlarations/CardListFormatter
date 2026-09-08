# Scryfall reliability and retry control

Corrective local pass, 2026-09-08, starting from fetched `origin/main` / HEAD `877aeea7143c857d248d3b02b71b5d0fd0d2064d` on `fix/scryfall-retry-circuit-breaker`. The starting tracked checkout was clean; the unrelated untracked `df` was never read or changed. Nothing was staged, committed, pushed, merged, deployed or refreshed. No Scryfall API, production mailbox, Teams message or live data service was used by tests.

## Failure mechanism and limits of the production evidence

The deployed v2 resolution index could establish canonical MTGJSON names, but the preceding formatter required v3 explicit playable-paper and complete rarity evidence to finish ordinary cards locally. It therefore classified all 114 ordinary exact matches as `insufficient-paper-confidence`, sent them through collection verification, then fetched full printing histories along with the true miss. The initial group pass was followed by `retryFailedPrintHistories` second and third passes for every remaining `printLookupFailed` item. Those passes waited 500 ms and 2,000 ms respectively between failed cards. Each pass separately called `fetchJsonWithRetry`, which allowed four attempts per history resource.

The old worst case for a repeatedly failing first history page was **12 HTTP attempts per card**, comprising three whole-card passes times four HTTP attempts. The generic `retries` counter combined the nine HTTP retries with two whole-card repeats: **11 increments per card**. Collection resolution had another two-iteration wrapper with a 500 ms wait, then per-card exact fallback; failed names could also proceed to fuzzy recovery.

The supplied **351 history requests and 242 retries** identify this multiplied path, but do not uniquely identify each request. If all 115 classified remote cards entered all three history passes, they account for 345 history starts and 230 whole-card retry increments. The remaining six history requests and twelve mixed retry increments cannot be assigned to specific pages, HTTP statuses, cache behavior or other operations from aggregate counters alone. `remoteCards` was a scheduling-reason count, not a direct history-start measurement. No production response/status trace was supplied, so claiming an exact per-status decomposition would invent evidence. The new counters remove this ambiguity for future runs.

## Replacement policy

There is one authoritative request retry layer. Collection wrapper retries, failed-batch per-card exact fan-out, both automatic history retry passes, and their 500/2,000 ms per-card waits are removed. Successful collections may still send genuine not-found exceptions to named/fuzzy recovery. Compatibility items missing from a collection become reviewable immediately; they never enter that recovery solely because their local index is old.

| Response/failure | Automatic request policy |
| --- | --- |
| HTTP 400, 401, 404 and other non-transient statuses | Terminal for the resource, no retry |
| HTTP 403 | Terminal; open the run circuit immediately |
| HTTP 429 | Open immediately, record numeric/date `Retry-After`, no retry or wait-through |
| HTTP 408, 425, 500, 502, 503, 504; timeout; network | At most two total attempts per resource |
| Malformed JSON or invalid response shape | No retry of the unchanged response; never cached as success |
| Repeated/cyclic pagination or pagination safety limit | Structured failure, affected card reviewable; no whole-card retry |
| Cancellation, open circuit, exhausted budget | No new provider request |

Retry backoff is bounded exponential backoff with injected jitter: the single permitted retry waits 300–500 ms (`400 * (0.75 + random * 0.5)`, maximum 1,500 ms). All starts retain the central 120 ms normal or 500 ms careful minimum. Requests, body reads, pacing, queued work and backoff are abortable. Each request/body read has an eight-second deadline limited by the remaining phase budget, including transports that ignore abort.

Each formatter run has a fresh circuit shared by collection, exact/fuzzy named lookup, ambiguity search, print history and Case Check sets/history. One 403 or 429 opens it. Three consecutive equivalent timeout, network, exact 5xx status, invalid-response or malformed-JSON failures also open it; a successful network response resets the failure streak. Cache hits do not hide an outage by resetting that streak. Exhausting time or attempts opens the circuit too.

Normal formatting allows **25,000 ms** from the first provider phase start and **40 total HTTP attempts**. Careful Mode allows **45,000 ms**, still 40 attempts and a 500 ms start interval. These are provider-phase limits; index loading/parsing is separately measured. Once open, queued work cannot initiate or retry provider requests, active requests are interrupted, completed results survive, and affected/unfinished exceptions become Needs Review. The printable list still appears. Reprocess Needs Review is the employee-controlled retry and starts fresh state.

The new per-resource maximum is **two HTTP attempts, one HTTP retry, zero automatic whole-card retries**. A card with successful pagination can use multiple resources, but the whole formatter run—including that card—is capped at 40 attempts and its phase deadline. A page-count limit of 100 additionally protects cached/cyclic pagination; it does not enlarge the request budget.

Pricing Assistant recovery uses its own 45-second / 40-attempt operation context. Its existing catalog filter continues to recover only missing canonical cards and preserve already valid UUID selections. Manual card addition shares one fresh pricing context across identity and history stages. An old formatter circuit cannot permanently disable later pricing work.

## Index confidence and persistence

- **Current complete v3:** exact expected schema, complete rarity history, explicit playable-paper evidence and usable paper rarities complete ordinary exact cards locally. The 114-card ordinary regression makes zero Scryfall requests.
- **Legacy/incomplete/mismatched index:** preserve canonical names and legacy rarity arrays as lower-confidence evidence. Ordinary cards with no special request and Case Check off use collection batches of 50 in both modes, with their respective pacing. Successful playable-paper confirmation sets `paperIdentityVerified` and `rarityEvidence: "legacy-index"`, preserves grouping evidence and displays a concise reliability note. Failed/missing/nonpaper confirmation or missing usable rarity evidence yields Needs Review without per-card history fan-out. Scryfall disabled also preserves the identity as Needs Review.
- **True exceptions:** special printings, set/flavor requests, Case Check, explicit pricing recovery, genuine misses and ambiguous cards still receive selective recovery/history when available.

Missing current-schema evidence and future positive structurally compatible schemas are compatibility states, not reasons to reject all names. Manifest/index schema disagreement and explicit manifest incompleteness remain conservative through cache reuse. A schema migration therefore cannot create an ordinary-card history crawl. Diagnostics shows deployed manifest readiness separately from the actual index used by a processing run.

Saved Pull Lists and share links retain only compact identity/intent, status/note, and the small confidence fields `rarityEvidence`, `legacyIndexCompatibility`, `paperIdentityVerified`, `lessVerified`. Raw print arrays, provider payloads, provider failure objects and run contexts are omitted. Old records without these additive fields remain readable. Tests round-trip both old and new shapes without changing pricing identity or requested printing metadata.

## Validator audit

Authoritative Scryfall sources reviewed: [CardFields](https://github.com/scryfall/api-types/blob/main/src/objects/Card/CardFields.ts), [CardFace](https://github.com/scryfall/api-types/blob/main/src/objects/Card/CardFace.ts), [List](https://github.com/scryfall/api-types/blob/main/src/objects/List/List.ts), [Prices](https://github.com/scryfall/api-types/blob/main/src/objects/Card/values/Prices.ts), and the [API access / rate-limit FAQ](https://scryfall.com/docs/faqs/i-m-having-trouble-accessing-the-scryfall-api-or-i-m-blocked-17). Official Card/List HTML documentation returned HTTP 403 to the documentation reader; the official TypeScript sources were available. No live provider response was requested for this audit.

The previous validator demonstrably rejected null `frame_effects`, `promo_types`, `flavor_name` and nullable face flavor fields. Deterministic valid nullable fixtures reproduced that false failure. This proves the validator defect, **not that nullable values caused this particular production incident**: its response payloads were not supplied. Optional strings normalize to empty strings and treatment arrays to empty arrays only where absence already has equivalent application behavior. Core relied-upon field types remain validated. History records require usable rarity, games and root/face type evidence; unsafe records are dropped and counted, while useful records on the same page survive. An unusable page fails safely. Successful partial pages remain available in failure facts, but incomplete required history stays reviewable.

In-flight requests deduplicate by method/URL/body within the same run and cancellation context. The entry is always released after success or failure. Valid completed cached responses remain usable after circuit opening; rejected responses, 403/429 and synthetic circuit-open results are never stored as success.

## Diagnostics contract

Added schema/readiness fields: `resolutionIndexSchemaVersion`, `rarityHistoryComplete`, `resolutionIndexGeneratedAt`, `resolutionIndexFailedSetCount`, `legacyIndexCompatibilityMode`, plus manifest mismatch metadata. Added provider fields: `providerCircuitState`, `providerCircuitReason`, `providerBudgetMs`, `providerElapsedMs`, `providerAttemptBudget`, `providerAttemptsUsed`, `failuresByKind`, `failuresByHttpStatus`, `rateLimitRetryAfter`, `malformedRecordsDropped`. Added counters: `logicalRemoteCards`, `printHistoryCardsStarted`, `printHistoryCardsCompleted`, `printHistoryCardsFailed`, `printHistoryCardsSkippedAfterCircuit`, `requestRetries`, `logicalCardRetries`.

Legacy request counters are retained. `retries` now aliases **requestRetries only**, while `logicalCardRetries` remains zero for automatic processing. History counters count cards separately from HTTP attempts. Skipped cards never started a history request; started cards interrupted by the circuit count as failed. Failure totals describe observed attempts/validation events, not customer list contents. Copyable diagnostics allowlist labels and sanitized numeric/date values and contain no card names, customer data, URLs, headers, tokens or raw errors.

Internal failures distinguish `http-status`, `rate-limited`, `forbidden`, `timeout`, `network`, `malformed-json`, `invalid-response`, `pagination-loop`, `pagination-limit`, `circuit-open`, `phase-budget-exhausted`, `canceled`; they carry operation, attempt count, retryability and applicable status/Retry-After only.

## Deterministic before/after evidence

The harness executes the actual pre-correction generated bundle from Git commit `877aeea` and current bundled source with injected event-queue clocks and mocked fetch. The production-shaped fixture has 118 unique entries: 114 exact MTGJSON matches, three basic lands and one true miss. History fixtures paginate. All durations below are simulated; they are not live wall-clock claims.

| Scenario | Before ms | After ms | Before total requests | After total requests |
| --- | ---: | ---: | ---: | ---: |
| 118 current-v3 success (only the true miss remote) | 540 | 540 | 3 | 3 |
| 118 legacy-v2 compatibility, healthy | 28,140 | 780 | 233 | 5 |
| Legacy histories HTTP 400 / 403 / invalid HTTP 200 | 317,820 | 660 | 348 | 4 |
| Legacy histories HTTP 429, Retry-After 30 s | 7,968,540 | 660 | 1,383 | 4 |
| Legacy histories HTTP 500 / 503 | 1,770,040 | 1,140 | 1,383 | 5 |
| Legacy histories timeout | 16,842,820 | 16,980 | 1,383 | 5 |
| Legacy histories network error | 1,744,740 | 1,140 | 1,383 | 5 |
| Legacy histories malformed JSON | 1,744,740 | 660 | 1,383 | 4 |
| Valid nullable history fields | 317,820 | 780 | 348 | 5 |
| Provider-wide HTTP 403 | 29,880 | 300 | 236 | 1 |
| Provider-wide HTTP 429 | 7,166,520 | 300 | 944 | 1 |
| Provider-wide timeout | 15,436,120 | 24,620 | 944 | 3 |
| Provider-wide malformed JSON | 1,360,920 | 540 | 944 | 3 |
| 115 true exceptions, history HTTP 503 | 1,770,040 | 900 | 1,383 | 6 |

For terminal/invalid histories the old fixture starts all 115 histories on all three passes: **345 history requests and 230 logical retry increments**. For retryable failures it produces **1,380 history requests and 1,265 mixed retry increments**. The corrected legacy failure fixtures preserve all 114 compatibility-confirmed cards plus three basics; only the true miss requires history and goes to review on failure. The 115-exception 503 fixture makes only three history attempts plus three collection requests, with zero whole-card retries. The old valid-nullable fixture fails; the corrected fixture completes all 118 entries.

The benchmark retains all nine preceding performance/output-parity comparisons and adds 17 reliability comparisons. Tests separately prove zero requests for 114 ordinary v3 matches, three necessary batches for 114 v2 matches, partial-batch behavior, every requested failure family, nullable/multiface/absent fields, malformed-record dropping, exact special/set verification, Case Check, selective manual pricing, fresh reprocessing, request deduplication, cancellation, privacy and Saved/share compatibility. Slow healthy responses prove an actual 25,000 ms phase deadline (25,220 ms with the modeled index load); a large healthy exception list stops at exactly 40 attempts while retaining completed cards. Neither test relies on clipping a reported duration.

## Release readiness and local verification

The exact backward-compatible release sequence and one-time GitHub configuration are documented in [resolution-index readiness](RESOLUTION-INDEX-READINESS.md). The checked-in workflow performs only a manifest GET after successful Production deployment status for main; it cannot deploy or refresh data. Configure/verify `FORMATTER_BASE_URL`, verify Vercel's Production deployment-status events, and add `RESOLUTION_INDEX_READINESS_BYPASS_SECRET` only if the manifest is protected. No new secret is needed for a public manifest. A full index refresh remains a separate authorized action after backward-compatible code deployment.

| Gate | Baseline | Final |
| --- | --- | --- |
| Root `npm test` | 335 passed, no failures/skips | 401 passed, no failures/skips |
| Root `npm run typecheck` | Passed | Passed |
| Root `npm run build` | Passed | Passed |
| `npm run benchmark:formatter` | 9 comparisons passed | All 26 comparisons passed |
| Email tool `npm test` | 12 passed, no failures/skips | 12 passed, no failures/skips |
| Email tool `npm run check` | Passed | Passed |
| `git diff --check` | Passed | Passed; line-ending advisories only |
| Fresh `npx vercel@latest build --prod --yes` | Passed, 11 Functions | Passed, 11 Functions |

The 66 additional root tests include 47 formatter integration regressions, six provider-policy tests, and 13 diagnostics/readiness/cache/schema/UI tests. Rendered output and UI action wiring are tested locally; this pass did not run a live browser/store workflow.

The fresh Vercel CLI 59.11.7 production build emitted the same 11 Functions: check-email-now, formatted-lists, graph-mail-smoke, mtgjson-index, mtgjson-pricing-index, pull-list-jobs, refresh-mtgjson-index, refresh-mtgjson-pricing-index, send-test-teams, tcgplayer-listed-median, teams-actions. Both refresh Functions retain `maxDuration: 300`. Generated libraries stay in `server/generated`; neither library exists under `/api` or emits a separate Function.

Both generated files matched their pre-Vercel-build SHA-256 hashes after the fresh build regenerated them from source: formatter `C5A8D5E2A64BCB84F3499B486C4DB92E2316DBB6001829536099985E7E93F8B5`; pricing `693F99486DE5FAE6A433CD952EFE479DB5B9D8131598274BAB65BF577EC2B997`. Pricing's Git-normalized content is unchanged. Vercel's dependency-install step synchronized the pre-existing package/lock version mismatch locally; that incidental lockfile edit was restored to its starting content. No dependency or version change is included.

Recommendation: **ship candidate for an authorized code release**. All requested local gates passed. The application can operate in explicit bounded legacy compatibility before an index refresh; it does not require a silent manual refresh to avoid the retry failure. Deployment, a complete live v3 index, live mailbox/Teams behavior and real production latency improvement remain unverified. A readiness-check failure after code deployment remains outstanding until the separately authorized full refresh and verification are complete.

## Exact changed files and suggested staging list

These 30 paths are the complete intended content change. This is a reviewable staging suggestion only; no staging command was run.

```text
.github/workflows/resolution-index-readiness.yml
api/refresh-mtgjson-index.ts
docs/ENVIRONMENT-VARIABLES.md
docs/FORMATTER-PERFORMANCE.md
docs/RESOLUTION-INDEX-READINESS.md
docs/SCRYFALL-RELIABILITY.md
server/generated/server-formatter.mjs
src/PricingPanel.tsx
src/formatter.ts
src/main.tsx
src/mtgjson-index-cache.ts
src/mtgjson-resolution-index.ts
src/processing-performance.ts
src/scryfall-reliability.ts
test/fixtures/README.md
test/fixtures/scryfall-card-multiface-nullable.json
test/fixtures/scryfall-list-prints-page-1.json
test/fixtures/scryfall-list-prints-page-2.json
test/formatter-performance.test.mjs
test/formatter-retry-control.test.mjs
test/formatter.test.mjs
test/main-processing-performance.test.mjs
test/mtgjson-index-cache.test.mjs
test/mtgjson-resolution-index.test.mjs
test/processing-performance.test.mjs
test/resolution-index-readiness.test.mjs
test/scryfall-reliability.test.mjs
tools/benchmark/formatter-harness.mjs
tools/benchmark/formatter.mjs
tools/check-resolution-index-readiness.mjs
```

Exclude `df`, `.vercel`, `dist`, temporary logs, environment files, the unchanged pricing bundle and the restored lockfile. HEAD, branch ancestry and the Git index remain unchanged from the initial branch creation; all source edits are unstaged.

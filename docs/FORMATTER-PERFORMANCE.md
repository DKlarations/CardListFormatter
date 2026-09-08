# Initial formatting performance

**Structured-export follow-up (2026-09-08):** [Structured deck exports and bulk-miss safety](STRUCTURED-EXPORT-PARSING.md) adds right-anchored set/collector parsing, exact printing preferences, cautious mojibake repair and a guard for systematic export misses. The 215-row v3 fixture now resolves all names locally with zero provider requests. Its report contains the latest combined validation and staging inventory; earlier inventories below are historical.

**Current reliability policy (2026-09-08):** [Scryfall reliability and retry control](SCRYFALL-RELIABILITY.md) supersedes the historical retry and legacy-index behavior below. Legacy/incomplete indexes now use bounded collection compatibility verification without ordinary-card history fan-out. Automatic second/third history passes and collection-level retries/fallback fan-out are removed. One request-level retry policy and a shared run circuit enforce 25-second normal / 45-second careful phase budgets and 40 total attempts. See [resolution-index readiness](RESOLUTION-INDEX-READINESS.md) for the backward-compatible release sequence and read-only post-deployment check.

The remaining sections describe the preceding performance release and its original measurements; they are retained as historical evidence, including the now-corrected failure policy.

This pass starts at `49ae9a77fa420888dc540af3492b2f87a4d15589` on `perf/faster-initial-processing`. All measurements below use synthetic lists and mocked providers. No load test, mailbox processing, Teams action, production data write, live Blob refresh, or deployment is part of this work.

## Measured starting pipeline

The browser called `parsePullList`, then `resolveCardNames` and `enrichPrintHistories` with `pricingMode: true` for both Process List and Retry Needs Review. `resolveExactWithMtgjson` could resolve an ordinary name and rarity locally, but `pricingMode` disabled its enrichment shortcut. Each such card then needed an exact Scryfall response to obtain `prints_search_uri`, followed by every print-history page. Groups of five always waited another 250 ms, including a final group and groups doing no network work. Fuzzy items added 250 ms each beyond the central request gate, and exact batches added another 150 ms.

Pricing Assistant is a later, lazy-loaded consumer. Its independent MTGJSON manifest selects required pricing shards; its recovery path can obtain missing physical printings from Scryfall. Saved Pull Lists persist compact canonical identity and requested printing intent, plus separately persisted pricing selections. Full formatter `prints` arrays are intentionally omitted from those jobs and share links. The shared server/email formatter uses the same resolution functions but did not pass the browser's `pricingMode: true`; removing that browser setting alone therefore cannot substitute for shared conservative paper verification.

## Reproducing the comparison

Run `npm run benchmark:formatter`. The harness loads the actual starting generated formatter with `git show <starting-commit>:server/generated/server-formatter.mjs` and bundles the current source in memory. It does not create a worktree, modify generated output, or contact a provider. The starting commit must be present in local Git history.

Both revisions receive the same schema-v3 fixture, including explicit paper evidence and complete rarity history. The old formatter ignores the additive fields. The baseline follows the real browser `pricingMode: true` entry; the current run requests `enrichmentPurpose: "formatter"` or `"case-check"` when enabled, with the same explicit run context and interval used by the browser. Output is compared byte-for-byte with a fixed processed timestamp. This checks rarity sections, quantities, spelling, special-printing notes, ambiguity, tokens, basic lands, and Case Check; full printing arrays are deliberately outside printable-output parity.

An event-queue clock supplies `Date`, `performance.now`, timers, and fetch latency. Manifest requests take 40 ms, index requests 180 ms, Scryfall requests 80 ms; history fixtures have two pages. Real Promise continuations drain before the next virtual timer. Every Scryfall request start must remain at least 120 ms apart; separate tests require Careful Mode's 500 ms interval and serial requests. There are no assertions on machine wall-clock test duration.

The command reports each request type separately: manifest, index, collection, exact, fuzzy, ambiguity search, history page, and set list. It also reports Scryfall cache hits, injected transient retries, locally resolved cards, and cards requiring remote verification. Warm-reload runs clear module memory and Scryfall localStorage while preserving browser Cache Storage, so savings specifically measure reuse of the resolution index.

The starting 30-card ordinary case takes **12,280 simulated ms** and makes **90 Scryfall requests**: 30 exact lookups plus 60 history pages, in addition to one manifest and one index request. All nine final scenarios pass byte-for-byte printable-output parity.

| Scenario | Starting ms | Final ms | Starting Scryfall requests | Final Scryfall requests | Final manifest / index requests |
| --- | ---: | ---: | ---: | ---: | ---: |
| Ordinary, cold, 30 cards | 12,280 | 220 | 90 | 0 | 1 / 1 |
| Ordinary, persistent-cache reload | 12,280 | 40 | 90 | 0 | 1 / 0 |
| Mixed, 14 grouped items | 5,910 | 1,980 | 36 | 15 | 1 / 1 |
| Case Check, 3 cards | 1,590 | 1,100 | 10 | 8 | 1 / 1 |
| Manifest unavailable, 2 cards | 960 | 600 | 5 | 5 | 1 / 0 |
| Index unavailable, 2 cards | 1,140 | 780 | 5 | 5 | 1 / 1 |
| Transient Scryfall failure, 1 foil | 1,905 | 1,620 | 4 | 4 | 1 / 1 |
| Corrupt persistent cache, 30 cards | 12,280 | 220 | 90 | 0 | 1 / 1 |
| Manifest failure with last-known-good cache | 8,730 | 40 | 61 | 0 | 1 / 0 |

Ordinary cold processing eliminates 98.21% of modeled duration, persistent-cache reload eliminates 99.67%, and the mixed case eliminates 66.50%. The mixed final requests are one collection containing only six exceptions, three fuzzy requests, one ambiguity search, and ten history pages; six ordinary exact cards remain local, with the token and basic land handled separately. Case Check retains the set-list request and all six history pages while batching three exact names into one collection request; the same `CHECK CASE` / `CASE?` notes remain, with eight total requests. The transient scenario retains one retry. Scryfall cache hits are zero in these deliberately cold provider-cache comparisons.

Virtual duration measures injected network latency, request pacing, and explicit waits. It does not charge machine CPU time for parsing or formatting; parsing/validation is measured separately below. The tests require at least 60% ordinary improvement and zero ordinary Scryfall requests; they also fail if printable output or the request-rate minimum changes.

| Delay at starting revision | Final behavior and reason |
| --- | --- |
| 250 ms after every five-item normal enrichment group, including empty-network/final groups | Removed; only remote exceptions enter network groups, and the central gate handles pacing. |
| 250 ms after every normal fuzzy item and individual exact fallback | Removed; every underlying request already uses the central gate. |
| 150 ms after every normal exact collection batch, including the last | Removed; the central gate is sufficient. |
| 75 ms between history pages | Removed; page starts use the same central gate. |
| Careful Mode's extra 500 ms batch/group/item waits | Replaced by its retained 500 ms minimum request interval and serial item/batch processing, verified directly. |
| Scryfall 120 ms normal / 500 ms careful start interval | Retained for all request types, including concurrent consumers and history pages. |
| Actual request retry backoff | Retained; `Retry-After` and attempt backoff are bounded at ten seconds, and abort interrupts the wait. |
| Exact collection failure's 500 ms retry wait | Retained between actual failed attempts, with no final wait. |
| Second/third history pass spacing of 500 / 2,000 ms | Retained only between failed items; successful items are not retried. |

## Resolution and compatibility

The resolution index stays a compact name/rarity index, separate from Pricing Assistant's printing catalog. Schema v3 adds explicit playable-paper evidence and paper rarity history. The formatter can skip Scryfall only when both paper confidence and completed rarity history are sufficient. Old v1/v2 indexes remain usable as canonical-name hints and conservatively use Scryfall for verification. A successful deployment by itself does not grant old index bytes stronger evidence: a subsequent authorized full index refresh is required before the ordinary-list fast path can deliver all measured benefits. A partial refresh must not advertise complete history.

Paper evidence requires explicit `paper` availability, known set/type metadata, and no online-only, rebalanced, token, emblem, art-card, or memorabilia exclusion. Rarity history prefers paper booster/commander printings, excludes Secret Lair and player rewards, and uses eligible paper fallback only after all sets have merged. Unknown eligible rarities remain unverified. Generator completeness also requires modern source metadata and all selected sets to load successfully; old metadata, limited/failed set builds, and AtomicCards-only input remain conservative. Booster evidence follows the [MTGJSON Card Set model](https://mtgjson.com/data-models/card/card-set/) and is trusted only for source metadata version 5.2.1 or later.

Tokens and ordinary basic lands skip network enrichment. Ordinary exact cards with sufficient local evidence skip it as well. Missing or ambiguous names use exact/fuzzy recovery; special-printing, requested set/flavor, incomplete paper/rarity evidence, Case Check, and explicitly requested pricing recovery remain selective remote work. The central gate still limits all Scryfall starts. Only failed histories enter additional retry passes; ordinary local-only cards do not enter delayed network groups.

Pricing catalog recovery must filter out cards already represented by a valid primary catalog entry even when one failed shard sends the panel into its broader error handler. The acceptance suite exercises compact items reopened with two good catalog entries and one missing card, preserving the existing exact UUIDs and fetching only the missing card's history.

## Prefetch and browser cache

Idle/input prefetch starts the resolution index without blocking the initial render. Process List can reuse an active download; optional prefetch errors remain retryable. A canceled consumer stops waiting without invalidating another consumer's useful shared download. Server processing never requires browser storage APIs.

Cache Storage holds at most two validated resolution-index versions, keyed by manifest/index schema and URL. The versioned URL is preferred. Conservative freshness bounds are one hour for versioned URLs and five minutes for mutable URLs; a validated last-known-good entry can bridge a manifest failure for up to seven days. Corrupt entries are deleted and retried from network. Cache denial or unavailability degrades to a normal network load. No customer list, contact information, or pricing work is stored in this cache. Failed responses are never persisted as valid indexes.

## Parsing measurement and limits

The benchmark includes a separate synthetic 35,000-card JSON parse probe using the real current index validator. One local Node run parsed and validated 8,705,687 UTF-8 bytes in 88.45–118.50 ms across five samples. This establishes a plausible long-task concern; it is not a measurement of the published Blob or a browser's rendering delay. The probe is informational and intentionally has no wall-clock pass/fail threshold. Prefetch and yields around parsing let status render and reduce the chance that a click pays the whole synchronous cost. Persistent bytes still need parsing after a page reload. A worker is not justified by this synthetic measurement alone; actual browser traces with representative published bytes should precede that additional architecture.

Network latency, device performance, existing Scryfall cache contents, index size, and old-schema deployment state change real timings. The deterministic results demonstrate eliminated work and preserved output; they are not a promise of a particular production wall-clock duration. Local synthetic tests cannot establish live mailbox/Teams configuration, production Saved Pull Lists behavior, hosted artifact readiness, or physical printing.

## Verification and release boundary

`test/formatter-performance.test.mjs` checks ordinary and exception request counts, output parity, original source order, Case Check notes, Careful Mode, transient retry, legacy index compatibility, unavailable providers, compact persistence, and selective pricing recovery. It also proves same-signal concurrent history deduplication, prompt active/queued cancellation with a usable next run, conservative digital/unknown-rarity handling, and bounded exhausted history retries that retain the exception in review. `test/processing-performance.test.mjs` checks numeric measurements, copyable private-data-free reporting, and immutable completed snapshots. The cache and index-schema suites cover cache corruption, expiry/eviction, concurrent prefetch, cancellation, schema validation, and paper evidence separately.

Stage only the explicitly reviewed performance source, tests, documentation, package command, and regenerated `server/generated` bundles after final validation. The unrelated `df` file is outside the task. This document does not authorize staging, committing, pushing, merging, refreshing live indexes, or deploying. The final handoff records the exact changed-file list and required test/build results.

## Final local verification, 2026-09-07

| Gate | Before functional edits | Final result |
| --- | --- | --- |
| Root `npm test` | 278 passed | 333 passed, zero failures/skips |
| `npm run typecheck` | Passed | Passed |
| `npm run build` | Passed, 1,718 modules | Passed, 1,721 modules |
| Email tool `npm test` | 12 passed | 12 passed |
| Email tool `npm run check` | Passed | Passed |
| Offline benchmark | Starting implementation measured from Git | All nine comparisons, output parity and pacing passed |
| Local Vercel production build | Passed, 11 Functions | Passed, 11 Functions |
| Generated bundle reproducibility | Generated with existing scripts | Both files SHA-256 identical before/after another regeneration |
| Diff whitespace validation | Passed | Passed; only repository LF/CRLF conversion notices |

The authorized baseline production environment pull completed without printing secret values. No remote project/environment settings were changed. Final local Vercel CLI 59.11.7 build succeeded; `server-formatter.func` and `server-pricing.func` are absent. Both resolution and pricing refresh Functions retain `maxDuration: 300`. Application version and update date were not changed. Regenerated `server-pricing.mjs` has the same Git-normalized content hash as HEAD; its apparent modified status is line-ending-only.

The 55 additional tests comprise 18 formatter acceptance/performance tests, 15 cache tests, nine schema/generator tests, seven reliability/server-parity tests, four main UI-wiring tests, and two diagnostics tests. Existing parser response mocks and the server ESM import graph were also updated. The actual regenerated server `processPullListText` is tested with browser globals absent, producing identical ordinary output without pricing enrichment; existing email and Teams ingestion tests continue to pass against mocks.

Additional reliability coverage checks malformed/cyclic provider responses, revalidating complete but nonmatching requested printings on Retry Needs Review, subsequent recovery without clearing the cache, and failed Case Check set facts. Manifest/index fetches have 20-second deadlines covering body reads; each Scryfall attempt has a 15-second deadline. Malformed HTTP-200 responses are not cached as successes. Pagination has repeat detection and a 100-page safety bound; only the affected card becomes reviewable when its required facts cannot be obtained. Cancellation interrupts active requests, queued work, and backoff without poisoning the next run.

Isolated browser QA used Vite and preinstalled network blocking/mocks; no real API traffic or persistence occurred. A 25-card ordinary list resolved all 25 locally, made zero Scryfall requests, and loaded Pricing Assistant separately. Diagnostics copied no fixture card names, customer details, or URLs. Reload required one manifest request but zero index downloads. Canceling a delayed provider request recorded `canceled` at `scryfall-exact`; both reprocessing and replacing an active delayed input completed successfully without late old UI updates. No page errors were observed, and the browser/server were stopped afterward. The browser skills guided this rendered-page and cancellation check; the React review kept transient measurements in refs, reused the existing Diagnostics styling, and avoided per-request state updates.

A separate browser probe parsed and validated 35,000 synthetic cards / 8,285,640 bytes in 69.8 ms. This confirms a possible main-thread long task, not a live published-index measurement. Prefetch plus yields before/after parsing is the intentionally small first improvement; it moves work ahead of Process List but does not make synchronous JSON parsing interruptible. Persistent cache reloads still pay this CPU cost. Investigate a worker only after representative deployed-device traces show that the remaining cost warrants it.

Recommendation: **ship candidate after normal release approval**, followed by a separately authorized complete v3 resolution-index refresh and hosted verification. Old deployed index bytes stay safe but will not provide all of the measured speedup. Do not claim production readiness from local build results alone: live Blob data, hosted cache behavior, authenticated Saved Pull Lists, mailbox-to-Teams delivery, and physical printing were intentionally not exercised. Nothing was staged, committed, pushed, merged, deployed, or refreshed remotely during this task.

## Reviewed file inventory and suggested staging list

These are suggestions only, not executed staging commands. All semantic changes are in the following 20 paths:

```text
api/refresh-mtgjson-index.ts
package.json
server/generated/server-formatter.mjs
src/formatter.ts
src/main.tsx
src/PricingPanel.tsx
src/mtgjson-resolution-index.ts
src/mtgjson-index-cache.ts
src/processing-performance.ts
test/formatter.test.mjs
test/formatter-performance.test.mjs
test/formatter-reliability.test.mjs
test/main-processing-performance.test.mjs
test/mtgjson-resolution-index.test.mjs
test/mtgjson-index-cache.test.mjs
test/processing-performance.test.mjs
test/saved-pull-list-server-esm-imports.test.mjs
tools/benchmark/formatter-harness.mjs
tools/benchmark/formatter.mjs
docs/FORMATTER-PERFORMANCE.md
```

`server/generated/server-pricing.mjs` was also regenerated through its build command and verified equivalent; it does not need a content commit. Leave the unrelated `df` file untouched and excluded. Local `dist`, `.vercel` build/environment artifacts, and temporary browser QA screenshots are not release source files.

# Resolution-index readiness and schema releases

Application deployment and resolution-index publication are separate operations. The browser compares the index's exact schema version with `MTGJSON_RESOLUTION_INDEX_VERSION` in `src/mtgjson-resolution-index.ts`. A legacy, newer, or incomplete index uses bounded compatibility verification. Missing metadata is unknown, never evidence of completeness. A current schema still needs explicit playable-paper evidence and usable paper rarity history for each ordinary card to finish locally.

The existing manifest at `/api/mtgjson-index` exposes `version`, `rarityHistoryComplete`, `generatedAt`, and `failedSetCount` after the next authorized refresh. The existing refresh Function writes those additive fields; no new Function is introduced. Old deployed manifests remain readable, with missing completeness and failure counts displayed as unknown. Browser Diagnostics shows actual manifest metadata and the expected version; Processing Performance records the metadata of the index actually used, including cached indexes. Per-card missing evidence also enables the run's compatibility indicator.

If the manifest and index disagree about schema, the validated canonical-name index remains available in compatibility mode. An explicit incomplete or failed-set manifest cannot grant the index local trust even if the index bytes claim completeness. This restriction survives memory, persistent-cache and stale-fallback loads. Processing Performance records the manifest schema and mismatch without copying manifest URLs.

For legacy ordinary exact matches, compatibility retains MTGJSON canonical identity and explicitly lower-confidence rarity arrays, confirms paper identity with collection batches, and avoids full printing histories solely because the schema is old. Batch failure finishes with affected cards in Needs Review. Special printing, Case Check and genuine exceptions retain selective remote verification, subject to the formatter run's circuit and budgets. Compatibility status remains visible when the printable list appears.

## Required release sequence

1. Deploy backward-compatible code. Confirm it handles the currently published manifest through bounded compatibility mode.
2. Run the separately authorized **full** resolution-index refresh using the existing protected refresh operation. Do not use a limited or dry-run build as completeness evidence.
3. Read the manifest and verify the exact expected schema, `rarityHistoryComplete: true`, a valid `generatedAt`, and `failedSetCount: 0`. Verify representative index cards have explicit playable-paper evidence and usable paper rarity history.
4. Confirm clients transition from compatibility mode to current-index mode. In Browser Diagnostics, check the manifest plus the actual processing report; a representative ordinary exact list should make zero Scryfall requests. Existing in-memory/versioned caches may remain for up to one hour; opening a fresh page or the existing cache-clearing refresh flow can be checked after the authorized operation.

Do not label an application deployment fully current merely because the code expects the new schema. A compatibility-mode release can keep the store working while data publication is completed and verified.

## Read-only post-deployment check

`.github/workflows/resolution-index-readiness.yml` handles successful GitHub deployment-status events for the `Production` environment and manual dispatch on `main`. It checks the deployed SHA belongs to `main`, reads the expected version from that checkout, and runs `tools/check-resolution-index-readiness.mjs`. The script makes one HTTPS GET to the configured application's existing manifest route with a ten-second deadline. It reports a failed check when schema, completeness, generation timestamp or failed-set metadata is behind, incomplete or missing. It never calls a refresh route, Scryfall, a mailbox, Teams, Redis, or a Blob write operation. Its output contains only sanitized readiness metadata; redirects are rejected so a protection bypass header cannot be forwarded elsewhere.

The workflow uses only `contents: read` and disables persistent checkout credentials. GitHub documents that [`deployment_status` runs on third-party deployment status updates](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#deployment_status). This check runs after deployment and cannot prevent the deployment that triggered it. Watch the Actions result and treat a failure as outstanding data readiness. It is deliberately separate from the mailbox workflow.

One-time setup Derek must perform when this code is authorized for release:

1. Set or verify the GitHub Actions **repository variable** `FORMATTER_BASE_URL` is the canonical HTTPS production application origin, without credentials, query parameters or fragments. The readiness workflow has no silent fallback target.
2. Verify the Vercel Git integration emits successful GitHub deployment statuses with environment `Production` for `main`. If that integration is unavailable, manually dispatch **Resolution index readiness** on `main` after deployment and after the authorized full refresh.
3. Only if deployment protection blocks the manifest GET, create the GitHub Actions **repository secret** `RESOLUTION_INDEX_READINESS_BYPASS_SECRET` with an authorized Vercel protection-bypass value. Public manifests need no new secret. No refresh credential is required or consumed by this workflow.
4. Review the first post-deployment result, authorize the full refresh separately, and rerun the read-only readiness check afterward. Tests never refresh production automatically.

No automated post-deployment refresh is included. A future refresh automation would require a separately reviewed and authorized write workflow with its own operation secret; do not reuse the read-only readiness check for that purpose.

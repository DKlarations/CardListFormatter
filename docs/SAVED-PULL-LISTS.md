# Saved Pull List foundation

A Saved Pull List is a resumable working session. It is distinct from both a customer and a Copy Link.

## Data and lifecycle

The structured customer record contains human-formatted `name`, `phone`, and `email` fields. Compatibility normalization extracts clear phone/email values from older `customer.contact` records and retains unclassifiable legacy text without guessing.

Each pull-list job has an independent random ID, created/updated/processed/expiration timestamps, customer, input, output, compact formatter items, formatter statistics, Saved Pricing State, source, exact duplicate fingerprint, normalized search fields, and optional future Teams metadata. A successful Process List run creates the job; later coherent formatter, customer, or Pricing Assistant changes autosave after 750 ms. Standalone Add Card work does not create a job by itself.

Jobs and their active secondary indexes expire 30 days after the latest meaningful successful save. Updating a job refreshes its job, current fingerprint, recent, and applicable exact customer-index TTLs. Queries prune expired or missing index members.

**New List** clears the local workspace, current job identity, customer, formatter state, and every pricing row. It never deletes the persisted job. Saved work clears immediately; dirty, stale, saving, or failed work asks for confirmation.

## Exact duplicate protection

The server computes a deterministic SHA-256 fingerprint from sorted, grouped processed card requests. Identity includes canonical card, grouped requested quantity, explicit requested set, Finish, foil technology, visual Treatment, and meaningful requested flavor/reskin. It ignores raw paste formatting, line order, capitalization/punctuation, and customer identity.

Redis maps the fingerprint directly to one unexpired job ID. A match to another active job returns a compact summary and prevents a second record; a match to the current job updates normally. Changed jobs release their prior mapping when it is still owned by that job. Stale mappings are removed when the referenced job is missing, expired, or has a different fingerprint.

## Saved Pull Lists picker and API

The small arrow immediately beside **Customer** opens an anchored Saved Pull Lists picker. It shows the 15 most recently updated unexpired jobs, newest first. One field searches a normalized customer-name prefix or an exact normalized phone/email value after a 300 ms debounce. Prefix matching starts at the beginning of the normalized full name, so `john` matches both John Smith and Johnny Appleseed without fuzzy typo matching. Name prefix indexes and exact phone/email indexes use hashed Redis lookup tokens; the browser receives compact job summaries rather than complete private pricing payloads.

Each result remains a separate pull-list job even when several belong to the same customer. **Open** uses the same protected loader as direct `?job=` URLs and duplicate-warning actions. Dirty, stale, saving, or failed local work requires confirmation before replacement. A successful load restores customer fields, formatter state, all persisted Pricing Assistant work, and current job identity so autosave continues. Escape, outside click, or a successful Open closes the picker.

`/api/pull-list-jobs` currently has no application-level authentication requirement for exact job loading, create/update, recent summaries, normalized name-prefix lookup, or exact normalized phone/email lookup. It is a compact job browser, not a customer CRM. Production authentication is expected to be added later at this API boundary, likely with Microsoft Entra ID.

When Diagnostics is enabled, Pullsmith also shows a session-only Saved Pull List request report for persistence troubleshooting. It retains the five newest API outcomes without storing customer data, request payloads, or credentials.

## Saved Pull List versus Copy Link

- Saved Pull List load restores the exact staff Pricing Assistant working state and then rehydrates current external catalogs/prices.
- Copy Link shares processed formatter identity/intent and deliberately starts a fresh Pricing Assistant.

## Future integrations

The current IMAP/GitHub Actions mail workflow remains legacy/test infrastructure. Future production inbound mail is expected to use Microsoft Graph with `Service@RedRaccoonGames.com`. Teams posting is a separate future transport; the job reserves optional team/channel/message/post timestamp metadata only. No Graph, Teams, customer email, or SMS implementation is part of this foundation.

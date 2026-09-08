# Printing model

The Pricing Assistant preserves what the customer asked for rather than replacing it with a convenient default on the way to pricing.

## The layers

1. **Canonical/oracle card identity** is the game object, such as *Umezawa's Jitte*.
2. **Display, flavor, or reskin name** is the customer-facing name printed on a special card, such as *Raph's Jitte*. It may map to a canonical identity, but remains visible as requested.
3. **Set** is the expansion or product code/name, such as `RVR`.
4. **Exact printing/art/collector variant** is one physical printing in that set, selected by MTGJSON UUID. It includes collector number and may have distinct art, name presentation, and TCGplayer product ID.
5. **Visual treatment** describes presentation: standard, showcase, borderless, extended art, full art, or retro frame.
6. **Finish** is the staff-facing physical finish: Non-Foil, Foil, Surge, or Etched when available.
7. **Condition** is the staff-assessed condition. The UI currently uses Near Mint only.
8. **Price source** is the pricing policy/provider, such as TCGplayer Listed Median or an MTGJSON provider listing.
9. **Provider IDs** belong to the exact printing: MTGJSON UUID, collector number, Scryfall ID, and TCGplayer product ID.

Set is **not** an exact printing. A set can contain several Sol Rings with different artwork or collector numbers, and those variants can have different TCGplayer products and prices.

## Requested intent and defaults

Formatter items carry one shared `RequestedPrintingPreference` in `requestedPrinting`, separate from canonical name identity. It can carry set code, exact collector-number text, treatment, finish, foil treatment, flavor name, and the optional `sourceFormat: "set-collector-export"` marker. The established prose row format still captures exactly one set code:

```
Card Name - Rarity - Price - SET - Color
```

For example, `Putrefy - Rare - $0.35 - RVR - Black/Green` requests `RVR`. Rows with slash-separated alternate set codes deliberately do not choose one. Free-form three-to-five-character words are not inferred as set codes.

Structured deck exports also preserve the terminal `(SET) COLLECTOR` suffix as printing intent: `1 Elegant Parlor (PMKM) 260s *F*` resolves the name `Elegant Parlor` and carries set `PMKM`, collector number `260s`, and ordinary foil. The imported hint stays in the same `requestedPrinting` object. It does not require full Scryfall history during ordinary initial formatting with complete v3 evidence. The foil instruction remains visible on the pull list; imported set and collector text are reserved for Pricing Assistant. Prose special requests and Case Check keep their verification behavior.

Pricing first prefers the imported set and collector number with the requested finish, then that same collector with the closest available finish. It prefers the same finish with another available foil technology before falling back to the existing Non-Foil, Foil, Surge, Etched availability order. If the collector is absent, it uses the requested set and finish, then existing set/default behavior. Set and collector comparisons ignore case; collector numbers remain exact strings, preserving leading zeroes, suffix letters, slashes, periods, hyphens, and special characters. A matched exact printing receives its real MTGJSON UUID deterministically. Missing collector/set or finish choices show a Pricing Assistant row warning; the card remains resolved and no formatter-wide crawl starts. Staff Set, Finish, Treatment, Art, and Exact Printing choices override these initial hints.

`SURGE FOIL` is preserved as requested `finish: "foil"` plus `foilTreatment: "surge"`; it is never stored as a visual Treatment. A simultaneous visual request such as `BORDERLESS` remains independently available as `treatment: "borderless"`.

When pricing data loads, each row gets a sensible available selection. When staff change **Found** from unchecked to checked, the same pure initialization pipeline runs again before pricing starts: valid requested flavor/set/Finish/Treatment intent, an already-valid selection, a released non-Secret-Lair default set, a real Finish, a compatible real Treatment, and finally Art/exact UUID. Invalid combinations are never manufactured. A known requested flavor name strongly prefers its matching exact printing and valid dimensions.

`selectedPrintingUuid` is optional. When it is set, price and TCGplayer product lookup operate only on that exact printing. When filtering leaves one human-distinct physical choice, its UUID is selected automatically. Raw provider treatment normalization is shared by the MTGJSON pricing index, live MTGJSON fallback, and Scryfall-derived fallback catalog.

## Finish, treatment, and Art / Variant selection

Surge is a foil technology, not a visual treatment. Internally it is `finish: "foil"` plus `foilTreatment: "surge"`; ordinary foil is `finish: "foil"` plus `foilTreatment: "standard"`. The visual Treatment menu never contains Surge. The Finish menu contains only available choices: **Non-Foil**, **Foil**, **Surge**, and **Etched**.

Staff selections resolve in this order: **Card -> Set -> Finish -> Treatment -> Art / Variant -> exact UUID**. Finish choices come from the selected card and set. Treatment choices come only from exact records in the selected effective Finish bucket, and Art / Variant choices come only from exact records that also match the selected Treatment. Ordinary Foil and Surge are mutually exclusive candidate pools even though both use the provider finish value `foil`.

The normal **Printing** menu has a focused set-level search field. Staff can type a case-insensitive set code such as `P10`, `MKM`, or `PLST`, or a full/partial set name such as `player rewards` or `ravnica remastered`. Exact set-code and set-code-prefix matches rank before set-name matches; multi-word names require every entered token. Arrow keys move through matches, Enter uses the same normal set-selection pipeline, and Escape closes the menu.

This set search does not replace **Exact Printing Search**. The magnifying-glass tool remains the advanced cross-set search for collector number, artist, year, finish, treatment, and exact physical UUID.

Requested flavor/reskin identity and imported collector numbers are **initial** printing preferences. When staff manually change Set, that choice is authoritative: the row keeps its customer-facing display and canonical identities, but recalculates **Set -> Finish -> Treatment -> Art -> exact UUID** from the canonical card in the new set. Previous finish, treatment, art UUID, and reskin preference do not constrain the new physical selection. Manual Finish, Treatment, and Art changes also record manual selection provenance so subsequent catalog hydration or Found toggles cannot reapply an imported hint over staff work.

The normal Pricing Assistant row remains the primary requested-card row. After it is marked Found, and after set, effective finish (including foil treatment), and visual treatment are applied, an indented **Art / Variant** row appears only when multiple human-distinct collector/art variants remain. A branch connector and left border make the relationship unmistakable. Options group equivalent provider records by collector number, flavor name, and artist, then display the collector number plus useful name/artist detail.

There is no permanent wide Art column. A lone human variant selects a deterministic underlying UUID automatically; multiple variants intentionally remain unselected until staff choose one. Changing set, visual treatment, or finish recomputes the UUID, so a stale selection cannot survive a changed physical selection. The UUID remains the final technical identity for price and exact product links.

Legacy pricing-index schemas cannot safely distinguish every effective Finish and canonical visual Treatment. Pricing-index v6 is the minimum current schema; v6 also corrects the distinction between an old frame era and a marketed Retro treatment. The client does not guess from collector numbers or card names; it uses the existing live/provider fallback until a current index is available.

## Copy Link semantics

**Copy Link** shares the processed formatter result, compact resolved card identities, requested printing intent, customer, and timestamp. Opening it creates fresh Pricing Assistant rows and rehydrates current catalog/pricing data, so the recipient can mark Found and use every normal pricing control without reprocessing the list.

Pricing-session work is intentionally local: Found states, split rows, set/Finish/Treatment/Art selections, UUIDs, source, overrides, quantities, and manually added Pricing Assistant cards are not serialized. New links use formatter-only schema v5. Older v1-v4 links still restore their formatter data without crashing, but any embedded legacy pricing session is deliberately ignored.

This differs deliberately from a **Saved Pull List**. A Saved Pull List is a resumable staff job and persists those Pricing Assistant row selections, splits, manual rows, quantities, exact UUIDs, price overrides, receipt preference, and pricing source. It does not persist the external MTGJSON catalog or automatic market values; those rehydrate from current sources when the job is loaded. Copy Link still starts fresh pricing work.

Imported collector text and its source marker survive compact formatter items, Saved Pull List normalization, and current/legacy link loading as additive fields. Pricing rows retain `requestedCollectorNumber` and `requestedSourceFormat` beside the existing requested set/finish fields. Older rows without these fields continue using their established defaults; no schema migration or live data refresh is required for this preference bridge.

## Manual cards and reskins

Pricing Assistant can add a resolved card manually from the lower-left action beside the totals. These rows use the same Found/default-selection pipeline and have their own found state, quantity, printing selections, and price override. Original pull-list quantities remain constrained; manual rows can be adjusted independently. Because they are pricing-session work rather than formatter items, they are intentionally not included in Copy Link.

Rows retain both a display name and canonical name. Pricing Assistant identifies a reskin as `Raph's Jitte (Umezawa's Jitte)` while the catalog remains keyed by *Umezawa's Jitte*. Receipts retain the concise requested display name. Matching provider `flavorName` is preferred when selecting an exact printing.

## Follow-up work

- Additional condition pricing.
- Broader alias coverage when a provider lacks a usable `flavorName` match.
- More manual-card workflows if staff need to add unresolved/custom entries.

### Provider normalization

MTGJSON `promoTypes` and Scryfall `promo_types` containing `surgefoil` normalize to `foilTreatment: "surge"`; ordinary foil normalizes to `foilTreatment: "standard"`. Generic `boosterfun` is neither Surge nor Retro by itself.

Visual normalization uses explicit provider signals and assigns one staff-facing visual treatment to each raw record. `frameVersion: "1997"` alone describes frame era and does **not** make a printing Retro; this keeps ordinary old-frame reproductions such as The List in Standard. Explicit retro/old-frame provider tokens, or the provider combination of a 1997 frame plus `boosterfun` used for a deliberately marketed variant, identify Retro. Retro then wins before explicit Extended Art or Showcase effects, Borderless metadata, and Full Art. This prevents one Extended Art record from also manufacturing a Borderless choice (and vice versa). Separate exact records may still legitimately expose both choices.

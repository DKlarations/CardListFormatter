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

Formatter items carry conservative `requestedPrinting` data for set code, treatment, and/or finish. The parser captures a set only from the existing structured row format with exactly one set code:

```
Card Name - Rarity - Price - SET - Color
```

For example, `Putrefy - Rare - $0.35 - RVR - Black/Green` requests `RVR`. Rows with slash-separated alternate set codes deliberately do not choose one. Free-form three-to-five-character words are not inferred as set codes.

`SURGE FOIL` is preserved as requested `finish: "foil"` plus `foilTreatment: "surge"`; it is never stored as a visual Treatment. A simultaneous visual request such as `BORDERLESS` remains independently available as `treatment: "borderless"`.

When pricing data loads, defaults choose a valid requested set and then a valid requested Finish/Treatment combination before the ordinary default printing. A requested treatment may move an unavailable requested finish to a finish where that physical treatment really exists; invalid combinations are never manufactured. A known requested flavor name strongly prefers its matching exact printing and valid dimensions.

`selectedPrintingUuid` is optional. When it is set, price and TCGplayer product lookup operate only on that exact printing. Raw provider treatment normalization is shared by the MTGJSON pricing index, live MTGJSON fallback, and Scryfall-derived fallback catalog. `frameVersion: "1997"` is a retro-frame signal; `boosterfun` alone is not.

## Finish, treatment, and Art / Variant selection

Surge is a foil technology, not a visual treatment. Internally it is `finish: "foil"` plus `foilTreatment: "surge"`; ordinary foil is `finish: "foil"` plus `foilTreatment: "standard"`. The visual Treatment menu never contains Surge. The Finish menu contains only available choices: **Non-Foil**, **Foil**, **Surge**, and **Etched**.

Staff selections resolve in this order: **Card -> Set -> Finish -> Treatment -> Art / Variant -> exact UUID**. Finish choices come from the selected card and set. Treatment choices come only from exact records in the selected effective Finish bucket, and Art / Variant choices come only from exact records that also match the selected Treatment. Ordinary Foil and Surge are mutually exclusive candidate pools even though both use the provider finish value `foil`.

The normal Pricing Assistant row remains the primary requested-card row. After it is marked Found, and after set, effective finish (including foil treatment), and visual treatment are applied, an indented **Art / Variant** row appears only when multiple human-distinct collector/art variants remain. A branch connector and left border make the relationship unmistakable. Options group equivalent provider records by collector number, flavor name, and artist, then display the collector number plus useful name/artist detail.

There is no permanent wide Art column. A lone human variant selects a deterministic underlying UUID automatically; multiple variants intentionally remain unselected until staff choose one. Changing set, visual treatment, or finish recomputes the UUID, so a stale selection cannot survive a changed physical selection. The UUID remains the final technical identity for price, product links, and sharing.

Legacy pricing-index schemas cannot safely distinguish every effective Finish and canonical visual Treatment. Pricing-index v5 is the minimum current schema. The client does not guess from collector numbers or card names; it uses the existing live/provider fallback until a current index is available.

## Manual cards and reskins

Pricing Assistant can add a resolved card manually from the lower-left action beside the totals. These rows have their own found state, quantity, printing selections, price override, and share-link state. Original pull-list quantities remain constrained; manual rows can be adjusted independently.

Rows retain both a display name and canonical name. Pricing Assistant identifies a reskin as `Raph's Jitte (Umezawa's Jitte)` while the catalog remains keyed by *Umezawa's Jitte*. Receipts retain the concise requested display name. Matching provider `flavorName` is preferred when selecting an exact printing.

## Follow-up work

- Additional condition pricing.
- Broader alias coverage when a provider lacks a usable `flavorName` match.
- More manual-card workflows if staff need to add unresolved/custom entries.

### Provider normalization

MTGJSON `promoTypes` and Scryfall `promo_types` containing `surgefoil` normalize to `foilTreatment: "surge"`; ordinary foil normalizes to `foilTreatment: "standard"`. Generic `boosterfun` is neither Surge nor Retro by itself. Shared-link v4 stores this dimension; v3 links using `treatment: "surge"` migrate to visual `standard` treatment plus Surge foil treatment.

Visual normalization uses explicit provider signals and assigns one staff-facing visual treatment to each raw record. Retro-frame signals win first, then explicit Extended Art or Showcase effects, then Borderless metadata, then Full Art; this prevents one Extended Art record from also manufacturing a Borderless choice (and vice versa). Separate exact records may still legitimately expose both choices.

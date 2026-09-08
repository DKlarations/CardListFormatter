# Scryfall response fixtures

These are **synthetic, sanitized fixtures**, constructed on 2026-09-08 from the official [CardFields](https://github.com/scryfall/api-types/blob/main/src/objects/Card/CardFields.ts), [CardFace](https://github.com/scryfall/api-types/blob/main/src/objects/Card/CardFace.ts), and [List](https://github.com/scryfall/api-types/blob/main/src/objects/List/List.ts) definitions. They are not captured production responses. Card names, UUIDs, artwork, prices, and set information are invented; they contain no customer or account data. Tests intercept every provider request and never fetch these URLs.

The official TypeScript definitions describe `frame_effects`, `promo_types`, and `flavor_name` as optional. These fixtures deliberately exercise null-as-absence compatibility for those optional fields; they do not claim that the TypeScript unions explicitly contain `null`. Face optional properties and nullable price entries also exercise safe absence handling.

- `scryfall-card-multiface-nullable.json`: a representative Card object with two faces, nullable optional fields, and normal print metadata.
- `scryfall-list-prints-page-1.json`: the first printing-history page, with the same valid multiface card plus one deliberately malformed record. Its valid card must survive while the malformed-record diagnostic increments once.
- `scryfall-list-prints-page-2.json`: the final page, with a second printing of the same card. Optional flavor/frame/promo properties are absent. The changed rarity makes retention of both pages observable in formatter grouping.

The formatter retry-control integration test loads these checked-in JSON files as actual collection/Card and paginated List responses. Generated large-list fixtures remain separate so the production-shaped request-count scenarios are deterministic and easy to audit.

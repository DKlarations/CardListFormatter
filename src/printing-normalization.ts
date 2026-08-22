/**
 * Converts provider-specific printing fields into the app's stable treatment
 * vocabulary. Providers disagree on casing and field names, so keep this in
 * one place for the MTGJSON index and Scryfall fallback paths.
 */
export function treatmentsForRawPrinting(print: Record<string, any>) {
  const values = [
    ...(Array.isArray(print.frameEffects) ? print.frameEffects : []),
    ...(Array.isArray(print.frame_effects) ? print.frame_effects : []),
    ...(Array.isArray(print.promoTypes) ? print.promoTypes : []),
    ...(Array.isArray(print.promo_types) ? print.promo_types : []),
  ];
  const effects = new Set(values.map((value) => String(value).toLowerCase().replace(/[^a-z]/g, "")));
  const frameVersion = String(print.frameVersion ?? print.frame_version ?? print.frame ?? "");
  const borderless = String(print.borderColor ?? print.border_color ?? "").toLowerCase() === "borderless"
    || effects.has("borderless");
  // The original Magic card frame is a reliable retro signal. boosterfun alone
  // is deliberately not: it also covers showcase, borderless, and other variants.
  if (frameVersion === "1997" || effects.has("retroframe") || effects.has("oldframe") || effects.has("retro")) return ["retro"];
  // Explicit frame effects are more specific than generic full-art/border metadata.
  // In particular, never turn one extended-art record into both Extended Art and
  // Borderless merely because a provider also describes its border as borderless.
  if (effects.has("extendedart")) return ["extended-art"];
  if (effects.has("showcase")) return ["showcase"];
  if (borderless) return ["borderless"];
  if (print.isFullArt || print.full_art || effects.has("fullart")) return ["full-art"];
  return ["standard"];
}

/** Foil technology is independent of the card's visual/frame treatment. */
export function foilTreatmentForRawPrinting(print: Record<string, any>) {
  const values = [
    ...(Array.isArray(print.promoTypes) ? print.promoTypes : []),
    ...(Array.isArray(print.promo_types) ? print.promo_types : []),
    ...(Array.isArray(print.finishes) ? print.finishes : []),
    print.finish,
    print.printing,
  ];
  return print.isSurgeFoil || print.surgeFoil || values.some((value) => {
    const normalized = String(value || "").toLowerCase().replace(/[^a-z]/g, "");
    return normalized === "surgefoil" || normalized === "surge";
  })
    ? "surge" as const
    : "standard" as const;
}

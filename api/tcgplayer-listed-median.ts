const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,OPTIONS",
  "access-control-allow-headers": "content-type",
};

function jsonResponse(body: unknown, status = 200, cacheControl = "no-store") {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      "content-type": "application/json; charset=utf-8",
      "cache-control": cacheControl,
    },
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const productIds = Array.from(new Set(
    String(url.searchParams.get("productIds") || url.searchParams.get("productId") || "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => /^\d+$/.test(value)),
  )).slice(0, 25);

  if (!productIds.length) return jsonResponse({ error: "At least one numeric TCGplayer product ID is required." }, 400);

  try {
    const entries = await Promise.all(productIds.map(async (productId) => {
      const headers = {
        Accept: "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; rrg-pull-list-formatter/0.4.1)",
      };
      const [detailsResponse, pricePointsResponse] = await Promise.all([
        fetch(`https://mp-search-api.tcgplayer.com/v1/product/${productId}/details`, {
          cache: "no-store",
          headers,
        }),
        fetch(`https://mpapi.tcgplayer.com/v2/product/${productId}/pricepoints`, {
          cache: "no-store",
          headers,
        }),
      ]);
      if (!detailsResponse.ok) throw new Error(`TCGplayer returned ${detailsResponse.status} for product ${productId}.`);
      const details = await detailsResponse.json();
      const pricePointsPayload = pricePointsResponse.ok ? await pricePointsResponse.json() : {};
      const rawComparisonPoints = Array.isArray(pricePointsPayload)
        ? pricePointsPayload
        : Array.isArray(pricePointsPayload?.value) ? pricePointsPayload.value : [];
      const comparisonPoints = rawComparisonPoints
        .filter((point: unknown) => point && typeof point === "object");
      return [productId, [
        {
          printingType: "Storefront",
          listedMedianPrice: typeof details.medianPrice === "number" ? details.medianPrice : null,
        },
        ...comparisonPoints,
      ]] as const;
    }));

    return jsonResponse({ prices: Object.fromEntries(entries) });
  } catch (error) {
    return jsonResponse({ error: error instanceof Error ? error.message : "TCGplayer pricing failed." }, 502);
  }
}

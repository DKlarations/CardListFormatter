import { get } from "@vercel/blob";

const MANIFEST_PATHNAME = "mtgjson/card-index-manifest.json";

function env(name: string, fallback = "") {
  return process.env[name] || fallback;
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function GET() {
  try {
    const manifest = await get(MANIFEST_PATHNAME, {
      access: "public",
      useCache: false,
      token: env("BLOB_READ_WRITE_TOKEN") || undefined,
    });

    if (!manifest?.stream) {
      return jsonResponse({ error: "MTGJSON index manifest has not been published yet." }, 404);
    }

    return new Response(manifest.stream, {
      headers: {
        "content-type": manifest.blob.contentType || "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected error.";
    return jsonResponse({ error: message }, 500);
  }
}

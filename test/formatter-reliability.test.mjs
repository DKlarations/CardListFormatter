import assert from "node:assert/strict";
import test from "node:test";
import { createFixture, withHarness, remoteRequestCount, assertPacing, MANIFEST_URL } from "../tools/benchmark/formatter-harness.mjs";

async function rewriteResponses(rewrite, work) {
  const fetcher = globalThis.fetch;
  globalThis.fetch = async (input, options) => {
    const response = await fetcher(input, options);
    return rewrite(new URL(typeof input === "string" ? input : input.url), response);
  };
  try { return await work(); }
  finally { globalThis.fetch = fetcher; }
}

test("complete histories revalidate failed foil and set requests without fetching them again", async () => {
  await withHarness(createFixture({ text: "Sol Ring FOIL" }), async ({ formatter, fixture, counters }) => {
    const source = formatter.parsePullList(fixture.text).cards[0];
    const nonfoil = { ...fixture.providerCards.get("Sol Ring"), foil: false, finishes: ["nonfoil"] };
    const complete = { ...source, status: "found", card: nonfoil, prints: [nonfoil], eligibleRarityChecked: true, printLookupFailed: false };
    const [foil] = await formatter.enrichPrintHistories([complete], false, [], () => {}, false, { enrichmentPurpose: "formatter", signal: null });
    assert.equal(foil.status, "review");
    assert.match(foil.note, /FOIL version not found/);
    const [requestedSet] = await formatter.enrichPrintHistories([
      { ...complete, specialRequests: [], requestedPrinting: { setCode: "NEW" } },
    ], false, [], () => {}, false, { enrichmentPurpose: "formatter", signal: null });
    assert.equal(requestedSet.status, "review");
    assert.match(requestedSet.note, /Requested set not found/);
    assert.equal(counters.exact + counters.history + counters.collection, 0);
    assert.equal(complete.status, "found", "Revalidation does not mutate the prior item");
  });
});

test("Retry Needs Review retains nonmatching foil history as review after exact MTGJSON resolution", async () => {
  const fixture = createFixture({ text: "Sol Ring FOIL\nCounterspell" });
  Object.assign(fixture.providerCards.get("Sol Ring"), { foil: false, finishes: ["nonfoil"] });
  await withHarness(fixture, async ({ format, formatter, counters }) => {
    const first = await format();
    assert.equal(first.items[0].status, "review");
    const historyCount = counters.history;
    const options = { enrichmentPurpose: "formatter", signal: null };
    const retryInput = first.items.filter((item) => item.status === "review").map((item) => ({ ...item, status: "missing", note: "" }));
    const resolved = await formatter.resolveCardNames(retryInput, () => {}, false, options);
    const retried = await formatter.enrichPrintHistories(resolved, false, [], () => {}, false, options);
    assert.equal(retried[0].status, "review");
    assert.match(retried[0].note, /FOIL version not found/);
    assert.equal(counters.history, historyCount, "Existing complete history is sufficient to revalidate the request");
    assert.equal(first.items[1].status, "found");
  });
});

test("complete nonpaper history cannot be promoted into the verified pull list", async () => {
  await withHarness(createFixture({ text: "Sol Ring" }), async ({ formatter, fixture, counters }) => {
    const source = formatter.parsePullList(fixture.text).cards[0];
    const digital = { ...fixture.providerCards.get("Sol Ring"), digital: true, games: ["arena"] };
    const [result] = await formatter.enrichPrintHistories([
      { ...source, status: "found", card: digital, prints: [digital], eligibleRarityChecked: true, printLookupFailed: false },
    ], false, [], () => {}, false, { enrichmentPurpose: "formatter", signal: null });
    assert.equal(result.status, "review");
    assert.match(result.note, /Not a playable paper card/);
    assert.equal(counters.exact + counters.history + counters.collection, 0);
  });
});

test("one malformed history preserves other cards and is retryable after the provider recovers", async () => {
  const fixture = createFixture({ text: "Sol Ring FOIL\nCounterspell FOIL" });
  await withHarness(fixture, async ({ format, counters }) => {
    const oracle = fixture.providerCards.get("Sol Ring").oracle_id;
    const broken = await rewriteResponses((url, response) => (
      url.searchParams.get("q") === `oracleid:${oracle}`
        ? new Response(JSON.stringify({ data: { unexpected: true } }), { status: 200 })
        : response
    ), format);
    assert.equal(broken.items.length, 2);
    assert.equal(broken.items[0].status, "review");
    assert.equal(broken.items[0].printLookupFailed, true);
    assert.equal(broken.items[1].status, "found");
    assertPacing(broken);
    const before = counters.history;
    const recovered = await format();
    assert.equal(recovered.items[0].status, "found", "A malformed HTTP 200 must not poison subsequent retries");
    assert.ok(counters.history > before, "Recovery refetches the rejected history without clearing all caches");
    assert.equal(recovered.items[1].status, "found");
  });
});

test("cyclic print pagination terminates and remains recoverable without evicting unrelated cards", async () => {
  const fixture = createFixture({ text: "Sol Ring FOIL\nCounterspell" });
  await withHarness(fixture, async ({ format }) => {
    const oracle = fixture.providerCards.get("Sol Ring").oracle_id;
    const broken = await rewriteResponses(async (url, response) => {
      if (url.searchParams.get("q") !== `oracleid:${oracle}`) return response;
      const body = await response.json();
      return new Response(JSON.stringify({ ...body, has_more: true, next_page: url.href }), { status: 200 });
    }, format);
    assert.equal(broken.items[0].status, "review");
    assert.equal(broken.items[1].status, "found");
    assert.ok(broken.counts.history <= 3, "Each bounded pass detects a repeated page immediately");
    const recovered = await format();
    assert.equal(recovered.items[0].status, "found", "Cyclic pages must not persist as successful cache entries");
  });
});

test("failed recent Case Check facts mark affected cards for review while keeping tokens and basics", async () => {
  const fixture = createFixture({ text: "Sol Ring\n2 Goblin Token\nIsland", caseCheck: true });
  const result = await withHarness(fixture, ({ format }) => rewriteResponses((url, response) => (
    url.pathname === "/sets" ? new Response(JSON.stringify({ data: {} }), { status: 200 }) : response
  ), format));
  assert.equal(result.items[0].status, "review");
  assert.ok(result.items[1].isToken);
  assert.equal(result.items[1].status, "found");
  assert.ok(result.items[2].isBasicLand);
  assert.equal(result.items[2].status, "found");
  assert.ok(remoteRequestCount(result) > 0);
  assertPacing(result);
});

test("generated server processPullListText matches browser formatting without browser storage or pricing enrichment", async () => {
  await withHarness(createFixture(), async ({ format, fixture, counters }) => {
    const browserResult = await format();
    const remoteBefore = counters.collection + counters.exact + counters.fuzzy + counters.history;
    const browserGlobals = ["window", "caches", "localStorage"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
    for (const [key] of browserGlobals) delete globalThis[key];
    try {
      const serverFormatter = await import("../server/generated/server-formatter.mjs?reliability-server");
      const serverResult = await serverFormatter.processPullListText(fixture.text, {
        mtgjsonManifestUrl: MANIFEST_URL,
        processedAt: "2026-09-07T12:00:00.000Z",
      });
      assert.equal(serverResult.output, browserResult.output);
      assert.equal(serverResult.items.length, 30);
      assert.ok(serverResult.items.every((item) => item.status === "found" && !item.prints));
      assert.equal(counters.collection + counters.exact + counters.fuzzy + counters.history, remoteBefore);
      const compact = JSON.parse(JSON.stringify(serverFormatter.compactFormatterItems(serverResult.items)));
      assert.deepEqual(compact.map((item) => item.card.name), serverResult.items.map((item) => item.card.name));
      assert.deepEqual(compact.map((item) => item.index), serverResult.items.map((item) => item.index));
      assert.ok(compact.every((item) => !item.prints));
    } finally {
      for (const [key, descriptor] of browserGlobals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      }
    }
  });
});

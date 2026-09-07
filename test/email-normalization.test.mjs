import assert from "node:assert/strict";
import test from "node:test";
import { parsePullList, processPullListText } from "../server/generated/server-formatter.mjs";
import { emailBodyText, formatEmailForTeams } from "../tools/test/email-to-teams/src/format-email.js";

const names = ["Ajani, Mentor of Heroes", "Death-Greeter's Champion"];
const fragments = ["Ajani", "Mentor of Heroes", "Death", "Greeter's Champion"];
const htmlTable = `<table>
  <tr><th>Card Name</th><th>Rarity</th><th>Quantity</th></tr>
  <tr><td>Ajani, Mentor of Heroes</td><td>M</td><td>2</td></tr>
  <tr><td>Death-Greeter&#39;s Champion</td><td>R</td><td>1</td></tr>
</table>`;

function email(body) {
  return {
    subject: "MTG pull list",
    from: { text: "Pat Example <pat@example.test>" },
    date: new Date("2026-09-07T12:00:00Z"),
    ...body,
  };
}

function assertCompleteCards(parsed) {
  assert.equal(parsed.cardLineCount, 2);
  assert.deepEqual(parsed.cards.map((card) => card.inputName), names);
  assert.deepEqual(parsed.cards.map((card) => card.quantity), [2, 1]);
  assert.deepEqual(parsed.cards.map((card) => card.statedRarities), [["mythic"], ["rare"]]);
  assert.deepEqual(parsed.cards.map((card) => card.lookupKey), ["ajani mentor of heroes", "deathgreeters champion"]);
  assert.ok(parsed.cards.every((card) => !fragments.includes(card.inputName)));
  assert.ok(parsed.cards.every((card) => !/,(?:\s*M)?$/.test(card.inputName)));
}

for (const [kind, text] of [
  ["plain comma-delimited", "Ajani, Mentor of Heroes, M, 2\nDeath-Greeter's Champion, R, 1"],
  ["tab-separated", "Ajani, Mentor of Heroes\tM\t2\nDeath-Greeter's Champion\tR\t1"],
  ["multiple-space table", "Ajani, Mentor of Heroes    M    2\nDeath-Greeter's Champion    R    1"],
]) {
  test(`email ${kind} input preserves complete names and metadata through the public parser`, () => {
    const summary = formatEmailForTeams(email({ text }));
    assert.equal(summary.body, text);
    assertCompleteCards(parsePullList(summary.formatterInput));
  });
}

test("HTML email table conversion preserves row and cell boundaries and punctuation", () => {
  const summary = formatEmailForTeams(email({ html: htmlTable }));
  assert.equal(summary.body, "Card Name\tRarity\tQuantity\nAjani, Mentor of Heroes\tM\t2\nDeath-Greeter's Champion\tR\t1");
  assertCompleteCards(parsePullList(summary.formatterInput));
});

test("HTML email punctuation survives through final formatter output with providers disabled", async () => {
  const summary = formatEmailForTeams(email({ html: htmlTable }));
  const result = await processPullListText(summary.formatterInput, { useMtgjson: false, useScryfall: false });
  assertCompleteCards({ cards: result.items, cardLineCount: result.items.length });
  for (const name of names) assert.ok(result.output.includes(name));
  assert.doesNotMatch(result.output, /^\[ \] \d+ (?:Ajani|Death|Mentor of Heroes|Greeter's Champion)(?:\s+\(|$)/m);
});

test("HTML text conversion decodes name punctuation without removing quoted name characters", () => {
  const body = emailBodyText({ html: "<p>&quot;Ajani, Mentor of Heroes&quot;, M</p><p>Death-Greeter&apos;s Champion &mdash; R</p><p>Fire &amp; Ice &#47;&#47; Faith &#x2F; Hope &ndash; Uncommon</p>" });
  assert.equal(body, '"Ajani, Mentor of Heroes", M\nDeath-Greeter\'s Champion — R\nFire & Ice // Faith / Hope – Uncommon');
});

test("email conversion continues to prefer supplied plain text and trim quoted replies", () => {
  const text = "Ajani, Mentor of Heroes, M\nDeath-Greeter's Champion\n\nOn Monday, Pat wrote:\nAn older card list";
  assert.equal(emailBodyText({ text, html: "<p>Different HTML alternative</p>" }), "Ajani, Mentor of Heroes, M\nDeath-Greeter's Champion");
});

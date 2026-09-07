import assert from "node:assert/strict";
import test from "node:test";
import { simpleParser } from "mailparser";
import { parsePullList } from "../../../../api/server-formatter.mjs";
import { emailParserOptions, formatEmailForTeams } from "../src/format-email.js";

function message(contentType, body) {
  return [
    "From: Pat Example <pat@example.test>",
    "Subject: MTG pull list",
    "Date: Mon, 07 Sep 2026 12:00:00 +0000",
    "MIME-Version: 1.0",
    `Content-Type: ${contentType}`,
    "",
    body,
  ].join("\r\n");
}

for (const [kind, html] of [
  ["compact", "<table><tr><td>Ajani, Mentor of Heroes</td><td>M</td><td>2</td></tr><tr><td>Death-Greeter&#39;s Champion</td><td>R</td><td>1</td></tr></table>"],
  ["block-formatted", `<table>
    <tr><td><p>Ajani, Mentor of Heroes</p></td><td><p>M</p></td><td><p>2</p></td></tr>
    <tr><td><span>Death</span>-Greeter&apos;s Champion</td><td>R</td><td>1</td></tr>
  </table>`],
]) {
  test(`HTML-only ${kind} MIME email reaches the formatter with complete cells and names`, async () => {
    const parsedMessage = await simpleParser(message("text/html; charset=utf-8", html), emailParserOptions);
    const summary = formatEmailForTeams(parsedMessage);
    assert.equal(summary.body, "Ajani, Mentor of Heroes\tM\t2\nDeath-Greeter's Champion\tR\t1");
    const parsed = parsePullList(summary.formatterInput);
    assert.deepEqual(parsed.cards.map((card) => card.inputName), ["Ajani, Mentor of Heroes", "Death-Greeter's Champion"]);
    assert.deepEqual(parsed.cards.map((card) => card.quantity), [2, 1]);
    assert.deepEqual(parsed.cards.map((card) => card.statedRarities), [["mythic"], ["rare"]]);
    assert.ok(parsed.cards.every((card) => !["Ajani", "Death", "Mentor of Heroes", "Greeter's Champion"].includes(card.inputName)));
  });
}

test("multipart MIME email continues to use its genuine plain text alternative", async () => {
  const text = "Ajani, Mentor of Heroes, M, 2\r\nDeath-Greeter's Champion, R, 1";
  const body = [
    "--pullsmith-test",
    "Content-Type: text/plain; charset=utf-8",
    "",
    text,
    "--pullsmith-test",
    "Content-Type: text/html; charset=utf-8",
    "",
    "<p>A different HTML alternative</p>",
    "--pullsmith-test--",
  ].join("\r\n");
  const parsedMessage = await simpleParser(message('multipart/alternative; boundary="pullsmith-test"', body), emailParserOptions);
  assert.equal(formatEmailForTeams(parsedMessage).body.replace(/\r\n/g, "\n"), text.replace(/\r\n/g, "\n"));
});

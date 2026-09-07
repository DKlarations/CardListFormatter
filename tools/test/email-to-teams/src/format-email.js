import { buildPullListTeamsCard, initialTeamsCardPayload } from "../../../../shared/pull-list-teams-card.mjs";

// Keep genuine plain text MIME parts, but let our fallback preserve HTML table cells.
export const emailParserOptions = { skipHtmlToText: true };

function decodeHtmlEntities(value) {
  const named = {
    nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
    ndash: "–", mdash: "—", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”",
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name) => {
    if (!name.startsWith("#")) return named[name.toLowerCase()] ?? entity;
    const hexadecimal = name[1].toLowerCase() === "x";
    const codePoint = Number.parseInt(name.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    return codePoint > 0 && codePoint <= 0x10ffff && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
      ? String.fromCodePoint(codePoint)
      : entity;
  });
}

function plainTextFromMessage(parsed) {
  const text = parsed.text?.trim();
  if (text) return text;

  const htmlText = (parsed.html || "")
    .replace(/\r?\n/g, " ")
    // Cell contents can contain block markup; keep that whitespace inside the cell.
    .replace(/<(td|th)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi, (_match, _tag, content) => (
      `${content.replace(/<br\s*\/?>|<\/(?:p|div)>/gi, " ")}\t`
    ))
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:tr|p|div|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "");

  return decodeHtmlEntities(htmlText)
    .split("\n")
    .map((line) => line.replace(/[ \u00a0]+/g, " ").replace(/ *\t */g, "\t").trim())
    .filter(Boolean)
    .join("\n");
}

function trimQuotedReply(text) {
  const quoteMarkers = [
    /^On .+ wrote:$/im,
    /^From:\s.+$/im,
    /^-{2,}\s*Original Message\s*-{2,}$/im,
  ];

  const markerIndexes = quoteMarkers
    .map((pattern) => text.search(pattern))
    .filter((index) => index > 0);

  if (!markerIndexes.length) return text;
  return text.slice(0, Math.min(...markerIndexes)).trim();
}

export function formatEmailForTeams(parsed) {
  const subject = parsed.subject || "(no subject)";
  const from = parsed.from?.text || "unknown sender";
  const receivedAt = (parsed.date || new Date()).toISOString();
  const body = emailBodyText(parsed);
  const text = [
    `From: ${from}`,
    `Subject: ${subject}`,
    `Received: ${receivedAt}`,
    ``,
    body || "(No readable body text found.)",
  ].join("\n");

  return {
    subject,
    from,
    receivedAt,
    body,
    formatterInput: text,
    text,
  };
}

export function emailBodyText(parsed) {
  return trimQuotedReply(plainTextFromMessage(parsed));
}

export function makeTeamsPayload(formatted) {
  const card = formatted.card || buildPullListTeamsCard({
    jobId: formatted.jobId,
    emailDisplay: {
      sender: formatted.from,
      subject: formatted.subject,
      receivedAt: formatted.receivedAt,
      body: formatted.body || formatted.text,
    },
    formatterUrl: formatted.formatterUrl,
    checkEmailNowUrl: formatted.checkEmailNowUrl,
    statusUrls: formatted.statusUrls,
    printStatus: formatted.printStatus,
  });
  return initialTeamsCardPayload(formatted.jobId || "", card);
}

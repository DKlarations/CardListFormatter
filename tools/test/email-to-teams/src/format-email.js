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

function cardActions(formatted) {
  const actions = [];

  if (formatted.formatterUrl) {
    actions.push({
      type: "Action.OpenUrl",
      title: formatted.formatterActionTitle || "Open Formatted List",
      url: formatted.formatterUrl,
    });
  }

  if (formatted.checkEmailNowUrl) {
    actions.push({
      type: "Action.OpenUrl",
      title: "Check Email Now",
      url: formatted.checkEmailNowUrl,
    });
  }

  return actions;
}

export function formatEmailForTeams(parsed) {
  const subject = parsed.subject || "(no subject)";
  const from = parsed.from?.text || "unknown sender";
  const receivedAt = parsed.date ? parsed.date.toLocaleString() : new Date().toLocaleString();
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
  const cardText = formatted.text.length > 12000
    ? `${formatted.text.slice(0, 12000)}\n\n[Message truncated for Teams card size.]`
    : formatted.text;

  return {
    type: "message",
    attachments: [
      {
        contentType: "application/vnd.microsoft.card.adaptive",
        contentUrl: null,
        content: {
          $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
          type: "AdaptiveCard",
          version: "1.2",
          body: [
            {
              type: "TextBlock",
              text: "New Pull List Received:",
              weight: "Bolder",
              size: "Medium",
            },
            {
              type: "TextBlock",
              text: cardText,
              wrap: true,
            },
          ],
          actions: cardActions(formatted),
        },
      },
    ],
  };
}

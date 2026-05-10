function plainTextFromMessage(parsed) {
  const text = parsed.text?.trim();
  if (text) return text;

  return (parsed.html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
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
  const receivedAt = parsed.date ? parsed.date.toLocaleString() : new Date().toLocaleString();
  const body = trimQuotedReply(plainTextFromMessage(parsed));

  return {
    subject,
    text: [
      `Pull list email received`,
      ``,
      `From: ${from}`,
      `Subject: ${subject}`,
      `Received: ${receivedAt}`,
      ``,
      body || "(No readable body text found.)",
    ].join("\n"),
  };
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
              text: "RRG Pull List Formatter",
              weight: "Bolder",
              size: "Medium",
            },
            {
              type: "TextBlock",
              text: cardText,
              wrap: true,
            },
          ],
        },
      },
    ],
  };
}

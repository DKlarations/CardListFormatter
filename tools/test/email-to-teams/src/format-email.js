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

function cardActions(formatted) {
  const actions = [];

  if (formatted.formatterUrl) {
    actions.push({
      type: "Action.OpenUrl",
      title: "Open in Formatter",
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

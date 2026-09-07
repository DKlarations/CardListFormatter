const STORE_TIME_ZONE = "America/Chicago";

export function storeTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-US", {
    timeZone: STORE_TIME_ZONE, month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  }).format(date);
}

/** Complete replacement card; never truncate the stored original email content. */
export function buildPullListTeamsCard({
  jobId = "", emailDisplay = {}, formatterUrl = "", checkEmailNowUrl = "", statusUrls = {}, printStatus = {},
} = {}) {
  const received = storeTimestamp(emailDisplay.receivedAt) || emailDisplay.receivedAt || "Unknown";
  const text = [
    `From: ${emailDisplay.sender || "unknown sender"}`,
    `Subject: ${emailDisplay.subject || "(no subject)"}`,
    `Received: ${received}`,
    "",
    emailDisplay.body || "(No readable body text found.)",
  ].join("\n");
  const statusLine = (label, value) => {
    const timestamp = storeTimestamp(value);
    return `${label}: ${timestamp ? `Printed ${timestamp}` : "Not printed"}`;
  };
  const actions = [];
  if (formatterUrl) actions.push({ type: "Action.OpenUrl", title: "Open Formatted List", url: formatterUrl });
  if (checkEmailNowUrl) actions.push({ type: "Action.OpenUrl", title: "Check Email Now", url: checkEmailNowUrl });
  if (jobId && statusUrls["pull-list"]) {
    actions.push({ type: "Action.OpenUrl", title: "Mark Pull List Printed", url: statusUrls["pull-list"] });
  }
  if (jobId && statusUrls.pricing) {
    actions.push({ type: "Action.OpenUrl", title: "Mark Pricing Printed", url: statusUrls.pricing });
  }
  return {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    type: "AdaptiveCard",
    version: "1.2",
    body: [
      { type: "TextBlock", text: "New Pull List Received:", weight: "Bolder", size: "Medium", wrap: true },
      { type: "TextBlock", text, wrap: true },
      { type: "TextBlock", text: statusLine("Pull List", printStatus.pullListPrintedAt), wrap: true, spacing: "Medium" },
      { type: "TextBlock", text: statusLine("Pricing", printStatus.pricingPrintedAt), wrap: true, spacing: "Small" },
    ],
    actions,
  };
}

/** Workflow receives the job identity before posting and registering the original message. */
export function initialTeamsCardPayload(jobId, card) {
  return {
    operation: "post-card",
    jobId,
    idempotencyKey: `pull-list:${jobId}:initial`,
    card,
    type: "message",
    attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", contentUrl: null, content: card }],
  };
}

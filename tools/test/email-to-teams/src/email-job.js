import { saveEmailPullListJob } from "./formatted-list-store.js";
import { makeTeamsPayload } from "./format-email.js";

export function formattedStateForProcessed(formatted, processed, compactFormatterItems) {
  return {
    input: formatted.formatterInput,
    output: processed.output,
    processedAt: processed.processedAt,
    customer: processed.customer,
    formatterItems: compactFormatterItems(processed.items),
    formatterSettings: { useCheckboxes: true },
    stats: {
      resolvedCount: processed.items.filter((item) => item.status === "found").length,
      needsReviewCount: processed.items.filter((item) => item.status !== "found").length,
      printFallbackCount: processed.items.filter((item) => item.status === "found" && item.printLookupFailed).length,
    },
  };
}

export async function prepareEmailForTeams(formatted, config, {
  processPullListText, compactFormatterItems, save = saveEmailPullListJob, dryRun = false,
}) {
  const processed = await processPullListText(formatted.formatterInput, { useCheckboxes: true });
  if (dryRun) return formatted;
  const saved = await save(config, formattedStateForProcessed(formatted, processed, compactFormatterItems), {
    sender: formatted.from, subject: formatted.subject, receivedAt: formatted.receivedAt, body: formatted.body,
  });
  return { ...formatted, jobId: saved.id, formatterUrl: saved.url, card: saved.card, alreadyPosted: saved.alreadyPosted };
}

/** One root card per resolved job in a mailbox run, including duplicate emails with different message IDs. */
export async function postPreparedEmail(formatted, postedJobIds, post) {
  if (!formatted.jobId) throw new Error("A saved PullListJob is required before posting to Teams.");
  if (formatted.alreadyPosted || postedJobIds.has(formatted.jobId)) return false;
  await post(makeTeamsPayload(formatted));
  postedJobIds.add(formatted.jobId);
  return true;
}

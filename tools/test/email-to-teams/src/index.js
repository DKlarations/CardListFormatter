import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import process from "node:process";
import { processPullListText } from "../../../../src/formatter.ts";
import { readConfig, validateConfig } from "./config.js";
import { formatEmailForTeams, makeTeamsPayload } from "./format-email.js";
import { loadProcessedStore, saveProcessedStore } from "./processed-store.js";
import { postToTeams } from "./teams.js";

function hasFlag(name) {
  return process.argv.includes(name);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageKey(message, parsed) {
  return parsed.messageId || `${message.uid}:${parsed.date?.toISOString() || parsed.subject || "no-subject"}`;
}

function subjectMatches(parsed, subjectFilter) {
  if (!subjectFilter) return true;
  return (parsed.subject || "").toLowerCase().includes(subjectFilter);
}

async function formatMessage(parsed, config) {
  const emailSummary = formatEmailForTeams(parsed);

  if (!config.formatWithAppFormatter) {
    return emailSummary;
  }

  const result = await processPullListText(emailSummary.body, {
    useCheckboxes: true,
    carefulMode: true,
    setMessage: (message) => console.log(`Formatter: ${message}`),
  });

  return {
    subject: emailSummary.subject,
    text: [
      "Pull list formatted from email",
      "",
      `From: ${emailSummary.from}`,
      `Subject: ${emailSummary.subject}`,
      `Received: ${emailSummary.receivedAt}`,
      result.reliabilityNote ? `Note: ${result.reliabilityNote}` : "",
      "",
      result.output,
    ].filter((line, index, lines) => line || lines[index - 1] !== "").join("\n"),
  };
}

async function inspectMailbox(config, processedIds, dryRun) {
  const client = new ImapFlow({
    host: config.imap.host,
    port: config.imap.port,
    secure: config.imap.secure,
    auth: {
      user: config.imap.user,
      pass: config.imap.password,
    },
    logger: false,
  });

  await client.connect();

  try {
    const lock = await client.getMailboxLock(config.imap.mailbox);
    try {
      const unseen = await client.search({ seen: false });
      let processedCount = 0;
      if (!unseen.length) return processedCount;

      for await (const message of client.fetch(unseen, { uid: true, source: true })) {
        const parsed = await simpleParser(message.source);
        const key = messageKey(message, parsed);

        if (processedIds.has(key) || !subjectMatches(parsed, config.subjectFilter)) {
          continue;
        }

        const formatted = await formatMessage(parsed, config);
        const payload = makeTeamsPayload(formatted);

        if (dryRun) {
          console.log("DRY RUN: would post to Teams:");
          console.log(JSON.stringify(payload, null, 2));
        } else {
          await postToTeams(config.teamsWebhookUrl, payload);
          console.log(`Posted "${formatted.subject}" to Teams.`);

          if (config.markProcessedSeen) {
            await client.messageFlagsAdd(message.uid, ["\\Seen"], { uid: true });
          }
        }

        processedIds.add(key);
        processedCount += 1;
      }

      return processedCount;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

async function runOnce(config, dryRun) {
  const processedIds = await loadProcessedStore(config.processedStore);
  const processedCount = await inspectMailbox(config, processedIds, dryRun);
  await saveProcessedStore(config.processedStore, processedIds);
  console.log(processedCount ? `Processed ${processedCount} new email(s).` : "No new matching emails.");
}

async function main() {
  const config = readConfig();
  const dryRun = hasFlag("--dry-run") || config.dryRun;
  const runOnlyOnce = hasFlag("--once");

  validateConfig({ ...config, dryRun });

  do {
    try {
      await runOnce(config, dryRun);
    } catch (error) {
      console.error(error.stack || error.message || error);
    }

    if (runOnlyOnce) break;
    await sleep(config.pollIntervalSeconds * 1000);
  } while (true);
}

main();

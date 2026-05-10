import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import process from "node:process";
import { readConfig, validateConfig } from "./config.js";
import { formatEmailForTeams, makeTeamsPayload } from "./format-email.js";
import { loadProcessedStore, saveProcessedStore } from "./processed-store.js";
import { postToTeams } from "./teams.js";
import { formatterLinkForInput } from "./share-link.js";

function hasFlag(name) {
  return process.argv.includes(name);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageKey(message, parsed) {
  return parsed.messageId || `${message.uid}:${parsed.date?.toISOString() || parsed.subject || "no-subject"}`;
}

function messageSortTime(candidate) {
  return (
    candidate.parsed.date?.getTime()
    || candidate.message.internalDate?.getTime()
    || 0
  );
}

function subjectMatches(parsed, subjectFilter) {
  if (!subjectFilter) return true;
  return (parsed.subject || "").toLowerCase().includes(subjectFilter);
}

function formatMessage(parsed, config) {
  const emailSummary = formatEmailForTeams(parsed);

  return {
    ...emailSummary,
    formatterUrl: formatterLinkForInput(config.formatterBaseUrl, emailSummary.formatterInput),
  };
}

function formatDateForLog(value) {
  if (!value) return "unknown date";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "unknown date" : date.toISOString();
}

function looksLikePullList(parsed, emailSummary, subjectFilter) {
  if (subjectMatches(parsed, subjectFilter)) return true;
  const searchableText = `${parsed.subject || ""}\n${emailSummary.body}`.toLowerCase();
  return /\b(mtg|magic|pull\s*list|red\s*raccoon|scryfall)\b/.test(searchableText);
}

function cutoffDate(maxEmailAgeDays) {
  const date = new Date();
  date.setDate(date.getDate() - maxEmailAgeDays);
  date.setHours(0, 0, 0, 0);
  return date;
}

function maskedEmail(value) {
  return value.replace(/^(.{2}).*(@.*)$/, "$1***$2");
}

function errorDetails(error) {
  return [
    error.stack || error.message || String(error),
    error.code ? `Code: ${error.code}` : "",
    error.responseStatus ? `IMAP status: ${error.responseStatus}` : "",
    error.responseText ? `IMAP response: ${error.responseText}` : "",
    error.executedCommand ? `IMAP command: ${error.executedCommand}` : "",
    error.serverResponseCode ? `Server response code: ${error.serverResponseCode}` : "",
  ].filter(Boolean).join("\n");
}

async function inspectMailbox(config, processedIds, dryRun) {
  console.log(`Checking ${maskedEmail(config.imap.user)} on ${config.imap.host}:${config.imap.port}, mailbox "${config.imap.mailbox}".`);

  const client = new ImapFlow({
    host: config.imap.host,
    port: config.imap.port,
    secure: config.imap.secure,
    auth: {
      user: config.imap.user,
      pass: config.imap.password,
    },
    disableAutoIdle: true,
    logger: false,
  });
  client.on("error", (error) => {
    console.warn(`IMAP warning: ${error.message || error}`);
  });

  await client.connect();

  try {
    const lock = await client.getMailboxLock(config.imap.mailbox);
    try {
      const since = cutoffDate(config.maxEmailAgeDays);
      const unseen = await client.search({ seen: false, since }, { uid: true });
      let processedCount = 0;
      console.log(`Mailbox "${config.imap.mailbox}" has ${unseen.length} unread email(s) since ${since.toISOString().slice(0, 10)}.`);
      if (!unseen.length) return processedCount;
      const candidates = [];

      for (const uid of unseen) {
        const message = await client.fetchOne(uid, {
          uid: true,
          source: true,
          envelope: true,
          internalDate: true,
        }, { uid: true });
        if (!message?.source) {
          console.log(`Skipping UID ${uid}: no message source returned.`);
          continue;
        }

        const parsed = await simpleParser(message.source);
        const key = messageKey(message, parsed);
        const formatted = formatMessage(parsed, config);
        console.log(
          `Candidate UID ${message.uid}: "${formatted.subject}" from ${formatted.from}. `
          + `Parsed date: ${formatDateForLog(parsed.date)}. Internal date: ${formatDateForLog(message.internalDate)}.`,
        );

        if (processedIds.has(key)) {
          console.log(`Skipping "${formatted.subject}": already processed in this run store.`);
          continue;
        }

        if (!looksLikePullList(parsed, formatted, config.subjectFilter)) {
          console.log(`Skipping "${formatted.subject}": does not match subject/body pull-list filters.`);
          continue;
        }

        candidates.push({ message, parsed, key, formatted });
      }

      candidates.sort((a, b) => messageSortTime(a) - messageSortTime(b));

      for (const { message, key, formatted } of candidates) {
        const payload = makeTeamsPayload(formatted);

        if (dryRun) {
          console.log("DRY RUN: would post to Teams:");
          console.log(JSON.stringify(payload, null, 2));
        } else {
          await postToTeams(config.teamsWebhookUrl, payload);
          console.log(`Posted "${formatted.subject}" to Teams.`);

          if (config.markProcessedSeen) {
            const updated = await client.messageFlagsAdd(message.uid, ["\\Seen"], { uid: true });
            const verified = await client.fetchOne(message.uid, { uid: true, flags: true }, { uid: true });
            const isSeen = verified?.flags?.has("\\Seen") || verified?.flags?.has("\\seen");
            console.log(
              isSeen
                ? `Marked "${formatted.subject}" as read.`
                : `Tried to mark "${formatted.subject}" as read, but verification did not show \\Seen. STORE result: ${updated}`,
            );
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
    if (!client.closed) {
      await client.logout().catch((error) => {
        console.warn(`IMAP logout warning: ${error.message || error}`);
      });
    }
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
      console.error(errorDetails(error));
    }

    if (runOnlyOnce) break;
    await sleep(config.pollIntervalSeconds * 1000);
  } while (true);
}

main();

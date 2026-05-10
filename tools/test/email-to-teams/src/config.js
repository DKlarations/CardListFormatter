import path from "node:path";
import process from "node:process";
import "dotenv/config";

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function envBoolean(name, fallback = false) {
  const value = env(name);
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function envNumber(name, fallback) {
  const value = Number(env(name));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function readConfig() {
  return {
    imap: {
      host: env("IMAP_HOST"),
      port: envNumber("IMAP_PORT", 993),
      secure: envBoolean("IMAP_SECURE", true),
      user: env("IMAP_USER"),
      password: env("IMAP_PASSWORD"),
      mailbox: env("IMAP_MAILBOX", "INBOX"),
    },
    teamsWebhookUrl: env("TEAMS_WEBHOOK_URL"),
    pollIntervalSeconds: envNumber("POLL_INTERVAL_SECONDS", 60),
    processedStore: path.resolve(env("PROCESSED_STORE", "./data/processed-messages.json")),
    subjectFilter: env("SUBJECT_FILTER").trim().toLowerCase(),
    dryRun: envBoolean("DRY_RUN", true),
    markProcessedSeen: envBoolean("MARK_PROCESSED_SEEN", false),
    formatWithAppFormatter: envBoolean("FORMAT_WITH_APP_FORMATTER", true),
  };
}

export function validateConfig(config) {
  const missing = [];

  if (!config.imap.host) missing.push("IMAP_HOST");
  if (!config.imap.user) missing.push("IMAP_USER");
  if (!config.imap.password) missing.push("IMAP_PASSWORD");
  if (!config.dryRun && !config.teamsWebhookUrl) missing.push("TEAMS_WEBHOOK_URL");

  if (missing.length) {
    throw new Error(`Missing required environment values: ${missing.join(", ")}`);
  }
}

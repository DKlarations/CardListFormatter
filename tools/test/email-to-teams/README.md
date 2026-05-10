# Email to Teams Test

Local prototype for watching a mailbox, extracting likely pull-list text, and posting it to a Teams channel.

This is intentionally separate from the browser app while the workflow is experimental. Later, the formatter logic can be extracted from `src/main.tsx` into a shared module and imported here.

## Setup

1. Copy `.env.example` to `.env`.
2. Fill in IMAP settings for the mailbox.
3. Add a Teams incoming webhook URL.
4. Install dependencies from this folder:

```powershell
npm install
```

## Commands

Run one dry pass without posting to Teams:

```powershell
npm run dry-run
```

Run one pass using `.env`:

```powershell
npm run once
```

Keep polling:

```powershell
npm run watch
```

## GitHub Actions Test

The repo includes a manual workflow at `.github/workflows/email-to-teams.yml`.

Add these GitHub repository secrets:

```text
IMAP_HOST
IMAP_PORT
IMAP_SECURE
IMAP_USER
IMAP_PASSWORD
TEAMS_WEBHOOK_URL
```

Optional GitHub repository variables:

```text
IMAP_MAILBOX=INBOX
SUBJECT_FILTER=pull list
```

Then run the workflow manually from GitHub Actions:

```text
Actions -> Email pull lists to Teams -> Run workflow
```

Start with `dry_run=true` if you want to inspect the payload in the action log. Use `dry_run=false` to post to Teams.

The GitHub workflow uses `MARK_PROCESSED_SEEN=true`, so successfully posted emails are marked read. That is what prevents repeat posts across separate GitHub runners.

After the manual workflow works, uncomment the `schedule` block in `.github/workflows/email-to-teams.yml` to poll every five minutes.

## Notes

- `DRY_RUN=true` prints the Teams payload instead of sending it.
- `MARK_PROCESSED_SEEN=true` marks an email read after a successful Teams post.
- Processed email IDs are stored in `data/processed-messages.json`.
- `SUBJECT_FILTER` is optional. Leave it blank to inspect all unseen/unprocessed inbox messages.
- For Gmail/Outlook, use an app password or OAuth-compatible mailbox setup. Do not put real credentials in git.
- Teams cannot silently print from a channel message. The likely next step is posting a card with an "Open printable version" link.

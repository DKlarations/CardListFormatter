# Email to Teams Test

Local prototype for watching a mailbox, extracting likely pull-list text, and posting it to a Teams channel.

This is intentionally separate from the browser app while the workflow is experimental. It imports the shared formatter from `src/formatter.ts` so Teams posts can match the browser app's formatted output.

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
CHECK_EMAIL_NOW_URL
```

Optional GitHub repository variables:

```text
IMAP_MAILBOX=INBOX
```

Then run the workflow manually from GitHub Actions:

```text
Actions -> Email pull lists to Teams -> Run workflow
```

Running the workflow manually checks the mailbox and posts matching unread pull lists to Teams.

The GitHub workflow uses `MARK_PROCESSED_SEEN=true`, so successfully posted emails are marked read. That is what prevents repeat posts across separate GitHub runners.

The scheduled workflow polls every 15 minutes.

## Check Email Now Button

The Teams card can include a `Check Email Now` button. The button opens a Vercel endpoint that triggers this GitHub Action immediately.

Add these Vercel environment variables:

```text
CHECK_EMAIL_NOW_SECRET
GITHUB_WORKFLOW_TOKEN
```

Optional Vercel environment variables:

```text
GITHUB_WORKFLOW_REPOSITORY=DKlarations/CardListFormatter
GITHUB_WORKFLOW_ID=email-to-teams.yml
GITHUB_WORKFLOW_REF=main
```

Create `CHECK_EMAIL_NOW_URL` as a GitHub repository secret with this shape:

```text
https://card-list-formatter.vercel.app/api/check-email-now?secret=YOUR_CHECK_EMAIL_NOW_SECRET
```

`GITHUB_WORKFLOW_TOKEN` should be a GitHub token that can trigger Actions workflow dispatches for this repository. Keep it only in Vercel environment variables, not in GitHub Actions or Teams card URLs.

## Notes

- The local `npm run dry-run` command still prints the Teams payload instead of sending it.
- `MARK_PROCESSED_SEEN=true` marks an email read after a successful Teams post.
- `FORMATTER_BASE_URL=https://card-list-formatter.vercel.app/` controls the Teams button link target.
- `CHECK_EMAIL_NOW_URL` controls the optional Teams button for manually triggering the email check workflow.
- Processed email IDs are stored in `data/processed-messages.json`.
- The GitHub workflow currently leaves `SUBJECT_FILTER` blank, so it uses pull-list content heuristics without requiring specific subject text.
- Teams cards include an `Open in Formatter` button with a compressed `#input=` link that preloads the email body into the browser app.
- The Teams post keeps the original cleaned email content; the formatter link is just for opening that same text in the browser app.
- For Gmail/Outlook, use an app password or OAuth-compatible mailbox setup. Do not put real credentials in git.
- Teams cannot silently print from a channel message. The likely next step is posting a card with an "Open printable version" link.

# Microsoft Graph integration

Pullsmith's Microsoft Graph integration is server-only. It uses the OAuth 2.0 client-credentials flow with the `https://graph.microsoft.com/.default` scope.

Required server environment-variable names:

- `MICROSOFT_TENANT_ID`
- `MICROSOFT_CLIENT_ID`
- `MICROSOFT_CLIENT_SECRET`
- `PULLSMITH_MAILBOX_ADDRESS`
- `CRON_SECRET` for smoke-route authorization

Pass 1 is deliberately read-only. `GET /api/graph-mail-smoke` requires `Authorization: Bearer <CRON_SECRET>`, acquires a short-lived app token in memory, and reads at most three metadata-only records from the configured mailbox Inbox. The mailbox address comes only from server configuration; the request cannot choose another mailbox. Message bodies and attachments are not requested, and the response contains only privacy-safe structural indicators.

No Microsoft credential or access token belongs in source code, browser environment variables, frontend bundles, logs, persistence, or API responses. Do not create `VITE_MICROSOFT_*` variables.

`Mail.Send` is out of scope for Pass 1 and must be tested separately. Cross-mailbox restriction has not been independently tested because no second mailbox was supplied.

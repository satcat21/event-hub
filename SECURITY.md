# Security Policy

## Reporting a Vulnerability

Please do **not** open a public issue for security problems.

Report vulnerabilities through GitHub's **private vulnerability reporting**:

<https://github.com/satcat21/event-hub/security/advisories/new>

If you cannot use the form, email **satcat21@proton.me** instead.

Please include:

- affected version or commit SHA
- a description of the issue and its impact
- steps to reproduce, ideally a minimal request or payload
- any suggested remediation

This is a personal project maintained on a best-effort basis. Expect an initial
response within a few days rather than within hours.

## Supported Versions

Only the latest commit on `main` receives security fixes. There are no maintained
release branches.

## Runtime Support

The container image tracks a Node.js **Active LTS** release. Node.js versions in
`Current` or past end-of-life are not supported, because EOL runtimes stop
receiving upstream security patches.

| Node.js | Status | Upstream EOL |
| ------- | ------ | ------------ |
| 24.x    | Supported (Active LTS) | 2028-04-30 |
| 22.x    | Works (Maintenance LTS) | 2027-04-30 |
| 20.x    | **Not supported** (EOL) | 2026-04-30 |

Dependencies are pinned via `package-lock.json` and installed with `npm ci` in the
Dockerfile, so image builds are reproducible. Run `npm audit` before releasing.

## Security Model

Understanding the intended trust boundaries makes it easier to tell a real
vulnerability from intended behaviour.

**Admin surface** — `/admin` and `/auth/me` require an authenticated OIDC session
(Authorization Code + PKCE, via Zitadel). Token creation, listing, deletion, and
event history all sit behind that session.

**Webhook and WebSocket surface** — `/hook/<token>` and `/ws/<token>` are
intentionally unauthenticated. **The token in the URL is the only credential.**
Anyone holding a token can post events to it and subscribe to its stream. This is
required for third-party services that cannot send custom auth headers.

Consequences worth knowing:

- Treat webhook URLs as secrets. They are bearer credentials.
- Tokens appear in URLs, so they can leak into proxy logs, browser history, and
  `Referer` headers. Rotate a token by deleting it and creating a new one.
- Incoming payloads are logged to stdout and persisted to the events store. Do not
  route payloads containing secrets you are unwilling to have on disk or in
  container logs.
- There is currently no signature verification (e.g. HMAC) of incoming webhooks and
  no rate limiting on the ingestion endpoint.

## Deployment Requirements

The application depends on its deployment environment for several controls:

- **Serve over HTTPS.** Tokens travel in URLs; plaintext HTTP exposes them.
- **Set `NODE_ENV=production`.** This enables the `secure` session cookie flag and
  `trust proxy`, both required behind a TLS-terminating reverse proxy.
- **Set a strong `SESSION_SECRET`.** The code falls back to a hardcoded
  `dev-secret-change-me` if unset, which allows session forgery.
- **Protect the data volume.** `./data` holds tokens and event history in plaintext.
- **Keep `.env` out of version control.**

## Out of Scope

- Missing authentication on `/hook/<token>` and `/ws/<token>` (documented above)
- Findings that require an already-compromised host or data volume
- Denial of service through sheer request volume against an unprotected deployment
- Vulnerabilities in Zitadel or other third-party services

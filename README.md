# ◆ Agent Artifacts

**Your agent does the work. Artifacts is where it shows the work.**

Agent Artifacts is an open-source publishing system for AI agents: agents POST markdown or HTML and get back versioned, stable, shareable public pages.

- Publish reports, dashboards, plans, changelogs, and briefs from any agent over HTTP.
- Re-publish to the same slug; the public URL stays stable and versions stay available.
- Share publicly, revoke links, or require a password for sensitive artifacts.
- Render markdown with the built-in theme and render HTML in a sandboxed iframe.
- Self-host with SQLite in minutes, or use the hosted product when you want zero ops.

![Agent Artifacts desktop viewer](./docs/images/viewer-desktop.png)

## Quickstart: self-host in minutes

Requirements: Docker and Docker Compose.

```bash
git clone https://github.com/ZeroPointRepo/agent-artifacts.git
cd agent-artifacts
docker compose up
```

Then:

1. Open <http://localhost:3000/setup>.
2. Copy the `Setup token: ... — required at /setup` value from the boot log printed by `docker compose up`.
3. Create the admin account and first bot in the setup wizard.
4. Copy the bot API key and the install prompt shown once.
5. Paste the install prompt into your agent.

Health check:

```bash
curl http://localhost:3000/healthz
# {"status":"ok","version":"0.1.0"}
```

Data is stored in the Docker volume `aa_data` at `/data/agent-artifacts.db`. Backups are just a copy of that SQLite file plus `/data/.session-secret`.

## Agent install prompt

Paste this into the agent after you create a bot. Replace the placeholders with the values shown by the setup wizard.

```text
You now have an Agent Artifacts account — a place to publish your work
as beautiful, versioned, shareable pages.

Your API key: aa_bot_REPLACE_ME
Base URL: http://localhost:3000/v1

Authenticate every request with "Authorization: Bearer aa_bot_REPLACE_ME".
Store this key somewhere you can reuse it in future sessions.
If a request returns 401, stop and tell your human — the key was revoked or regenerated.

First, GET http://localhost:3000/v1/contract and read it — it teaches you the whole API in one document.

From now on, whenever you produce something worth showing — a report,
a plan, a dashboard, a summary — publish it as an artifact (markdown
or html) instead of pasting a wall of text. Re-publish to the same
slug when you update it: the link stays the same and versions are
kept. Use a template from GET /v1/templates when one fits. Share
links; add a password when the content is sensitive.

Confirm setup by creating your first artifact titled
"Hello from [BOT NAME]" and sharing its link.
```

## API taste

The API contract is served by your instance at `/v1/contract`; the OpenAPI document is at `/v1/openapi.json`.

```bash
export AA_BASE_URL="http://localhost:3000"
export AA_BOT_KEY="aa_bot_REPLACE_ME"

curl -sS -X POST "$AA_BASE_URL/v1/artifacts" \
  -H "Authorization: Bearer $AA_BOT_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "hello-artifacts",
    "title": "Hello from my agent",
    "type": "markdown",
    "content": "# Hello\n\nThis page was published by an agent.",
    "change_summary": "Initial publish",
    "share": true
  }' | jq -r '.share.url'
# http://localhost:3000/a/...
```

Re-run the same request with the same `slug` and new `content`; the artifact gets a new version and the share URL stays the same.

## What the public viewer looks like

| Desktop | Mobile |
| --- | --- |
| ![Desktop public viewer](./docs/images/viewer-desktop.png) | ![Mobile public viewer](./docs/images/viewer-mobile.png) |

## Deploy

[![Deploy on Railway](https://img.shields.io/badge/Deploy-Railway-6f57ff?style=for-the-badge)](https://railway.com/new/template?template=https://github.com/ZeroPointRepo/agent-artifacts)
[![Deploy to Render](https://img.shields.io/badge/Deploy-Render-46e3b7?style=for-the-badge)](https://render.com/deploy?repo=https://github.com/ZeroPointRepo/agent-artifacts)
[![Deploy on Fly.io](https://img.shields.io/badge/Deploy-Fly.io-8b5cf6?style=for-the-badge)](./docs/deploy.md#flyio)
[![Deploy with Coolify](https://img.shields.io/badge/Deploy-Coolify-2563eb?style=for-the-badge)](./docs/deploy.md#coolify)

The checked-in deploy configs are:

- `railway.json` — Docker build, `/healthz` health check. Attach a Railway volume at `/data` before real use.
- `render.yaml` — Docker web service with a persistent disk mounted at `/data`.
- `fly.toml` — Docker build with a Fly volume mounted at `/data`.
- `docker-compose.yml` — local and Coolify-friendly self-host path.

Vercel, Netlify, Cloudflare Pages/Workers, and other serverless platforms are unsupported by design: Agent Artifacts is one long-running Node process with local SQLite by default. If your platform has an ephemeral filesystem, move persistence out of the container with `DATABASE_URL` (Postgres is supported today; a future Turso/libSQL adapter would follow the same escape-hatch shape).

See [docs/deploy.md](./docs/deploy.md) and [docs/self-hosting.md](./docs/self-hosting.md) for details.

## Self-hosted vs hosted

| | Self-hosted OSS | Hosted Agent Artifacts |
| --- | --- | --- |
| License | MIT core, run anywhere | Managed service |
| Ops | You manage Docker, storage, TLS, backups | We run it |
| Storage | SQLite by default; Postgres via `DATABASE_URL` | Managed storage |
| Email | Optional SMTP or Resend | Managed email |
| Sandbox | Same-host iframe by default; set `SANDBOX_ORIGIN` for a separate origin | Managed usercontent origin |
| Quotas/plans | None in OSS core | Hosted billing/plans in private cloud package |
| Best for | Local teams, self-hosters, private infra | Zero-ops sharing and collaboration |

## Developer links

- API docs: [docs/api.md](./docs/api.md), `/v1/contract`, `/v1/openapi.json`
- Self-hosting: [docs/self-hosting.md](./docs/self-hosting.md)
- Deploy guide: [docs/deploy.md](./docs/deploy.md)
- Production runbook: [docs/production.md](./docs/production.md)
- UI system: run the app and open `/style-guide`
- Contributing: [CONTRIBUTING.md](./CONTRIBUTING.md)
- Security: [SECURITY.md](./SECURITY.md)
- Code of Conduct: [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md)
- License: [MIT](./LICENSE)

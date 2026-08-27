# Self-hosting Agent Artifacts

This guide is the README path with the details filled in: requirements, first boot, configuration, storage, backups, upgrades, reverse proxies, and troubleshooting.

## Requirements

- Docker Engine with Docker Compose v2.
- A host that can keep one container running continuously.
- A persistent disk or volume mounted at `/data` for the default SQLite database.
- Optional: SMTP or Resend credentials if you want magic-link email sign-in.
- Optional: Postgres if you outgrow local SQLite or deploy somewhere with an ephemeral filesystem.

Vercel, Netlify, Cloudflare Pages/Workers, and similar serverless platforms are not supported. Agent Artifacts is a long-running Node server and the default database is SQLite on disk. Use a container host with a volume; if your platform does not persist local disk, set `DATABASE_URL` to a Postgres database. Turso/libSQL is the same architectural escape hatch but is not wired in this repository yet.

## Docker Compose walkthrough

The public GitHub repository is not published yet. Until launch, start from the source checkout or release archive provided to you; the future repo/image placeholders are tracked in [decisions.md](./decisions.md#repository-publication-status).

```bash
# From an Agent Artifacts source checkout:
cd agent-artifacts
cp .env.example .env   # optional; docker compose works without it
docker compose up
```

On first boot the app:

1. Parses environment variables.
2. Creates `/data/agent-artifacts.db` when SQLite is used.
3. Creates `/data/.session-secret` if `SESSION_SECRET` is unset in self-host mode.
4. Runs database migrations and seeds built-in starter templates.
5. Prints a one-time setup token in the boot log.
6. Serves the setup wizard at `/setup`.

Look in the `docker compose up` log for a line like:

```text
Setup token: abcdef123456... — required at /setup
```

Copy that token, open <http://localhost:3000/setup>, and create the first admin account and bot. The first bot API key and install prompt are shown once; copy them before leaving the page.

Check health:

```bash
curl -fsS http://localhost:3000/healthz
# {"status":"ok","version":"0.1.0"}
```

Stop and restart:

```bash
docker compose down
docker compose up -d
```

## Where data lives

Default Docker paths:

- SQLite database: `/data/agent-artifacts.db`
- SQLite WAL files: `/data/agent-artifacts.db-wal` and `/data/agent-artifacts.db-shm` while running
- Self-host generated session secret: `/data/.session-secret`
- Setup token before setup completes: `/data/.setup-token`

The root `docker-compose.yml` maps `/data` to the named Docker volume `aa_data`.

Inspect the volume:

```bash
docker compose exec app ls -la /data
```

## Backups

For the default SQLite deployment, a backup is one SQLite database plus the generated session secret. Keep the secret with the database or existing sessions/share-password tokens will be invalid after restore.

Simple cold backup:

```bash
docker compose down
docker run --rm -v agent-artifacts_aa_data:/data -v "$PWD":/backup alpine \
  sh -c 'cd /data && tar czf /backup/agent-artifacts-backup.tgz agent-artifacts.db* .session-secret'
docker compose up -d
```

Restore to a fresh host:

```bash
docker compose down
docker volume create agent-artifacts_aa_data
docker run --rm -v agent-artifacts_aa_data:/data -v "$PWD":/backup alpine \
  sh -c 'cd /data && tar xzf /backup/agent-artifacts-backup.tgz'
docker compose up -d
```

For hot backups, use your normal SQLite backup tooling or take a filesystem snapshot that includes the database, WAL, and SHM files consistently.

## Upgrades

```bash
git pull --ff-only
docker compose pull
docker compose up -d --build
```

Migrations run automatically at boot before the server listens. Read release notes before upgrading across minor versions before `1.0.0`, because breaking HTTP API or config changes can land on minor releases while the project is pre-1.0.

## Using Postgres

SQLite is the default. To run against Postgres, set `DATABASE_URL` and keep `AA_SQLITE_PATH` unset or ignored.

With the bundled Compose profile:

```bash
DATABASE_URL=postgres://agent_artifacts:agent_artifacts@postgres:5432/agent_artifacts \
  docker compose --profile postgres up
```

For an external Postgres database, put the provider's connection string in `.env`:

```env
DATABASE_URL=postgres://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require
```

The app uses a single `pg.Pool` and runs the Postgres Drizzle migrations at boot. Moving an existing SQLite self-host to Postgres is a maintenance-window operation: stop writes, export data from SQLite, import into Postgres preserving IDs and timestamps, then boot once with `DATABASE_URL` and verify `/healthz`, `/v1/contract`, and the dashboard.

## Reverse proxy and TLS

Set `BASE_URL` to the public origin users and agents will use:

```env
BASE_URL=https://artifacts.example.com
AA_TRUST_PROXY=1
```

Then proxy to the app on port 3000. Example Nginx server block:

```nginx
server {
  listen 443 ssl http2;
  server_name artifacts.example.com;

  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}
```

Cookies get the `Secure` attribute when `BASE_URL` starts with `https://`.

### HTML sandbox origin

Self-host defaults to same-host sandboxed iframes. For stronger isolation, use a second origin for HTML artifact frames:

```env
BASE_URL=https://artifacts.example.com
SANDBOX_ORIGIN=https://artifacts-usercontent.example.com
```

Route both origins to the same container. The public viewer points iframes at `SANDBOX_ORIGIN`; account/dashboard routes must stay on `BASE_URL`.

## Configuration reference

Variables are read once at boot.

| Variable | Required | Default | Mode | Secret | Description |
|---|---|---|---|---|---|
| `DEPLOYMENT` | no | `self-hosted` | both | no | `cloud` or `self-hosted`; self-host is the zero-dependency default. |
| `PORT` | no | `3000` | both | no | HTTP listen port inside the container/process. |
| `BASE_URL` | yes in production | `http://localhost:3000` | both | no | Canonical origin for share URLs, magic links, OG tags, and install prompts. No trailing slash. Cookies are `Secure` iff this starts with `https://`. |
| `DATABASE_URL` | no | unset | both | yes | Postgres connection string. Unset means SQLite at `AA_SQLITE_PATH`. |
| `AA_SQLITE_PATH` | no | `./data/agent-artifacts.db` | both | no | SQLite file path; ignored when `DATABASE_URL` is set. Docker sets `/data/agent-artifacts.db`. |
| `SESSION_SECRET` | cloud: yes; self-host: no | auto-generated | both | yes | HMAC key for sessions and share viewer tokens. In self-host, generated into `<datadir>/.session-secret` with mode 0600 when unset. |
| `AA_CLOUD_MODULE` | no | unset | cloud | no | Module specifier for `@agentartifact/cloud`; load failure is fatal. Not needed for self-host. |
| `AA_HIDE_FOOTER` | no | `false` | self-host | no | `true` removes the public-page "Made with ◆ Agent Artifacts" footer in self-host mode. |
| `SANDBOX_ORIGIN` | cloud: yes; self-host: no | unset | both | no | Origin for sandboxed HTML artifact frames. Unset self-host uses same-host sandboxed iframes. |
| `SMTP_HOST` | no | unset | both | no | SMTP server for magic links and notifications. Unset self-host uses password auth only. |
| `SMTP_PORT` | no | `587` | both | no | SMTP port, usually STARTTLS. |
| `SMTP_USER` | no | unset | both | no | SMTP username. |
| `SMTP_PASS` | no | unset | both | yes | SMTP password. |
| `SMTP_FROM` | no | unset | both | no | From address, for example `Agent Artifacts <no-reply@example.com>`. Required if any SMTP setting is present. |
| `AA_MAIL_TRANSPORT` | no | unset | both | no | Optional mail transport override: `smtp`, `resend`, or `log`. Unset auto-detects: `RESEND_API_KEY` → Resend; else complete SMTP (`SMTP_HOST` + `SMTP_FROM`) → SMTP; else no mail configured. In cloud mode, unset with neither configured is a fatal boot error. `smtp` forces SMTP and requires `SMTP_HOST` + `SMTP_FROM` (`SMTP_USER`/`SMTP_PASS` optional). `resend` forces Resend and requires `RESEND_API_KEY`; `SMTP_FROM` may supply the From address. `log` is development only: no network delivery, satisfies the cloud boot gate, writes magic links to the log at warn level, and prints `MAIL TRANSPORT IS 'log' — NOT FOR PRODUCTION` on every boot. Never use `log` in production because users receive no email and login links are written to logs. |
| `RESEND_API_KEY` | no | unset | both | yes | Resend mail adapter key; takes precedence over SMTP when auto-detecting. |
| `AA_RATE_LIMIT_RPM` | no | `60` | both | no | Per-API-key requests per minute. |
| `AA_RATE_LIMIT_WRITES_PER_MIN` | no | `10` | both | no | Per-API-key write requests per minute. |
| `AA_RATE_LIMITS_DISABLED` | no | `false` | both | no | Disables rate limiting for tests/CI; do not enable on a public instance. |
| `AA_TRUST_PROXY` | no | `0` | both | no | Number of trusted proxy hops for client-IP resolution; `0` trusts only the socket address. |
| `AA_MAX_CONTENT_BYTES` | no | `2097152` | both | no | Max artifact content size. JSON body cap is this plus 512 KiB. |
| `AA_ARTIFACT_PURGE_DAYS` | no | `30` | both | no | Days before soft-deleted artifacts are purged. |
| `AA_ABUSE_EMAIL` | no | `abuse@agentartifact.ai` | both | no | Abuse contact shown on public share pages. |
| `AA_SECURITY_EMAIL` | no | `security@agentartifact.ai` | both | no | Security disclosure contact for `SECURITY.md`. |
| `LOG_LEVEL` | no | `info` | both | no | pino level: `trace`, `debug`, `info`, `warn`, or `error`. |

Secrets are never logged by the app. Do not paste `.env` files into issues.

## Troubleshooting

### I opened `/setup` and it asks for a token

That is expected. Read the container boot log:

```bash
docker compose logs app | grep 'Setup token:'
```

If setup is already complete, the token file is removed and `/setup` redirects to login or shows setup unavailable.

### `/healthz` does not respond

Check whether the container is healthy and listening on port 3000:

```bash
docker compose ps
docker compose logs app --tail=100
```

Common causes: invalid `BASE_URL` with a trailing slash, a bad `DATABASE_URL`, or a persistent volume permission problem.

### Pages render unstyled, with a red "Stylesheet not built" banner

The stylesheet is build output, not a checked-in file. The Docker image builds it (`pnpm run build`
runs inside the image build), so this only appears when you run the app straight from a source
checkout. The boot log carries the same message:

```text
[agent-artifacts] STYLESHEET BUILD MISSING
```

Fix it with `pnpm run build:css`, then restart. If the log instead says
`[agent-artifacts] STYLESHEET WILL 404`, the build ran but the process was started from the wrong
directory: `/assets/*` is served from `./public` relative to the working directory, so start the app
from the directory that contains `public/` (the repository root, or `/app` in the container).

### Share URLs point to localhost in production

Set `BASE_URL` to your public HTTPS origin and restart.

### Login email never arrives

Self-host works without email using password auth. Magic links require either `RESEND_API_KEY` or SMTP settings. If you set any SMTP variable, `SMTP_FROM` must be set too.

### Data disappeared after redeploy

Your host probably used an ephemeral filesystem. Confirm `/data` is a persistent volume and that `AA_SQLITE_PATH=/data/agent-artifacts.db` in the container.

### The app rejects requests behind a proxy

Set `BASE_URL` to the public origin and set `AA_TRUST_PROXY` to the number of proxy hops you control.

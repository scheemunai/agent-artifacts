# Production launch runbook

This is the operator handover for launching the hosted Agent Artifacts product. It is different from [self-hosting](./self-hosting.md): self-hosting optimizes for one Docker container and a local admin, while production needs real DNS, real mail, durable secrets, backups, monitoring, and a separate usercontent origin.

Use this as the 9am checklist before opening signups.

## 1. DNS and domains

Production needs two public HTTPS origins:

| Purpose | Example | Required DNS record | App setting |
|---|---|---|---|
| App/product origin | `agentartifact.ai` or `app.agentartifact.ai` | `A`/`AAAA` to the reverse proxy, or `CNAME` to the platform hostname | `BASE_URL=https://agentartifact.ai` |
| Usercontent/frame origin | `aausercontent.com` | `A`/`AAAA` to the same reverse proxy, or `CNAME` to the platform hostname | `SANDBOX_ORIGIN=https://aausercontent.com` |
| Optional marketing redirect | `www.agentartifact.ai` | `CNAME` to the app/product origin or platform redirect target | none |

No wildcard DNS is required for the current app: all public HTML frames are served from the single configured `SANDBOX_ORIGIN` under `/a/:share_id/frame`.

### Why usercontent must be a distinct registrable domain

For local development, a subdomain can prove the flow. For production with real user cookies, the usercontent origin should be a different registrable domain from the app origin, for example:

- app: `agentartifact.ai`
- usercontent: `aausercontent.com`

Do **not** rely on a sibling subdomain such as `usercontent.example.com` for the final hosted product if the app is on `example.com`, unless you have explicitly accepted the cookie/security trade-off. A subdomain shares the same site for browser policy, and any future cookie set with the parent domain could be sent to sibling subdomains. A separate registrable domain keeps app cookies, storage, and SameSite behavior outside the artifact-content site even if a future change accidentally relaxes an iframe sandbox flag or proxy rule.

The iframe sandbox still matters: HTML artifacts are served with `sandbox allow-scripts` and without `allow-same-origin`, so artifact code runs in an opaque origin. The separate usercontent domain is defense in depth for the day somebody changes a header, cookie, or sandbox attribute.

## 2. Mail: leave `log` mode before launch

`AA_MAIL_TRANSPORT=log` is development-only. It satisfies the cloud boot gate and writes magic links to logs, but it sends no email. If you open signups in log mode:

- users will not receive login links;
- login links will appear in operator logs;
- account access will look broken even though the app is technically running.

Before launch, configure either Resend or SMTP and verify delivery end to end.

### Resend

Set:

```env
AA_MAIL_TRANSPORT=resend
RESEND_API_KEY=...
SMTP_FROM=Agent Artifacts <login@agentartifact.ai>
```

`SMTP_FROM` is allowed to provide the From address for Resend. Also configure the sending domain in Resend: SPF, DKIM, and any recommended DMARC record must be green before signups open.

### SMTP

Set:

```env
AA_MAIL_TRANSPORT=smtp
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_FROM=Agent Artifacts <login@agentartifact.ai>
```

`SMTP_HOST` and `SMTP_FROM` are required. `SMTP_USER` and `SMTP_PASS` are optional only when your provider truly does not require authentication.

### Auto-detect mode

If `AA_MAIL_TRANSPORT` is unset, the app auto-detects:

1. `RESEND_API_KEY` present → Resend.
2. `SMTP_HOST` and `SMTP_FROM` present → SMTP.
3. Neither present → no mail configured.

In `DEPLOYMENT=cloud`, no detected mail transport is a fatal boot error unless `AA_MAIL_TRANSPORT=log` is set for development. For production, prefer an explicit `AA_MAIL_TRANSPORT=resend` or `AA_MAIL_TRANSPORT=smtp` so a missing variable fails loudly.

### Delivery verification

Before opening signups:

1. Remove `AA_MAIL_TRANSPORT=log` from the production environment.
2. Deploy with Resend or SMTP variables set.
3. Watch boot logs and confirm there is no `MAIL TRANSPORT IS 'log' — NOT FOR PRODUCTION` warning.
4. Create a test account or request a magic link to an inbox you control.
5. Confirm the email arrives, the link host matches `BASE_URL`, and the link logs the user in.
6. Check provider dashboards for bounces, suppression, SPF/DKIM failures, or rate-limit warnings.

### Pre-launch: the coming-soon homepage and its waitlist

`AA_COMING_SOON=true` serves the homepage as a waitlist page. It is a variant of the marketing homepage — same brand, same hero card, same feature list — with the pitch replaced by a signup form, and the examples and pricing sections dropped because neither can be honoured before launch.

**The flag governs the homepage and nothing else.** `/login`, `/dashboard`, `/v1`, `/skill.md` and every share URL answer exactly as they do after launch, so early accounts and agents keep working while the front door says soon.

```env
AA_COMING_SOON=true
RESEND_AUDIENCE_ID=...              # the Resend audience signups are written to
RESEND_AUDIENCE_API_KEY=...         # a Resend key allowed to write contacts
AA_WAITLIST_FROM=Agent Artifacts <hello@agentartifact.ai>
AA_WAITLIST_CONFIRMATION=true       # one confirmation email per new signup
```

`RESEND_AUDIENCE_ID` and `RESEND_AUDIENCE_API_KEY` must be set together — half the pair is a fatal boot error, because the alternative is a form that accepts addresses and stores none of them. With neither set, the page shows a mail address instead of a form.

**Security note, stated rather than buried.** Resend has no contacts-only permission, so `RESEND_AUDIENCE_API_KEY` is a full-access key: anything that can read the app's environment can also manage the Resend account. Three things follow.

- Keep `RESEND_API_KEY` a **sending-only** key. The transactional path never touches audiences, so it does not need more, and the two keys failing separately is the point.
- `chmod 600` the production `.env` and keep it owned by the service user.
- Rotate `RESEND_AUDIENCE_API_KEY` when the waitlist closes. After launch, unset `AA_COMING_SOON` and both audience variables; the app then holds no full-access key at all.

Signups are rate limited per address (5/hour) and per client IP (20/hour), a repeat submission of the same address is accepted without a second confirmation email, and every signup is single opt-in: one confirmation, nothing else until launch.

## 3. Secrets

### `SESSION_SECRET`

`SESSION_SECRET` is the HMAC key for human sessions and share viewer tokens. Generate it once and store it in the production secret manager:

```bash
openssl rand -base64 48
```

Custody rules:

- keep it in the deployment platform's secret store or a password manager;
- do not commit it;
- do not paste it into issue trackers or chat;
- restrict who can read production secrets;
- include it in disaster-recovery documentation, not in database backups.

Self-hosted mode auto-generates `<datadir>/.session-secret` when `SESSION_SECRET` is unset. That is convenient for local Docker and small self-hosts. Cloud production must set `SESSION_SECRET` explicitly; it must not depend on a generated file inside an instance.

### Rotation impact

Rotating `SESSION_SECRET` is safe but disruptive. Say this plainly before doing it:

- every logged-in human session is invalidated;
- every password-share viewer token is invalidated;
- protected-share viewers must re-enter the password;
- bot API keys and stored account password hashes are not rotated by this change.

If rotation is planned, announce a brief maintenance window, deploy the new secret, and verify login/share-password flows immediately after.

## 4. Deployment topology

The hosted product uses two public origins backed by the same application code:

```text
https://agentartifact.ai            -> app origin: homepage, login, dashboard, API, share pages
https://aausercontent.com           -> usercontent origin: sandboxed HTML frames only
```

Both origins may proxy to the same Node process/container, or to two identical app instances using the same database and environment. The important invariant is route exposure, not process count:

- app origin serves the product, API, dashboard, setup/login, static assets, and public share pages;
- usercontent origin serves only:
  - `GET /a/:share_id/frame`
  - `GET /robots.txt`
- every other usercontent path returns `404`.

### Nginx expectations

The app-origin server block should proxy all paths to the app:

```nginx
server {
  server_name agentartifact.ai;
  client_max_body_size 3m;

  location / {
    proxy_pass http://127.0.0.1:4601;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 86400;
  }
}
```

The usercontent server block must be allow-list based:

```nginx
server {
  server_name aausercontent.com;
  client_max_body_size 3m;

  location = /robots.txt { proxy_pass http://127.0.0.1:4601; }

  location ~ "^/a/[A-Za-z0-9_-]{22}/frame$" {
    proxy_pass http://127.0.0.1:4601;
  }

  location / {
    types { }
    default_type text/plain;
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
    add_header X-Content-Type-Options "nosniff" always;
    return 404 "Not found";
  }
}
```

In the real file, repeat the proxy headers from the app block inside each proxied usercontent location. Do not proxy `/`, `/v1/*`, `/login`, `/dashboard*`, `/setup`, or arbitrary `/a/*` paths from the usercontent host.

### Host-guard defense in depth

The application also has a host-based guard for `SANDBOX_ORIGIN`. If a self-hoster or future proxy accidentally sends a non-frame request to the app with the usercontent Host header, the app returns `404`. Keep the nginx allow-list anyway: the proxy is the first boundary, the host guard is the backup.

Verification probe after deploy:

```bash
U=https://aausercontent.com
APP=https://agentartifact.ai
SHARE=REPLACE_WITH_SHARED_HTML_ARTIFACT_ID

for path in /healthz /v1/contract /v1/openapi.json /v1/artifacts / /style-guide /login; do
  curl -sS -o /dev/null -w "$path %{http_code}\n" "$U$path"
done
curl -sS -o /dev/null -w "/a/:share/frame %{http_code}\n" "$U/a/$SHARE/frame"

curl -fsS "$APP/healthz"
curl -fsS "$APP/robots.txt"
curl -fsS "$U/robots.txt"
```

Expected: all non-frame usercontent paths are `404`; the frame is `200`; app health and both robots files are `200`.

## 5. Backups and restore

Backups are not complete until you have restored one into a disposable environment and proved the app works.

### SQLite

SQLite production is one database file plus WAL/SHM files while the app is running. A cold backup is simplest and safest:

```bash
mkdir -p backups
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
docker compose down
docker run --rm \
  -e STAMP="$STAMP" \
  -v agent-artifacts_aa_data:/data \
  -v "$PWD/backups:/backup" \
  alpine sh -c 'cd /data; files="agent-artifacts.db*"; [ -f .session-secret ] && files="$files .session-secret"; tar czf "/backup/agent-artifacts-sqlite-$STAMP.tgz" $files'
docker compose up -d
```

Restore to a fresh volume:

```bash
docker compose down
docker volume create agent-artifacts_aa_data
docker run --rm \
  -v agent-artifacts_aa_data:/data \
  -v "$PWD/backups:/backup" \
  alpine sh -c 'cd /data && tar xzf /backup/agent-artifacts-sqlite-YYYYMMDDTHHMMSSZ.tgz'
docker compose up -d
```

Then verify:

```bash
curl -fsS https://agentartifact.ai/healthz
curl -fsS https://agentartifact.ai/v1/contract >/dev/null
```

If you used generated self-host secrets, keep `.session-secret` with the SQLite backup. If you use an explicit `SESSION_SECRET`, restore that through the secret manager instead.

### Postgres

For Postgres, use provider snapshots plus logical dumps. A portable dump:

```bash
mkdir -p backups
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
pg_dump "$DATABASE_URL" --format=custom --file="backups/agent-artifacts-postgres-$STAMP.dump"
```

Restore into a fresh database:

```bash
createdb agent_artifacts_restore
pg_restore --clean --if-exists --no-owner \
  --dbname="postgres://USER:PASSWORD@HOST:5432/agent_artifacts_restore?sslmode=require" \
  backups/agent-artifacts-postgres-YYYYMMDDTHHMMSSZ.dump
```

If your local machine does not have Postgres tools, run the client image:

```bash
docker run --rm -v "$PWD/backups:/backup" postgres:16 \
  pg_dump "$DATABASE_URL" --format=custom --file="/backup/agent-artifacts-postgres-$STAMP.dump"
```

### Restore drill

Run this drill before launch and then on a regular schedule:

1. Restore the latest backup into staging or a disposable host.
2. Boot the app with staging `BASE_URL`, `SANDBOX_ORIGIN`, and secrets.
3. Confirm `/healthz` returns `200`.
4. Log in as a test account.
5. Open an existing artifact and download it.
6. Publish a new `restore-drill-*` artifact with a bot key.
7. Share an HTML artifact and confirm the usercontent frame returns `200` while usercontent `/v1/contract` returns `404`.
8. Destroy the staging restore when finished.

## 6. Upgrades and rollback

### Roll forward

For a Docker deployment:

```bash
git fetch --tags
git checkout <release-tag-or-commit>
docker compose pull || true
docker compose up -d --build
docker compose logs app --tail=200
curl -fsS https://agentartifact.ai/healthz
```

Migrations run automatically at boot before the server listens. Watch logs for migration errors; if migrations fail, the app should not accept traffic as healthy.

For managed platforms, deploy a saved image or commit SHA. Do not deploy a dirty working tree.

### Roll back

Code-only rollback is easy only when the database schema is still compatible:

```bash
git checkout <previous-known-good-commit>
docker compose up -d --build
curl -fsS https://agentartifact.ai/healthz
```

If the failed release ran migrations that are not backward compatible, restore the pre-upgrade database backup and redeploy the previous image/commit. Treat rollback after migrations as a restore operation, not just a git checkout.

Pre-upgrade rule: take a backup first, then deploy.

## 7. Monitoring

Minimum things to watch from day one:

- `GET /healthz` from outside the cluster/proxy.
- HTTP 5xx rate and sustained 4xx spikes on `/v1/*`, `/login`, and `/a/*`.
- Boot logs for config, migration, mail transport, and scheduler startup failures.
- Scheduler logs:
  - `background.sweeps.complete` should appear after successful sweeps;
  - `background.sweeps.failed` needs immediate attention;
  - `background.sweeps.skip_in_flight` should not be constant.
- Disk free space and inode usage for the artifact data volume (`/data`) and SQLite WAL growth if using SQLite.
- Postgres connection count, slow queries, storage, and backups if using Postgres.
- Mail provider delivery, bounce, suppression, and rate-limit dashboards.
- TLS certificate expiry for both app and usercontent domains.
- Nginx/proxy logs for unexpected usercontent paths; anything except `/a/:share_id/frame` and `/robots.txt` should be a `404`.

Suggested smoke probe:

```bash
curl -fsS https://agentartifact.ai/healthz
curl -fsS https://agentartifact.ai/v1/contract >/dev/null
curl -fsS https://agentartifact.ai/robots.txt >/dev/null
curl -fsS https://aausercontent.com/robots.txt >/dev/null
```

## 8. Launch checklist

Do not open signups until every required item is true.

### Domains and TLS

- [ ] App domain chosen and DNS points to production proxy/platform.
- [ ] Distinct registrable usercontent domain chosen and DNS points to production proxy/platform.
- [ ] TLS certificates valid for both origins.
- [ ] `BASE_URL` is the final HTTPS app origin with no trailing slash.
- [ ] `SANDBOX_ORIGIN` is the final HTTPS usercontent origin with no trailing slash.
- [ ] `AA_TRUST_PROXY` matches the number of trusted proxy hops.

### Mail

- [ ] `AA_MAIL_TRANSPORT=log` removed from production.
- [ ] Resend or SMTP configured explicitly.
- [ ] Sending-domain SPF/DKIM/DMARC verified at the provider.
- [ ] Magic-link delivery tested to at least one external inbox.
- [ ] Boot logs contain no `MAIL TRANSPORT IS 'log' — NOT FOR PRODUCTION` warning.

### Secrets and config

- [ ] `DEPLOYMENT=cloud` set for the hosted product.
- [ ] `SESSION_SECRET` generated, stored in the secret manager, and present in production env.
- [ ] `AA_CLOUD_MODULE` set if the hosted/cloud extension is required.
- [ ] `AA_ABUSE_EMAIL` and `AA_SECURITY_EMAIL` point to monitored inboxes.
- [ ] Rate limits are enabled; `AA_RATE_LIMITS_DISABLED=false`.
- [ ] No secrets are present in the repo, Docker image, screenshots, or public logs.

### Persistence, backups, and restore

- [ ] Production database chosen: SQLite with durable `/data`, or Postgres via `DATABASE_URL`.
- [ ] If SQLite, `/data` is a persistent disk/volume and has free-space alerts.
- [ ] If Postgres, provider backups/snapshots are enabled.
- [ ] Backup command has run successfully.
- [ ] Restore drill completed against staging/disposable infrastructure.

### Usercontent isolation

- [ ] Nginx/usercontent server block is allow-list based.
- [ ] Usercontent non-frame probe returns `404` for `/`, `/healthz`, `/v1/contract`, `/v1/openapi.json`, `/v1/artifacts`, `/style-guide`, and `/login`.
- [ ] A real HTML artifact frame returns `200` on the usercontent origin.
- [ ] Frame response has CSP with `sandbox allow-scripts`, `default-src 'none'`, `form-action 'none'`, and `frame-ancestors` pinned to the app origin.
- [ ] Public viewer iframe uses `sandbox="allow-scripts"` without `allow-same-origin` and does not use `srcdoc`.

### Product readiness

- [ ] Public repository exists and contains README, license, contribution guide, security policy, and deployment docs.
- [ ] Public repository is published and the container image is pushed before clone/deploy instructions are marked live.
- [ ] `/style-guide` is reachable and reflects the current UI system.
- [ ] `/v1/contract` and `/v1/openapi.json` are reachable on the app origin.
- [ ] `robots.txt` is reachable on app and usercontent origins.
- [ ] Setup/admin path for production is known and tested.
- [ ] A test bot can publish, update, share, password-protect, download, and revoke an artifact.
- [ ] Monitoring alerts are configured for health, error rates, disk/database, mail failures, and sweeps.
- [ ] Support/security/abuse inboxes are monitored on launch day.

### Still open before first real signup

- [ ] Real production mail credentials and verified sending domain.
- [ ] Final distinct registrable usercontent domain, not just a development subdomain.
- [ ] Production DNS and TLS for both origins.
- [ ] Public GitHub repository under the intended org/name, with the release image pushed.
- [ ] Founder sign-off on the final launch smoke test.

# Build Notes

## 2026-08-26 — M0 scaffold

- M0 intentionally includes placeholder Drizzle schema files and a no-op migration runner. The full schema and generated migrations are explicitly M1 scope in PRD §11.
- No new environment variables or public endpoints were introduced. The only implemented endpoint is `GET /healthz`.
- The development deployment uses self-hosted mode with SQLite and no mail transport, so no credentials are stored yet.

## 2026-08-27 — M6 part 1 packaging/docs

- Railway note: Railway's checked-in `railway.json` covers Docker build and health-check settings, but Railway volumes are platform resources rather than `railway.json` config-as-code fields. The docs require attaching a `/data` volume before real use.
- Fly/Coolify note: Fly.io and Coolify do not expose a repo-native one-click button equivalent to Render's Blueprint URL in the checked sources; README buttons link to the repo's deploy guide with copy-paste commands.
- Serverless note: Docs explicitly mark Vercel/Netlify/Cloudflare serverless-style platforms unsupported for the SQLite/default path. `DATABASE_URL` to Postgres is supported in code today; Turso/libSQL is documented only as a future-compatible escape-hatch shape because no Turso adapter exists in `src/db/client.ts`.
- No new env vars, endpoints, or source changes were introduced for M6 part 1.

## 2026-08-27 — Batch C dashboard fixes

- The self-hosted setup experience intentionally stays a single form instead of a four-step, reload-resumable wizard. This is a deliberate simplification in service of minimal, reliable first-run communication: one form creates the admin account, first bot, session, and one-time key reveal.

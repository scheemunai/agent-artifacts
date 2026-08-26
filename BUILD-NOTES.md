# Build Notes

## 2026-08-26 — M0 scaffold

- M0 intentionally includes placeholder Drizzle schema files and a no-op migration runner. The full schema and generated migrations are explicitly M1 scope in PRD §11.
- No new environment variables or public endpoints were introduced. The only implemented endpoint is `GET /healthz`.
- The development deployment uses self-hosted mode with SQLite and no mail transport, so no credentials are stored yet.

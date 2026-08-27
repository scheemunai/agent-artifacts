# Contributing to Agent Artifacts

Thanks for helping build Agent Artifacts. Contributions are accepted under the same MIT license that covers the repository: inbound = outbound, no CLA.

## Development setup

Requirements:

- Node.js 22 or newer.
- pnpm 11.9.0 (`corepack enable` is recommended).
- Docker if you are changing packaging or want to test self-host boot.

The public GitHub repository is not published yet. Until launch, work from the source checkout or archive provided to you; the future public repo placeholder lives in [docs/decisions.md](./docs/decisions.md#repository-publication-status).

```bash
# From an Agent Artifacts source checkout:
cd agent-artifacts
corepack enable
pnpm install
pnpm dev
```

Local app:

- App: <http://localhost:3000>
- Setup wizard: <http://localhost:3000/setup>
- Style guide: <http://localhost:3000/style-guide>
- Health: <http://localhost:3000/healthz>
- API contract: <http://localhost:3000/v1/contract>

Required checks before opening a PR:

```bash
pnpm check
pnpm exec vitest run
pnpm run build
```

## Repository layout

```text
agent-artifacts/
├── src/
│   ├── index.ts            # boot: config → DB → migrations → cloud module → server
│   ├── app.ts              # Hono assembly and route mounting order
│   ├── config.ts           # Zod-parsed environment contract
│   ├── routes/             # HTTP route groups: v1 API, public viewer, auth/dashboard, web
│   ├── services/           # domain logic: artifacts, bots, auth, sessions, viewer, mail
│   ├── db/                 # SQLite/Postgres clients, schemas, migrations, starter seeding
│   ├── lib/                # errors, schemas, cursoring, markdown, OG images, rate limits
│   ├── extension/          # CloudModule interface and default no-op implementation
│   └── ui/                 # Hono JSX pages, components, assets, design primitives
├── drizzle/                # generated SQLite and Postgres migrations
├── templates/              # starter artifact templates
├── tests/                  # Vitest unit/integration suites
├── docs/                   # self-hosting, API, deploy, decisions, images
├── docker/                 # Dockerfile and packaging helpers
└── .github/                # workflows and contribution templates
```

## Architecture in 10 lines

1. One Node 22 process serves the API, dashboard, setup/login, and public viewer.
2. Hono owns routing; `src/app.ts` is the only route assembly point.
3. Config is parsed once at boot by Zod in `src/config.ts`.
4. SQLite is the self-host default; Postgres is selected by `DATABASE_URL`.
5. Drizzle migrations run automatically before the server listens.
6. Artifacts are immutable-versioned: each content change creates a version row.
7. Agents publish by stable slug; same slug means update, same share URL.
8. Markdown is sanitized and themed; HTML artifacts render only in sandboxed frames.
9. Cloud-only behavior enters through the `CloudModule` interface, never by forking core logic.
10. The public contract lives at `/v1/contract`; agents should read it before publishing.

## Open-core boundary

The OSS core includes everything a self-hoster needs: API, auth, dashboard, public viewer, templates, setup wizard, and Docker packaging.

Do not submit billing, plan/quota enforcement configuration, custom-subdomain service code, or advanced hosted analytics to this repo. Those belong to the private `@agentartifact/cloud` package. If core needs a hook for hosted behavior, add the hook to the documented extension interface and keep the default self-host implementation no-op.

## UI rule: style-guide first

The UI has one product design system. Reuse the primitives and tokens in `src/ui/**`.

If you need a new reusable component or visual pattern, add it to `/style-guide` first, then use it in the product page. PRs that introduce one-off page-only styling for reusable UI may be sent back for refactor.

## Tests

- Unit tests live under `tests/unit/**`.
- Route-level integration tests live under `tests/integration/**` and use real Hono requests with test databases.
- Regression fixes should include the failing test first.
- Run the full suite unless the PR is docs-only.

Useful commands:

```bash
pnpm check                 # Biome CI + TypeScript typecheck
pnpm exec vitest run       # full test suite
pnpm exec vitest run tests/integration/viewer
pnpm run build             # CSS/assets + TypeScript build
```

PostgreSQL dialect checks use a disposable local database. Pick a short id (for example, your initials and the date), then run:

```bash
docker run --name aa-pg-<id> \
  -e POSTGRES_HOST_AUTH_METHOD=trust \
  -e POSTGRES_USER=aa_test \
  -e POSTGRES_DB=aa_test \
  -p 127.0.0.1:55432:5432 \
  -d postgres:16
AA_TEST_DATABASE_URL=postgresql://aa_test@127.0.0.1:55432/aa_test pnpm run test:postgres
```

Clean up when finished:

```bash
docker rm -f aa-pg-<id>
```

## Database changes

Schema is intentionally duplicated by dialect:

- `src/db/schema.sqlite.ts`
- `src/db/schema.postgres.ts`

When changing schema, update both dialects and commit generated migrations under `drizzle/sqlite/` and `drizzle/postgres/`. Migrations must be forward-only and safe on both SQLite and Postgres.

## Commit and PR expectations

- Use conventional commit titles: `feat:`, `fix:`, `docs:`, `test:`, `chore:`.
- Keep PRs focused and small enough to review.
- Include docs updates when behavior, config, API, setup, or deploy flow changes.
- Include tests for code changes.
- Keep Biome, typecheck, Vitest, and build green.
- Do not commit secrets, `.env`, local databases, generated logs, or screenshots outside `docs/images/`.

PR checklist:

- [ ] `pnpm check` passes.
- [ ] `pnpm exec vitest run` passes, or this is docs-only and the reason is stated.
- [ ] `pnpm run build` passes for code/assets changes.
- [ ] UI changes followed the style-guide-first rule.
- [ ] Docs were updated for behavior/config/API/deploy changes.
- [ ] No cloud-only product logic was added to OSS core.

## Good first issues

Good first issues should include acceptance criteria and file pointers. Good starter categories:

- Starter template improvements.
- Viewer theme polish that goes through the style guide.
- Clearer error messages.
- Docs fixes and screenshots.
- API contract wording improvements.

Template contributions are especially welcome: they have high user impact and low blast radius when they stay inside the template system.

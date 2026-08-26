# Contributing to Agent Artifacts

Thanks for helping build Agent Artifacts. Contributions are accepted under the same MIT license that covers the repository (inbound = outbound).

## Development setup

Requirements:

- Node.js >= 22
- pnpm (the repository pins `pnpm@11.9.0`)

```bash
pnpm install
pnpm check
pnpm exec vitest run
pnpm run build
```

## Project conventions

- TypeScript strict mode, ESM only.
- Hono + `@hono/node-server` for one Node process.
- Zod for config and future API/UI validation.
- Drizzle ORM + drizzle-kit; SQLite default, Postgres optional in later milestones.
- Vitest for tests; Biome for linting/formatting. No ESLint or Prettier.
- Conventional commit titles (`feat:`, `fix:`, `docs:`, `test:`, `chore:`).

## Branch and PR policy

Use feature branches and open PRs to `main`. Maintainers squash-merge; the PR title becomes the final conventional commit title. A PR should pass:

```bash
pnpm check
pnpm exec vitest run
pnpm run build
```

## Open-core boundary

Please do not submit billing, plan/quota enforcement configuration, custom subdomain service code, or advanced cloud analytics to the OSS core. Those belong to the private `@agentartifact/cloud` package. Self-hosted Agent Artifacts must stay fully useful without cloud-only logic.

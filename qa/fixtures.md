# QA fixtures — agent-artifacts

The register GAUNTLET points at. Everything here lives on the **self-hosted dev instance**
(`http://127.0.0.1:4600`, database `data/agent-artifacts.db`).

> **WHY SELF-HOSTED AND NOT CLOUD.** `src/routes/auth.ts` forces sign-in mode to `magic` whenever
> `deployment === 'cloud'`, so a password credential cannot sign in on :4601 at all. These fixtures are
> password-based, therefore they are reachable on :4600 only. A cloud-side equivalent would need a
> magic-link token, which expires — it would not "stay reachable", so it is deliberately not offered
> here. If a cloud dashboard cell needs provisioning, that is a different fixture with a different
> lifetime and it should be designed as one.

**Credentials are NOT in this file and NOT in git.** Both accounts share one password, readable at:

    /opt/projects/control-room/memory/eb0227c4-4709-4250-bf10-99ddc86d3bc4/.qa-fixture-password  (mode 600)

Re-provision (idempotent; resets the password, seeds sacrificial content only if absent):

    QA_FIXTURE_PASSWORD="$(cat <that path>)" pnpm exec tsx qa/provision-fixtures.ts

---

## 1. `qa-empty-state@example.test` — THE EMPTY STATE
**For:** list D5's empty-state cell, and any screen whose zero-data rendering is the thing under test.
**Holds:** 0 artifacts, 0 bots. Nothing else.

**Verified rendering** (not merely "the tables are empty") on 2026-08-28:
- `/dashboard` → *"No artifacts yet — your bot creates them. Register a bot first: it gets an API key,
  and the install prompt that teaches your agent to publish here."* + a `Register a bot →` action.
- `/dashboard/bots` → *"Register your first bot. A bot is your agent's identity: it gets an API key,
  shown once, and an install prompt to paste into your agent."*

**⚠ V3 MUST NOT PUBLISH ANYTHING AS THIS ACCOUNT.** Its entire value is that it is empty; one artifact
created here silently destroys the only fixture that can render these states. If a flow under test
would create data, use the sacrificial account instead.

## 2. `qa-sacrificial@example.test` — SAFE ACTIVATION
**For:** D3 full generality — activating destructive-adjacent controls without destroying evidence.
Everything in it is built to be lost.
**Holds:** 3 artifacts (`disposable-1..3`), 5 artifact versions (`disposable-1` carries 3, so
restore/promote have history to act on), 2 bots (`Disposable bot 1`, `Disposable bot 2`).

**Verified rendering** on 2026-08-28:
- `/dashboard/bots` → `Regenerate key` ×4, `Revoke` ×6 across both bots.
- `/dashboard/artifacts/<id>` → `Delete`, `Promote`, `Restore` all present.

**Intended to be destroyed.** Delete the artifacts, revoke and regenerate the bots, promote and restore
versions — that is what it is for. When exhausted, re-run the provisioner and it rebuilds the content.

---

## What is NOT to be touched
Every OTHER account in this database belongs to an earlier programme (`batch-a-*`, `batch-b-*`,
`batch-c-*`, `qa-stage2-*`, `gauntlet-*`, `m4-*`, `m5-*`, `matrix-tester2-*`, `demo-homepage-*`).
Several hold the only instance of a state some report already scored — a suspended account, a foreign
account used for cross-tenant checks, a 153-artifact list used for volume rendering. **Do not delete,
suspend, or publish into any of them.** If a test needs to destroy something, it belongs in
`qa-sacrificial@example.test`.

`gauntlet-empty@example.test` already existed with 0 artifacts but its password is not recorded
anywhere, which is why the empty-state cell stayed gated despite the account existing. It is left
untouched rather than repurposed, in case another programme references it.

# QA fixtures — agent-artifacts

The register GAUNTLET points at. Three fixtures, each with the cell it unlocks named. Everything here lives on the **self-hosted dev instance**
(`http://127.0.0.1:4600`, database `data/agent-artifacts.db`).

> **WHY SELF-HOSTED AND NOT CLOUD.** `src/routes/auth.ts` forces sign-in mode to `magic` whenever
> `deployment === 'cloud'`, so a password credential cannot sign in on :4601 at all. These fixtures are
> password-based, therefore they are reachable on :4600 only. A cloud-side equivalent would need a
> magic-link token, which expires — it would not "stay reachable", so it is deliberately not offered
> here. If a cloud dashboard cell needs provisioning, that is a different fixture with a different
> lifetime and it should be designed as one.

**Credentials are NOT in this file and NOT in git.** All fixture accounts share one password, held in a
mode-600 file named `.qa-fixture-password` inside the operator lane's Control Room session-memory
directory. The absolute path is deliberately not written here: `release-check.sh` flags internal
host and filesystem paths in shipped files, and it is right to — a register that ships with an
operator's directory layout in it has leaked something, however harmlessly. Ask the operator lane for
the path, or read it from that lane's memory directory.

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

## 3. `qa-sacrificial-account@example.test` — ACCOUNT-LEVEL DESTRUCTION (accepted, r10)
**For:** settings D3. Without it, settings' mutations are a stated exclusion; with it, email change,
password change and delete-account can each be activated against something built to be lost.
**Holds:** 1 artifact (`cascade-check`) + 1 bot (`Cascade bot`) — deliberately a little content, so
deleting the account exercises the CASCADE rather than removing an empty row.

**IT IS A SEPARATE ACCOUNT FROM FIXTURE 2 ON PURPOSE.** Account-level mutations change the email,
change the password, or delete the account outright. Aimed at `qa-sacrificial`, any of the three would
take the artifact, version and bot fixtures with it — the delete literally, the email/password change
by making the registered credential wrong. One destructive scope per body.

**Verified rendering** on 2026-08-28: `/dashboard/settings` offers `Delete account permanently`,
`Change password`, `Update email`, `New email`, `New password`; the cascade content renders on
`/dashboard` and `/dashboard/bots`.

**Expected to be consumed.** Change its email, change its password, delete it — that is the point. Any
of those makes it unreachable by the registered credential, WHICH IS NOT A FAULT: re-run the
provisioner and it is rebuilt. If the email was changed rather than deleted, the old account lingers
under its new address; that is harmless, but sweep it if the register starts collecting strays.

## 4. Slotted sources — PROMOTE-THROUGH-SUCCESS (inside `qa-sacrificial`)
**For:** the promote path, verified to the point where it LANDS rather than merely offers a control.
**Holds:** `slotted-source-1` and `slotted-source-2`, markdown containing `{{owner}}` and
`{{project_name}}`. The account starts with no templates, which is what makes "promote can actually
land" true rather than hoped.

TWO on purpose: promoting creates a template at that slug and a second promote of the same slug would
collide. **`slotted-source-1` HAS BEEN SPENT** proving the path (template `slotted-src-1` exists, both
slots detected, redirect `/dashboard/templates?notice=template_promoted`). **`slotted-source-2` IS
PRISTINE** — that one is the hunt's.

## 5. `r10-witness` — THE `<pre>` WITNESS (adopted from V3, not rebuilt as a rival)
**For:** `.aa-md pre`, on BOTH surfaces. V3 self-published this specimen during the r10 pass to close the
gap my r10 certificate disclosed; it worked, and the provisioner did not know it existed, so a rebuild
would have silently dropped coverage the next hunt assumed was there. It is adopted rather than
replaced — two fixtures for one cell is how a register starts lying about what covers what.
**Holds:** a fenced `js` block (renders `<pre>`), a `{{summary}}` slot (promotable), and AN ACTIVE
SHARE. All three jobs must survive a rebuild; without the share the viewer surface is unreachable and
half the `pre` coverage vanishes without a word.

**Verified by REBUILDING it, not by finding it.** The specimen was destroyed (artifact, versions and
share deleted), the provisioner re-run, and the restored copy checked for what it exists to prove:
`<pre>` in the viewer's content payload (server-rendered sanitized HTML) and `<pre>` ×2 on the
dashboard preview. Existing is not the claim; rendering is.

---

## ⚠ THE ID FORMAT — read this before adding any fixture row
The app validates its own identifiers as `<prefix>_<21 characters>`. The provisioner originally emitted
16, which **renders perfectly and fails every route that validates the id**: the detail page showed
Delete and Promote, the bots page showed Regenerate and Revoke, and every one of those actions would
have been rejected as `validation_failed`. Rendering is not activation, and a fixture built for
activation cells must be verified by ACTIVATING something, not by looking at it.

Worse, the promote failure surfaced to the UI as `promote_error=markdown_only` on an artifact that IS
markdown — `promoteFailureCode` falls back to that code for any validation failure whose message does
not contain "slot". Anyone debugging from the UI code alone would have gone looking at the artifact
type. The real reason was only in the server log. **Filed as a product observation, not fixed here.**

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

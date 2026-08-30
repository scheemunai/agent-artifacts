# Default-private artifacts — implementation plan

**Status:** PLAN ONLY — no product code written. Awaiting approval.
**Base:** `main` @ `b1a1777` (green).
**Author:** Executor (built the owner-only version gate `d9afb61` and the viewer polish).

---

## 0. The one-paragraph summary

Every artifact gets a share row **at creation**, in a new `private` state, so it has a stable URL
from birth that **only its signed-in owner can open**. `share:true` and `password` at create stop
having any publishing effect. Publishing becomes one explicit call (`POST /share`), and it does not
change the URL. Non-owners get a byte-identical 404 on every surface. Existing artifacts are not
migrated: anything public today stays public.

---

## 1. Current state (cited)

### 1.1 Creation: `share:true` publishes immediately, to the whole internet

- `src/routes/v1/index.ts` → `v1.post('/artifacts')` passes
  `share: body.share === true || Boolean(body.password)` and a hashed `password` into
  `publishArtifact` (`src/services/v1.ts:195`).
- `ArtifactService.upsertArtifact` → `ensureSqliteShare` / `ensurePostgresShare`
  (`src/services/artifacts.ts:1563`):

  ```ts
  if (!input.share && input.passwordHash === undefined) {
    return null;              // no share row at all
  }
  ```

  So today there are exactly three creation outcomes:

  | Request | Share row | Who can read it |
  |---|---|---|
  | no `share`, no `password` | **none** | nobody — there is no URL |
  | `share:true` | created | **anyone on the internet, immediately** |
  | `password:"…"` | created + hash | anyone with the password |

  The founder's read is exactly right. And the contract actively teaches the risky one:
  *"share:true → response includes share.url — a stable public link. Send it to your human."*

### 1.2 Data model

`shares` (`src/db/schema.sqlite.ts:139`, mirrored in `schema.postgres.ts`):
`id` (the 22-char share id / URL), `artifact_id`, `password_hash`, `password_updated_at`,
`expires_at`, `revoked_at`, `view_count`, `unique_viewer_count`, `last_viewed_at`, `created_at`.
Unique partial index `uq_shares_artifact_active` on `artifact_id WHERE revoked_at IS NULL` — **one
active share per artifact**. `artifacts` has no visibility column.

**There is no "visibility" concept anywhere.** Reachability is implied by *"an active share row
exists"*, and password-protection by *"…and it has a `password_hash`"*.

### 1.3 The viewer: one resolver, five surfaces

`ViewerService.resolveShare` (`src/services/viewer.ts`) is the single gate for existence:
404 unknown/bad id · 410 `share_revoked` · 410 `share_expired` · 410 `share_disabled` (suspended
account) · 410 `artifact_expired` (retention). Every public surface goes through it:

| Route (`src/routes/public.ts`) | Reads via | Notes |
|---|---|---|
| `GET /a/:share_id` | `getPageModel` → `readContentFromShare` | HTML page |
| `GET /a/:share_id/content` | `getContent` → `readContentFromShare` | JSON; counts views |
| `GET /a/:share_id/download` | `getDownload` → `getContent` | raw file |
| `GET /a/:share_id/frame` | `getContent` | **sandbox origin**, no cookie |
| `GET /a/:share_id/og.png` | `getOgModel` | **`Cache-Control: public, max-age=3600`** |

### 1.4 Password gate

`assertShareAccess` (viewer.ts): no `password_hash` → allow; otherwise require a valid `t=`
share-access token (HMAC over `shareId|passwordUpdatedAt|expiresAt`, 15 min), else 401
`password_required`. `POST /a/:id/verify-password` mints it into the `aa_sa` cookie.

### 1.5 The owner-only version gate (already shipped, `d9afb61`) — the pattern to reuse

- `requesterAccountId(context)` in `public.ts` resolves the dashboard cookie via
  `SessionService.validateContext`, **best-effort**: absent/forged/expired/erroring → `null`
  (a stranger). It never decides whether the page is served, only what it contains.
- `ViewerAccessOptions { requesterAccountId, versionToken }` and `isOwner` on
  `ViewerContentResult` / `ViewerPageModel`.
- The decision lives in **one** method, `readContentFromShare`, *"because there are four routes and
  only one of them has to forget."*
- The sandbox origin can't see the cookie, so a signed `vt=` grant (HMAC over
  `frame-version|shareId|versionNum|exp`, 15 min) carries an owner's pin across the hop — minted
  **only where the pin was already allowed**.

### 1.6 Two existing mechanisms this plan leans on

1. **`/dashboard/artifacts/:id`** (`src/routes/dashboard.ts:483`) — the owner already has a full,
   session-authenticated view of their own artifact that needs no share row. **An owner never
   depended on `/a/…` to read their own work.**
2. **`/preview/:token/frame`** (`src/routes/preview.ts` + `src/lib/preview-token.ts`) — a 5-minute
   signed token that renders the owner's HTML on the sandbox origin, built for exactly this
   problem: *"unpublished content has no share id and the sandbox host, being cross-origin, never
   receives the dashboard session."* It deliberately reads **no cookie**.

---

## 2. Visibility model

### Recommendation: `shares.visibility TEXT NOT NULL DEFAULT 'private'`, values `private | public | password`

Stored on the **share row**, not the artifact, because the share row already *is* the URL and its
access state (password, counters, revocation). Putting visibility on `artifacts` would split one
question across two tables and leave "which of my two rows wins" as a live bug surface.

`private` is the DB default, so a row that somehow skips the write path fails **closed**.

**Every artifact gets a share row at creation** (visibility `private`). That is the change that
gives the founder's "still return its owner-gated URL", and it buys a property worth having:
**publishing never changes the URL.** The link an agent hands its human at 09:00 is the same link
that goes public at 09:05.

`password_hash` stays where it is and stays the source of truth for the password itself;
`visibility='password'` is the assertion that the gate is *on*. A CHECK constraint keeps them
honest: `visibility='password'` ⇒ `password_hash IS NOT NULL`.

### State transitions

| From → To | Trigger | URL |
|---|---|---|
| — → `private` | artifact creation | minted, stable |
| `private` → `public` | `POST /share` | unchanged |
| `private`/`public` → `password` | `PATCH /share {password:"…"}` | unchanged |
| `password` → `public` | `PATCH /share {password:null}` | unchanged |
| any → `private` | `DELETE /share` | **see §6 — founder's call** |

### Rejected alternative

*Keep "no share row = private".* It cannot satisfy "return its owner-gated URL", it makes the URL
change on publish, and it leaves `share:true` meaning two different things at create vs later.

---

## 3. Creation semantics — always private

### Recommendation: accept `share`/`password` at create, ignore their publishing effect, and say so loudly in the response

`POST /v1/artifacts` (and `PUT`) will:

1. always create the share row as `private`;
2. **never** publish, whatever `share`/`password` say;
3. return the artifact with `share.url`, `share.visibility:"private"`, and an explicit
   `share.ignored_request` note when the caller asked for something it did not get.

Sketch:

```jsonc
{ "id": "art_…", "slug": "weekly-report",
  "share": {
    "share_id": "KbLJ…", "url": "https://…/a/KbLJ…",
    "visibility": "private",
    "note": "New artifacts are private. Only you, signed in, can open this URL. Publish with POST /v1/artifacts/weekly-report/share.",
    "ignored_request": ["share", "password"]   // only when the caller sent them
  } }
```

### Why not hard-reject `share:true` with a 400

Because it breaks every agent in the field on the day it ships — including our own published
`/skill.md` and the `agent-artifacts` DB skill, both of which *instruct* agents to send `share:true`.
A 400 turns a working integration into a failed publish and an agent that retries forever. Ignoring
the field is **safe by construction** (the outcome is private either way) and *more* discoverable,
because the response says in words what happened and how to fix it.

**A `password` sent at create is dropped, not stored.** Storing a password that has no gate in front
of it would be a credential at rest bought nothing.

> **Founder's call (A):** if you'd rather be loud than compatible, the alternative is
> `400 validation_failed` with `field:"share"`. I recommend against it for launch and suggest
> revisiting after the published skill has been updated for a release cycle.

---

## 4. Viewer enforcement

### One gate, again

`private` collapses into the same choke point the version gate uses. In `readContentFromShare`:

```
visibility === 'public'                     → serve
visibility === 'password'                   → existing assertShareAccess
visibility === 'private' && isOwner         → serve
visibility === 'private' && !isOwner        → throw not_found (404)
```

`isOwner` is the **existing** `requesterAccountId === share.account.id`. But note: `resolveShare`
runs *before* `readContentFromShare` and is shared by `getOgModel` too, so the private check belongs
in **`resolveShare`**, taking `requesterAccountId` as an argument — that is the only way to cover
`/og.png`, which never calls `readContentFromShare`.

### Disclosing nothing

A non-owner hitting a private share must be **indistinguishable from a share id that never existed**:
`ServiceError(404,'not_found','Not found')`, the same `CLIENT_TERMINAL_COPY[404]` page, no
`share_revoked`/`share_disabled` variant, and no `ETag`/`Cache-Control` that differs from the
unknown-id path. Test asserts the two responses match byte-for-byte.

### `/og.png` — the one that leaks quietly

It renders **title + bot name** from the artifact head and is served `Cache-Control: public,
max-age=3600`. For a private artifact it must 404 **and** never emit a public cache header — a CDN
holding a private card would outlive the fix. Plan: gate in `getOgModel` via `resolveShare`, and
return `Cache-Control: no-store` on the 404 path.

Consequence to state plainly: **a private artifact has no social preview.** Correct, and worth a
line in the contract.

### `/frame` — the cross-origin hard case

The sandbox host never receives the dashboard cookie, so `isOwner` is always false there. Options:

- **(recommended) Reuse `/preview/:token/frame`.** It already exists for exactly this — owner,
  sandbox origin, signed 5-minute token, reads no cookie. For a private HTML artifact the viewer
  page points its iframe at the owner-preview URL instead of `/a/:id/frame`. Zero new token types,
  and the security review already happened.
- (alternative) Mint a third `st=` share-view grant on `/a/:id/frame`, mirroring `vt=`. More code,
  one more signed capability to reason about, no new capability gained.

Either way `/a/:id/frame` itself must 404 for a non-owner on a private artifact.

**And a real interaction to fix:** today `vt=` is minted whenever the owner pins a version. Under
private, minting must additionally require the artifact be readable by that requester — otherwise
the grant is a bearer token that survives the artifact going private. Bind minting to the same
`resolveShare` outcome.

### Not touched

- `src/lib/frame-policy.ts` CSPs — unchanged.
- `POST /a/:id/verify-password` — for a `private` artifact it must 404 too, or it becomes an oracle
  for "does this id exist".

---

## 5. The explicit publish path

| Endpoint | Effect | Response |
|---|---|---|
| `POST /a/:id/share` | `private` → `public` (idempotent) | 200/201 share object with `visibility:"public"` |
| `POST /a/:id/share {password}` | → `password` | as above, `password_protected:true` |
| `PATCH /a/:id/share {password:"…"}` | → `password` | 200 |
| `PATCH /a/:id/share {password:null}` | → `public` | 200 |
| `DELETE /a/:id/share` | → `private` (see §6) | 200 |

All are `POST/PATCH/DELETE` on `/artifacts/*`, so they already take the **10/min write budget** with
the 4xx refund from `d53c601`. Making an artifact public is a write and should cost one; no change.

Share responses gain `visibility`. `formatArtifactShare` / `formatReducedShare`
(`src/services/v1.ts:745,761`) and the dashboard's share panel need the new field.

---

## 6. `DELETE /share` — the genuine conflict

The contract promises today:

> `DELETE .../share → revoke; the old URL is dead (410) forever. POST again later = a NEW url.`

That is a deliberate **burn-the-link** privacy tool. The founder's brief says `DELETE /share → back
to private`. Those are different operations, and both are legitimate:

- **(a) Unpublish** — `visibility='private'`, row kept, URL survives and still works for the owner.
  Matches the brief; reversible; the URL an agent already handed out becomes live again on re-publish.
- **(b) Revoke** — `revoked_at` set, 410 forever, next publish mints a new id. Matches today's
  documented promise; the correct answer when a link leaked.

> **Founder's call (B):** I recommend **DELETE = unpublish (a)**, because the brief defines the
> private state as the resting state and (a) is what "back to private" means — and then keeping
> burn-the-link as an explicit, separately-named operation rather than silently retiring it
> (`DELETE /a/:id/share?revoke=true`, or a `POST /a/:id/share/revoke`). Quietly changing DELETE from
> "destroy forever" to "hide for now" would weaken a promise someone may be relying on **today**,
> which is the one outcome worth avoiding.

---

## 7. Migration — forward-only, and I agree with the recommendation

- One forward-only migration per dialect (`drizzle/sqlite/`, `drizzle/postgres/` — schema is
  duplicated by dialect per CONTRIBUTING).
- `ALTER TABLE shares ADD COLUMN visibility TEXT NOT NULL DEFAULT 'private'`, then a **single
  backfill of existing rows to their current effective state**:

  ```sql
  UPDATE shares SET visibility = CASE WHEN password_hash IS NOT NULL THEN 'password' ELSE 'public' END;
  ```

  This is the crux: **every share row that exists today was created by an explicit `share:true` or a
  password, and is public right now.** Backfilling to `public` is not "opting old artifacts in" — it
  is *recording the state they are already in*. Not backfilling would silently take the founder's
  `shipped-in-14-days` link (and every other live link) dark on deploy.
- New rows default `private` because the column default is `private` and the writer sets it
  explicitly.
- No data is destroyed; no artifact changes visibility on deploy.

Add a `CHECK (visibility IN ('private','public','password'))` and the
`visibility='password' ⇒ password_hash IS NOT NULL` invariant.

---

## 8. Docs

- **`/v1/contract`** (`contractText()` in `src/routes/v1/index.ts`) — the important one, since it is
  what agents read:
  - §1: replace *"share:true → …a stable public link"* with **new artifacts are private; the URL is
    owner-only until you publish**.
  - New short section: *"Publishing — POST /share"*, with the three visibility states.
  - Note that `share`/`password` at create are accepted and ignored, and where the response says so.
  - Note that a private artifact has no OG/social preview.
  - `/llms.txt` is the same string → corrected for free (assert byte-identity, as the contract test
    already does).
- **`/skill.md`** (`src/routes/skill.ts`) — it currently teaches `share:true` in two curl examples.
  Both change to create-then-publish.
- **`agent-artifacts` DB skill** — same edit, via
  `node …/content-api.js PUT /api/settings/skills/agent-artifacts`.
- **`docs/api.md`**, `docs/production.md` (visibility model + the OG consequence).

---

## 9. Test plan (mutation-checked, as with the version gate)

**The bar:** every assertion must fail against the pre-change behaviour. I'll verify by reverting the
gate (`private` → always serve) and confirming the suite goes red — the version-gate work found that
6 of 9 cases bit only because I checked.

New `tests/integration/viewer/private-by-default.test.ts`:

1. **Creation is private no matter what is asked** — `share:true`, `password:"…"`, both, neither →
   all four produce `visibility:"private"`; response carries the URL and the note; no password row
   is stored for the `password` case.
2. **Non-owner sees nothing, anywhere** — logged-out **and** a different signed-in account, against
   `/a/:id`, `/content`, `/download`, `/frame`, `/og.png`, `POST /verify-password` → **404 on every
   one**, no content leak, and `/og.png` carries no `public` cache header.
3. **Indistinguishable from nonexistent** — response for a private share and for a never-existed
   share id match byte-for-byte (status, body, and the cache/ETag headers).
4. **Owner can** — valid session → 200 on page/content/download; HTML artifact frames through the
   owner-preview path.
5. **Explicit publish works** — `POST /share` → logged-out reader now gets 200; **the URL did not
   change**; `PATCH {password}` → gate applies; `PATCH {password:null}` → public again;
   `DELETE` → private again and the logged-out reader is back to 404.
6. **Existing public artifacts are unaffected** — a row created before the migration (simulated by
   inserting with the backfilled `visibility='public'`) is readable logged-out. This is the
   `shipped-in-14-days` regression test.
7. **Grants don't outlive visibility** — a `vt=` frame grant minted while public stops working once
   the artifact is private.
8. Unit: the CHECK invariants, and `visibility` defaulting to `private` on a raw insert (fail-closed).

**Blast radius, counted rather than guessed.** `publishSharedArtifact()` in
`tests/integration/viewer/viewer-test-utils.ts` passes `share: true` and is used by **15 test files**;
the e2e seed (`tests/e2e/smoke.spec.ts`) publishes through the real API the same way. All of them
need an explicit publish step after creation. That every existing test had to say "make this public"
in one word — and got a world-readable URL for it — is itself the evidence that the default was
wrong. Budget for it: it is the largest single piece of the change, and it is mechanical.

---

## 10. Decisions I need from the founder

| # | Decision | My recommendation |
|---|---|---|
| **A** | `share:true`/`password` at create: **ignore + explain** vs **400 reject** | Ignore + explain. A 400 breaks every agent in the field, including the ones our own published skill created. |
| **B** | `DELETE /share` = **unpublish** (URL survives) vs **revoke** (410 forever) | Unpublish, and keep burn-the-link as a separate explicit operation rather than retiring it silently. |
| **C** | Private artifacts have **no OG/social preview** | Accept — it is the only correct answer, but it is a visible product behaviour change worth knowing about. |
| **D** | Frame strategy: **reuse `/preview/:token/frame`** vs a new `st=` grant | Reuse. It was built for this exact problem and is already reviewed. |

---

## 11. Rough shape of the work

| Area | Files |
|---|---|
| Schema + migration | `src/db/schema.{sqlite,postgres}.ts`, `drizzle/{sqlite,postgres}/` |
| Creation | `src/services/artifacts.ts` (`ensure*Share`), `src/services/v1.ts` (`publishArtifact`) |
| Enforcement | `src/services/viewer.ts` (`resolveShare`, `readContentFromShare`, `getOgModel`), `src/routes/public.ts` |
| Publish path | `src/services/artifacts.ts` (`createShare`/`setSharePassword`/`revokeShare`), `src/services/v1.ts` formatters |
| Viewer UI | `src/ui/pages/viewer.tsx` (private badge for the owner), dashboard share panel |
| Docs | `contractText()`, `skill.ts`, `docs/*`, DB skill |
| Tests | 1 new integration suite + 15 integration files + the e2e seed |

Estimate: one focused implementation pass, with the migration and the `/og.png` + `/frame` paths as
the parts most worth reviewing closely.

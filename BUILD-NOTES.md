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

## 2026-08-27 — Homepage integrity (GAUNTLET round 1)

### ENV-VAR PROPOSAL

PRD §6 requires every configuration variable to reach this file and the Zod schema in
`src/config.ts` in the change that introduces it. Two entries, one new and one owed.

**`AA_GITHUB_URL`** (new, optional, empty default). Public repository URL for the cloud
marketing homepage. `docs/decisions.md` ("Repository publication status") is the source of
truth: the repository is not published, so no surface may present a working GitHub URL.
README already complies. `src/ui/pages/home.tsx` did not: it hard-coded
`ZeroPointRepo/agent-artifacts` and linked it from the nav button, the open-source line, and
the footer, so the first screen a prospect saw carried three links that returned 404. The
variable is unset by default and each affordance is conditional: with no value the nav button
and footer link are not rendered at all, and the open-source line keeps its deck copy
("MIT licensed and self-hostable, end to end.") with no dead href attached. Setting the
variable to the published repository URL restores all three, including the "Star it on
GitHub." sentence. Validated as a URL by `src/config.ts`, surfaced as `AppConfig.githubUrl`,
documented in `.env.example`. Nothing else in the product reads it.

**`AA_MAIL_TRANSPORT`** = `smtp` | `resend` | `log` (already shipped, proposal owed). It was
authorised during the build as the only environment variable added beyond PRD §6, and it is
documented in `.env.example`, `docs/self-hosting.md`, and `docs/production.md`, but it never
got the §12-mandated entry here. Recording it now. Unset means auto-detect: `RESEND_API_KEY`
selects Resend, otherwise a complete SMTP pair (`SMTP_HOST` + `SMTP_FROM`) selects SMTP,
otherwise no mail is sent. The value `log` writes login links to the application log and
delivers no mail. It is development only, and it is a deliberate weakening of the §4.4 cloud
boot gate, which otherwise makes a cloud instance with no mail transport a fatal boot error:
`log` satisfies that gate. `src/config.ts` warns loudly at boot and the launch checklist
requires removing it before a cloud instance takes real signups. PRD §6's table still owes
both rows; that amendment belongs to a PRD v1.2 pass.

### Hero meta strip is fetched, not written

The LOCKED landing concept frames the hero as a published artifact, and the meta strip
carried `version: 'v1'` and `updatedLabel: 'updated 6 h ago'` as literals. A page whose entire
argument is "your agent keeps this current" cannot claim a fixed age forever, so the strip is
now derived from the artifact itself.

The cloud instance cannot read the public instance's database, so `src/services/live-artifact-meta.ts`
fetches the artifact's public poll surface (`/a/<share_id>/content?poll=1`, which by §8.6 never
counts a view) at boot and every 15 minutes, and keeps one snapshot in memory. The interval is
unref'd, matching the background scheduler's contract. `src/index.ts` starts it in cloud mode
only; the route layer reads the cache and never awaits it, so rendering is never blocked by the
network. Three rules keep the strip honest: a failed or unexpected response leaves the strip
empty rather than falling back to a literal, a snapshot older than 45 minutes is discarded
rather than shown, and `MarketingArtifactEmbed` omits the version chip and the time entirely
when either value is unknown. No new dependency: `fetch` with `AbortSignal.timeout` and a Zod
parse of the two fields used.

### Zone 8 final call to action, and where the reassurance line went

`landing/copy-deck-v2.md` §8 ends the page with "Pricing sentence + OSS line + final CTA +
colophon footer". The final CTA was missing and the omission was never recorded. Added as
`MarketingFinalCta`, registered in `/style-guide` first, placed inside the pricing zone
directly after the terms card. Signed-out visitors get "Get your key"; signed-in visitors get
"Open your dashboard", so the closing action is never a dead end.

The deck also specifies the reassurance microcopy "Hashed URL · free · no card" attached to a
hero CTA. There is no hero CTA: whether the hero gets one is an open founder decision, and this
change does not pre-empt it. The alternative placement, under the navigation actions, reads as
a caption for a button row that already sits beside the wordmark, and it would put a
qualifier above the tagline it qualifies. The microcopy is therefore attached to the zone-8
CTA, where it sits directly under the button it describes. If the founder adds a hero CTA, the
line should move up with it rather than appear twice.

### Origin note sits after "Works with", not before "What people use it for"

The deck's suggested order puts the origin note third and permits reordering "with stated
reasoning". The shipped order moves it to seventh, after "Works with" and before the pricing
zone. The reasoning, from the round-2 direction work: news before opinion. A first-time
visitor arrives asking what this is and whether it works, and the first screens answer that
with the live artifact, the concrete uses, and the whole API. The origin note is the founder's
own account of why the product exists, which is worth more once the reader already believes the
product is real, and it hands off naturally into pricing and open source. Recording it here
because the deck requires the reasoning to be stated somewhere durable.

## 2026-08-27 — GAUNTLET round 1 consolidation

Round 1 landed as seven commits from five parallel workers plus a thirteen-commit foundation
phase. Each worker's decision is recorded below so the repository explains itself without the
orchestrator's log.

### OG cards: static TTF instances of a variable font

OG cards render Source Sans 3 from static TTF instances of the bundled variable woff2, because
satori cannot consume woff2. The card previously shipped the retired Inter and indigo `#4f46e5`
palette while every page shipped Source Sans 3 on coral, so every share link unfurled off-brand.
The fonts served to browsers stay the variable woff2; only the raster pipeline needs the static
instances. (`src/lib/og.ts`)

### Search `q` is literal, and the escape character is named

Search `q` is literal: one shared escaped predicate (`src/lib/search-query.ts`) with explicit
`ESCAPE`, used by `/v1` and dashboard; SQLite has no default LIKE escape char while PG defaults
backslash, so the clause names it. Before this, `%` and `_` in a query were wildcards rather than
characters, which is both a correctness bug and an abuse surface, and the dashboard's predicate had
drifted from `/v1`'s: it omitted `lower()`, so dashboard search was silently case-sensitive on
Postgres while the API's was not. One predicate now serves both.

### Share lifecycle belongs to ArtifactService

Share lifecycle is owned by `ArtifactService` (persist and emit); `deleteShareResponse`'s signature
gained `cloudModule`/`config`/`account`; R2-001 closed. The explicit share endpoints and the four
dashboard share mutations previously wrote through a parallel persistence layer in `src/services/v1.ts`
that emitted no domain events, so a CloudModule analytics consumer missed every share created or
revoked outside the artifact write path. `deleteShareResponse` could not emit even in principle: it
never received the module. That is why the signature changed rather than the body alone.

### Generated CSS stays generated, and a missing build says so

`pnpm dev` now runs `build:css` before the watcher, so the documented first run works by command
rather than by luck. Generated CSS stays gitignored: Tailwind hashes its output over the whole
scanned source tree, so committing it would churn on unrelated UI edits, and a stale committed copy
would reintroduce the 404 class this change closes. `pnpm build` remains the authoritative producer
for the image and the release archive. `src/ui/assets.ts` resolves the manifest from
`import.meta.url` rather than the working directory, caches the resolved href instead of re-reading
JSON on every render, and invalidates on rebuild. A missing build is now impossible to miss: one
stderr block naming `pnpm run build:css`, and pages link the tracked
`public/assets/build-missing.css`, which paints its own diagnosis as a red banner rather than
resolving to a file that has never existed. `public/assets/og-fallback.png` is guarded by a
byte-equality test against `generateOgFallbackImage()` rather than being regenerated during the
build, because the render is deterministic and a build step would let the committed card drift
silently the way the palette already had.

### Phase F: twelve foundation steps, and the discovery underneath them

Phase F took the shared UI foundation (`primitives.tsx`, `app.css`, the `ui-foundation` module,
the style guide) through twelve sequential steps: modal re-centring and full-viewport drawer scrim,
three cascade repairs, width as a token and a prop, the Notice primitive, a real document shell for
sandboxed HTML artifacts, standards-mode documents, human navigations answered with a page instead
of the API error envelope, a named and affordanced Table scroll region, markdown prose scope split
from page geometry, the version picker no longer offering "View latest" on the latest version, a
single brand mark with a properly cut notch, and destructive confirmation as one pattern rather
than eight open forms.

The step that matters most was not on the list. No page in the product emitted a doctype, so every
surface rendered in quirks mode: a different box model, different percentage-height resolution,
different line-height behaviour. Spacing defects recorded before this fix were measured in the
wrong rendering mode and must be re-measured rather than trusted.

One caveat ships with this phase. The `ui-foundation` and `viewer` runtime assets were edited under
their existing content-hashed filenames, so those names no longer describe their contents. There is
no `Cache-Control` on `/assets`, so exposure is limited to heuristic browser caching, but a
returning visitor can receive stale drawer and modal JavaScript after this deploy. Verification of
this release therefore uses cold browser contexts. The S4-remainder work re-mints asset names from
content on every build, which makes the filename a promise again; `immutable` must not be added to
`/assets` until it does.

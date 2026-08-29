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
`log` satisfies that gate. `src/services/mail.ts:23` warns loudly at boot and the launch checklist
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
gained `cloudModule`/`config`/`account`. The explicit share endpoints and the four
dashboard share mutations previously wrote through a parallel persistence layer in `src/services/v1.ts`
that emitted no domain events, so a CloudModule analytics consumer missed every share created or
revoked outside the artifact write path. `deleteShareResponse` could not emit even in principle: it
never received the module. That is why the signature changed rather than the body alone.

**R2-001 is closed for the share lifecycle, not in full.** One piece of the same seam is still open
and says so in the code: `ArtifactService.getTemplatePreview` carries a `TODO(R2-001 follow-up)`
because it is a template read model living on the artifact service. It was moved there so the
dashboard route would stop owning SQL, which was the urgent half; consolidating it alongside
`src/services/dashboard-read-models.ts` is the remaining half. Read the claim as "no share mutation
bypasses the service or its events any more", which is true, rather than "the seam is gone".

### Asset pipeline

ASSET PIPELINE (R1-W3, ff81395): `pnpm dev` now runs `build:css` first; generated CSS + manifest
stay gitignored with `pnpm build` authoritative. `src/ui/assets.ts` resolves the manifest from
`import.meta.url`, caches it with fs.watch invalidation, and on a missing build logs one
`[agent-artifacts] STYLESHEET BUILD MISSING` block and serves the checked-in
`public/assets/build-missing.css` instead of the non-existent `/assets/app.css`. New script
`pnpm run build:og-fallback` regenerates `public/assets/og-fallback.png`, guarded by a
byte-equality test. Retired Inter font files and their notices section deleted.

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

## 2026-08-27 — Section 12 registrations that were owed

PRD §12 forbids silently inventing endpoints, env vars, DB columns or response fields, and requires
each one to be recorded here. The round-1 consolidation claimed the repository could now explain
itself; a validator checked that claim against the code and found three registrations still missing.
They are recorded below, grounded in the code as it stands rather than in anybody's memory of it.

### New endpoint: `POST /v1/templates`

`src/routes/v1/index.ts` mounts a sixth `/v1` family member that PRD §8 does not list: promote an
existing markdown artifact into an account template. It takes `artifact_id`, `name`, `slug` and an
optional `description`, and returns `201`. §9.5 describes promotion as a "Dashboard-only flow", so
this endpoint is a genuine addition to the agent-facing surface, not a re-description of one.

It was authorised during the build rather than invented, and it is not hidden: it appears in the
served `/v1/contract` text as section 3, in the generated OpenAPI document, and in `/skill.md`, and
two guard tests assert the contract text and the document agree with the routes. What it never had
was this paragraph. The consequence of the omission is narrow but real: PRD §8 remains the written
spec, and a reader comparing §8 to the code finds an endpoint with no recorded decision behind it.

### New response field: `latest_version_num`

`src/routes/public.ts` adds `latest_version_num` to the `/a/:share_id/content` payload. §8.5.2's
documented body does not contain it. It exists because §9.4 requires the viewer to say "Viewing v4
of v7" when a reader has pinned a version with `?v=`, and the reader cannot know the second number
without being told it. The field is therefore necessary, and adding it was right; not writing it
down was not.

### Named CSP variant: `dashboard-preview`

`src/lib/frame-policy.ts` defines two frame policies rather than one. Appendix A Lesson 11 says the
owner dashboard gets no looser sandbox than the public page, and this variant honours that by being
strictly tighter: `default-src 'none'`, `connect-src 'none'`, `font-src 'none'`, `base-uri 'none'`,
no `https:` script or style sources, and `script-src`/`style-src` limited to `'unsafe-inline'`. The
public artifact policy allows `https:` sources for all three.

Two differences are deliberate and worth stating rather than leaving to be rediscovered. The preview
sets `Referrer-Policy: strict-origin-when-cross-origin` where the public frame sets `no-referrer`,
and it sets no `Cache-Control`, because a preview of the owner's own draft should not be cached by
anything. One difference is a gap rather than a decision: the preview headers carry no
`frame-ancestors` directive, so that response is the only frame response in the codebase without a
framing restriction. The exposure is small because the route is session-gated and `aa_session` is
`SameSite=Lax`, but it is an omission, not a choice, and it should be closed rather than explained.

## 2026-08-27 — Commit archaeology: where the OG repaint actually lives

`7723be1` is titled "fix(postgres): make view recording conflict-free and search case-insensitive"
and its message describes only those two things. The commit also contains the entire Fresh Air
repaint of the OG card: `src/lib/og.ts` rewritten, both Source Sans 3 static TTFs added,
`public/assets/og-fallback.png` added, `src/ui/assets/fonts/README.md`, the `THIRD-PARTY-NOTICES.md`
entry, and 122 lines of `tests/unit/og-image.test.ts`.

That happened because two workers shared one checkout and one staged the other's files. The branch
is shared and already deployed, so the history is not being rewritten to fix it. This note is the
correction instead.

The practical consequence, and the reason this is worth a section: anyone asking "when did the OG
card stop being indigo Inter and start being coral Source Sans 3, and why" will search the log for
a commit about OG and find none. The answer is `7723be1`, and the reasoning is in the OG entry of
the round-1 consolidation above. Blame on `src/lib/og.ts` points at a Postgres commit; that is an
accident of tooling, not a sign that the palette change was slipped in.

## 2026-08-27 — Corrections to the section-12 registrations, and one more archaeology note

Appended rather than edited in place. The entries above record what was true when they were
written; overwriting them would make this file read as though it had always been right.

### The dashboard-preview framing gap is closed

The registration above says the dashboard-preview headers carry no `frame-ancestors`, making that
the only frame response in the codebase without a framing restriction. That was true when it was
written and stopped being true the same evening: `22cfbd5` added `frame-ancestors 'self'` to
`dashboardPreviewFrameCsp`, and the deploy verification confirmed it live by diffing the response's
CSP directive set before and after (exactly one directive added, none removed, public frame headers
byte-identical).

`'self'` rather than the configured base URL is deliberate and the commit explains why: the
dashboard embeds this route with a relative `src`, so the framing parent is whatever origin served
the dashboard, which is not always `BASE_URL` behind a proxy, on a custom domain, or in
development. `'self'` is that origin by definition and cannot drift from it. The public variant
names an origin for the opposite reason: it is served from the sandbox host and framed by the app
host, so the two genuinely differ.

So the registration above should now be read as history. Every frame response in the product has a
framing restriction.

### `6ef8917` and `6213cd8` are one logical change

`6ef8917` stops the viewer telling a recipient that a suspended owner revoked their link: it
changes the thrown code from `share_revoked` to `share_disabled`, and updates
`revoked-share-410.test.ts` to assert the new terminal copy, "This link is no longer available."

It does not contain the branch that produces that copy. The mapping from `share_disabled` to that
title lives in `src/routes/public.ts`, and it arrives nine seconds later in `6213cd8`, a commit
titled and described as being about download content negotiation. `6ef8917` touches `public.ts`
zero times, so at that commit the viewer throws a code the terminal page has no branch for and the
test it ships fails.

The consequence is narrow and specific: anyone bisecting through this range lands on a commit whose
suite is red for a reason unrelated to whatever they are bisecting for, and neither message tells
them why. Treat the pair as a single change. Same remedy as the `7723be1` note above, and the same
reason: the history stands, so the explanation goes here.

### §7.2.8 view recording: the shape deviates from the PRD, deliberately

PRD §7.2.8 prescribes a literal `INSERT … ON CONFLICT (share_id, viewer_id) DO UPDATE` upsert on
both engines. What ships is three steps on both engines: a throttled `UPDATE`, then a capped
`INSERT … ON CONFLICT DO NOTHING`, then an existence probe that separates "throttled" from "at the
50,000-row unique-viewer cap".

The deviation is real and it is deliberate. A single `DO UPDATE` upsert cannot express the
50,000-row cap, because the cap has to be evaluated before the insert is allowed to create a new
viewer row, and it cannot distinguish "this viewer was throttled inside the 10-second window" from
"this share is at its cap", which are different outcomes that the counting rules treat differently.
The three-step form keeps every counting semantic §8.6 specifies, is race-proof on both engines
(the `23505` that used to 500 the public content endpoint is now structurally impossible), and was
verified red-before-green.

Until now this was explained only in a code comment. PRD §7.2.8 still prescribes the shape that is
not shipped, so a v1.2 amendment is owed there too.

## 2026-08-28 — Template thumbnails and HTML examples (PKG-B)

No new environment variables, endpoints, or runtime code paths. The change is content plus one
generator script.

### Thumbnails are committed derived bytes, and the generator is not part of `build`

`scripts/build-template-thumbs.mjs` (`pnpm run build:template-thumbs`) writes
`public/assets/template-thumbs/<slug>.png` for every built-in template, and `templates/manifest.ts`
names those paths in each entry's `thumbnail`. The PNGs are committed for the same reason
`og-fallback.png` is: they are served as static files. They are also *derived*, so the same
obligation applies — re-run the script when a template changes and commit the result.

It is deliberately excluded from `pnpm run build`. The generator needs a Chromium download; a
production image has no business carrying a browser to reproduce bytes that are already in the
repository. `tests/unit/template-seed.test.ts` closes the loop the build no longer does: it asserts
every manifest `thumbnail` names `/assets/template-thumbs/<slug>.png` and that the file exists, so a
new template without a generated thumbnail fails the suite rather than shipping a broken image.

### Markdown thumbnails go through the product's own renderer

The five markdown starters are not typed cover tiles. Each is merged with sample slot values, run
through `renderMarkdown()`, wrapped in the viewer's own `.aa-prose-page` container and linked
against the compiled `app.css` — served over loopback for the length of the run, because a
`setContent()` page has no origin for `/assets/app-<hash>.css` or the font it asks for. The
thumbnail is therefore the page the template actually produces, and it cannot drift from it.

The sample slot values live in the script, not in the shipped templates: a thumbnail of `{{title}}`
sells nothing, and `mergeTemplateContent()` refuses to render a required slot with no value.

### Thumbnail geometry is uniform; the viewport is not, on purpose

Every PNG is 1000×625 (16:10, 2x a ~500px card) so the grid is uniform. The *viewport* behind it is
per-template: 1280 for the full-bleed HTML examples, 1024 for anything that is a reading column
(the five markdown starters and `report-html`). At 1280 a 72ch measure sits in the middle of the
frame with ~300px of empty gutter either side and reads as a blank tile at card size. The capture is
always the top-left 16:10 region, so only the design width differs, never the output.

### The three HTML examples are self-contained by contract

`recap`, `metrics-dashboard` and `report-html` ship as `type: "html"` with `slots: []`: they are
example artifacts an agent rehashes with new content, not slot templates. Each is one file with all
CSS in a `<style>` block, custom properties for colour and spacing, system fonts, and no images —
which is not stylistic. The dashboard-preview frame CSP (`src/lib/frame-policy.ts`) serves them
under `font-src 'none'` and `img-src data: https:`, so anything external would simply not render.
Their thumbnails are captured with `setContent()` and no server at all, so an example that stops
being self-contained shows up in its own thumbnail.

`metrics-dashboard` carries one series hue for data marks and reserves the status palette for
state, always paired with a text label and glyph. The two colour families are adjacent in places
(an amber "at risk" meter beside a red delta), which the icon + label pairing is there to cover.

## 2026-08-29 — The owner "Rendered preview" was blank on cloud

### The defect

`src/app.ts` sends every HTML page `frame-src ${config.frameOrigin}`, and `config.frameOrigin` is
`SANDBOX_ORIGIN` when one is set and `'self'` when it is not. The owner preview iframe on the
artifact detail page — and the HTML branch of the template preview panel — pointed at a *relative*
`/dashboard/artifacts/:id/frame`, which resolves to the dashboard's own origin. A cloud dashboard
therefore forbade its own preview: the only origin in `frame-src` is the sandbox host, so the
browser blocked the load and the "Rendered preview" card rendered blank. Self-hosted has no
`SANDBOX_ORIGIN`, `frame-src` falls back to `'self'`, and the identical markup worked, which is why
the defect reached production behind a green suite.

The rejected one-line fix is `frame-src 'self' ${frameOrigin}`. That re-admits artifact scripts to
the origin holding the owner's session cookie — the precise risk the sandbox host exists to remove.

### The fix: the owner preview moves to the sandbox host, like every other artifact frame

`GET /preview/:token/frame` (`src/routes/preview.ts`) is a sibling of `/a/:share_id/frame`. It
answers on the sandbox host, is listed in `isSandboxAllowedPath`, carries a frame CSP that sandboxes
the document, and **reads no cookie in either deployment**. What authorises it is a short-lived
signed token rather than a share id, because unpublished content has no share id and a cross-origin
host never receives the session.

`src/lib/preview-token.ts` mints it: `base64url(json).hmac-sha256-hex` over `SESSION_SECRET`, with
the *purpose* inside the signed payload so it cannot be confused with the share-access token that
uses the same secret and construction. Claims are `{accountId, subject, subjectId, contentHash,
exp}`, five-minute TTL, minted only by a page render that already passed the session gate. The
account id is a predicate in the SQL read, not a check afterwards, so a valid token can never
surface another owner's work. `src/lib/signed-token.ts` now holds the HMAC and constant-time-compare
primitives that `services/viewer.ts` had kept private, so there is one implementation of both.

`ownerPreviewFrameUrl()` resolves against `sandboxOrigin ?? baseUrl` — the same single conditional
`ViewerService.frameUrl()` already makes for public frames. Self-hosted keeps a same-origin preview
its own `frame-src 'self'` permits; cloud gets the sandbox origin. One code path, both deployments,
which is what stops them from drifting apart again. The two session-gated
`/dashboard/{artifacts,templates}/:id/frame` routes are deleted rather than left as a second way to
do the same thing.

**No new environment variable.** The token is signed with the existing `SESSION_SECRET`, and the
origin choice reads the existing `SANDBOX_ORIGIN`. PRD §6 has nothing to add.

### Frame policy: `dashboard-preview` is renamed `owner-preview` and learns where it is running

Same directive set, still stricter than the public variant on everything that grants a capability.
Two changes. `frame-ancestors` is now `'self'` only when there is no sandbox origin and the app
origin when there is one — `'self'` would name the *sandbox* origin on cloud and refuse the only
embedder there is. And the response gains `Cache-Control: no-store` (one owner's private draft, on a
URL that now travels through cloud infrastructure) and `Cross-Origin-Resource-Policy: cross-origin`
(parity with the public frame beside it, so neither breaks the day a COEP header appears).

`contentHash` is signed but deliberately **not** compared at read time. Binding it makes the frame
URL change whenever the content does, so nothing can serve a stale preview; requiring it to match
would turn a routine republish inside the five-minute window into a terminal page instead of the
current content. The token authorises *this owner's copy of this artifact*, at whatever revision
that is.

The preview route is not rate-limited. An invalid token costs one HMAC and no database read, and a
limiter in front of the owner's own preview buys little for the risk of throttling it.

### The harness change that made the bug visible: a second HOST, not a second port

`playwright.config.ts` claimed a third port for `SANDBOX_ORIGIN` and left **nothing listening on
it**. That satisfied the config validator and every assertion anyone had written, and it could not
serve a byte — so no test had ever framed anything from a sandbox origin. The thing a cloud instance
exists for was configured and never exercised.

`SANDBOX_ORIGIN` is now `http://localhost:<cloudPort>` against a `BASE_URL` of
`http://127.0.0.1:<cloudPort>`. The two resolve to the same socket and are *different origins* to a
browser, which compares host strings and not addresses — so one process answers on both, exactly as
the real deployment does behind two DNS names, while CSP, cookies and the sandbox host guard all
treat them as separate hosts.

The cloud instance also moves to `LOG_LEVEL=warn` with stdout redirected to `<scratch>/server.log`.
Cloud has no password login and no setup wizard, so the only way into its dashboard is a magic link,
and with `AA_MAIL_TRANSPORT=log` that link is a `warn` line. At `error` the suite could reach every
signed-out cloud surface and no signed-in one — which is why no browser test had ever opened the
cloud dashboard. Redirected rather than teed: `tee` block-buffers its output file, which would make
the wait flaky for no visible reason.

### What the new tests assert that the old ones structurally could not

`tests/e2e/owner-preview.spec.ts` signs in to the **cloud** instance through the real magic-link
flow and asserts the preview `src` is on the sandbox origin, that the framed document actually
rendered the artifact's own heading, and that the browser logged no CSP violation. Reintroducing the
defect (pointing `ownerPreviewFrameUrl` back at `baseUrl`) fails it with Chromium's own sentence:
`Framing 'http://127.0.0.1:PORT/preview/…' violates the following Content Security Policy directive:
"frame-src http://localhost:PORT"`. The console matcher is copied from that failure rather than
written from memory — Chromium says "Framing … violates", not "Refused to frame".

The old integration tests requested the frame route *directly*. A CSP is enforced by the embedder
and never by the response, so a frame route can answer 200 with immaculate headers and still be
un-framable; fetching it proves nothing about whether a page can show it. Every assertion in
`tests/integration/owner-preview-frame.test.ts` is therefore about a relationship between two
responses — the origin the dashboard puts in the `src` against the origin its own CSP admits — and
it reaches the frame URL by reading it off the rendered page rather than by constructing it.

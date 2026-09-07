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

## 2026-08-29 — Cleanup: promote panel, stale e2e assertions, biome

No new environment variables, endpoints or dependencies. Three items, plus one regression the
second item uncovered.

### The Promote panel now matches the promote rules

`promoteArtifactToTemplate` stopped refusing HTML artifacts and slot-free artifacts when templates
became reusable *examples*, but `PromotePanel` still hard-blocked `artifact.type !== 'markdown'` and
offered "Only markdown artifacts can be promoted" beside a card described as "Templates fill
{{slots}} in markdown". The UI was refusing what the service accepts, which is the one disagreement
a form can have with its own endpoint that a reader cannot work around.

`ArtifactType` is exactly `'markdown' | 'html'`, so the gate is removed rather than widened — there
is no third type to keep a branch for. Slots are surfaced only when the artifact has them ("Slots
your agent can fill: …"); the old "Detected slots: none yet" read as a precondition on a panel whose
submit worked fine without one. The submit says "Save as template".

The two refusal codes those rejections fed, `markdown_only` and `needs_a_slot`, are deleted from
both `promoteFailureCode` (route) and `promoteFailureMessage` (page) rather than left unreachable. A
branch for a cause nothing can raise is a sentence waiting to be printed by mistake, which is
exactly the V10-N2 defect those functions already carry a comment about. Markdown slot merging is
untouched: `mergeTemplate` still returns content verbatim when a template declares no slots.

### `columnPriority` is restored to the version-history table

`83d3fe6` deleted `columnPriority` from the version table with no stated reason, and `8dce0a2` — a
commit about HTML templates — then flipped `dashboard-table-priority.test.ts` from `toContain` to
`not.toContain` so the suite went green. What that pair shipped is the defect `178f849` fixed:
`.aa-table` forces a 42rem minimum, so with priority off the table scrolls and Actions leaves the
viewport. Measured in Chromium at 375px before restoring it: **the Diff control ended at 532px, 157
pixels past the right edge**, behind a scroll region nothing signposts. Diff and Restore were
unreachable on a phone.

The flipped assertion was also incoherent on its own terms — it kept asserting Summary is declared
`secondary` while asserting the machinery that acts on that declaration is off, so the markup
described a behaviour the page did not have. This is the one place in this pass where product
behaviour changed rather than a test: the alternative was weakening `expectActionsColumnReachable`,
which would have blessed an unreachable control.

### The homepage smoke assertions describe the shipped homepage

`smoke.spec.ts` still described the first marketing page. Two of its assertions changed *meaning*
and are commented in place rather than quietly rewritten. **GitHub is now intentional**: the old
rule was `a[href*="github.com"]` count 0, because an unpublished repo must not be linked; the hero
and the self-host card both carry "View on GitHub", so the assertion is inverted to "the affordance
exists and points at github.com". It deliberately does not fetch that URL — a local smoke suite
cannot assert a third-party host without going flaky, and `HOME_REPO_URL` already records that it
404s until the repo is published. **The meta strip is no longer fetched**: it had to be absent
because an unreachable live artifact must not fall back to a literal, but the hero is now a static
illustration of an artifact card, so its parts are asserted present instead. The fixed
"published 3h ago" is a property of the shipped page and is noted in the test rather than lost in a
deleted line.

The dashboard row assertions moved with the UI: `.aa-list-row` → `.aa-dashboard-card`, the share
badge vocabulary from "Shared" to Public / Private / Password-protected / Link revoked, and the
stretched-link hit test to `aa-dashboard-card__link`. The hero's visibility control is asserted per
width, because it stands down below 390px and is in the DOM either way.

### biome

`noDescendingSpecificity` (×4) is fixed by reordering, not suppressed. Each override moved to sit
after the base rule it overrides — the app-nav `.aa-btn` rule after `.aa-btn` (carrying its
`min-width: 760px` media query with it), the two hero-card `.aa-marketing-api` rules after
`.aa-marketing-api`, and the hero-card `__agent` rule past the last `.aa-marketing-artifact__agent`
rule. Verified as a pure reorder: compiling the sheet before and after yields the identical multiset
of 578 rules with the same at-rule nesting, and only those four change position. Nothing about the
resolved cascade moves — the qualified selectors already won on specificity — only the order the
file reads in. `noSvgWithoutTitle` is fixed with a real `<title>` in each logo; both render through
`<img alt="">`, so the title serves anyone who opens the file on its own.

## 2026-09-06 — Approved five-template visual revamp (review branch)

This branch integrates five designs selected after a side-by-side review. It does not alter routes,
slugs, categories, template types, slots, CSP, migrations or runtime behavior:

- `proposal.html`: **Decision Spine (A)** — approved source SHA-256
  `410f6432ae72556ff5f234b7ca682bb06fadb18ab9ff684827cdc5b59e64fdd5`.
- `project-plan.html`: **Phase & gate map (A)** — approved source SHA-256
  `731edb7f5e6c8d4fdce7b6b6ef9c37279affacd42a278f12caf312930775c143`.
- `checklist.html`: **Gate Ledger (A)** — approved source SHA-256
  `11af6b493836d125e2f5f30fb67b637332f4aad90e9d8c5de061d2c6f5d6675f`.
- `service-health.html`: **Budget accounting board (A)** — approved source SHA-256
  `994adadd14891263c23e61a0a8912b16608307abc4ccac1c31a3d4cb5d93f1a8`.
- `report.html`: **Briefing Broadsheet (B)** — approved source SHA-256
  `05f82a6a39026c7570a6b7df523ef01d77bc10ba4401c75581df08a851f2baac`.

The listed hashes bind the approved preview inputs. Production preserves their `<style>` and `<body>`
bytes exactly; Proposal, Checklist and Report reuse their previous reader-facing `<title>` text instead
of shipping the preview-only “Alternative A/B” labels. Their resulting canonical SHA-256 values are
`7279fefcd7c01dcca7f214d6d3267ea0d2ca894b59adab53a29a7e694ca1dfdb`,
`19a86a131daeab7e95e34f0d4da358effc9606362e85d03f32359f2e335150b1` and
`2d2222c8596c0560ebb816370b358ca262bde5e6431c52ca47e08f3ee943fa39`. The public frames at the
branch point matched the previous canonical files exactly through `</html>` plus the final newline;
the frame server's appended height reporter is not template source. Proposal's catalog description
is updated because the approved design leads with a dated ask rather than a hero number. Report's
description now names its finding → recommendation → evidence opening instead of the superseded
summary/figures split, and Project plan's now names the phase/gate/dependency ledger rather than
stage cards. Names, slugs, categories, formats and slots are unchanged.

The gallery crops are also part of the review contract, not an incidental screenshot. Proposal and
Report use a 1280px thumbnail viewport so their signature dated ask and finding/recommendation/
evidence band appear inside the 16:10 crop. Project plan uses 1440px so the crop includes all four
schedule rows and the today marker without shrinking the ledger to an illegible overview. Checklist
and Service health keep their existing framing. `thumbnail_viewport` changes only the Chromium
canvas used to derive the committed 1000×625 PNG; it does not alter the template source or runtime
frame layout.

After modifying a template, build browser assets first and regenerate thumbnails with the canonical
tooling:

```sh
pnpm run build:assets
pnpm run build:template-thumbs
```

The generator rewrites every committed thumbnail. Review the working tree and keep only image
changes whose source template or thumbnail framing was intentionally changed. For an additional
full-page review set, use:

```sh
pnpm run build:template-thumbs -- --review-dir /absolute/review/directory
```

Do not hand-edit thumbnail PNGs or treat them as template source. The approved set deliberately
keeps distinct document voices rather than applying one shared dashboard shell: decisions use a
humanist decision spine, plans use phase/gate and readiness-ledger forms, status uses budget
accounting, and research uses an editorial broadsheet.

## Accepted operational templates — Batch03 integration (Astra)

This is the separate three-template adoption after PR40, based on main
`661501182a82bcdd25e478bf965aa24452fb6c8f`. It does not replace or redesign the first
five approved templates. It does not complete the remaining gallery revamp.

- **Metrics dashboard / Performance Sheet:** broad twelve-week trend with a compact
  metric ledger, commentary, channel accounting and metered service levels.
- **Project status / Decision Dispatch:** changed verdict and two owned, dated asks
  before milestones, scope and blockers.
- **Postmortem / Incident Atlas:** impact accounting alongside the failure trace,
  then the complete chronology, causes, factors and owned action items.

The accepted standalone sources remain immutable in the design evidence. Catalog
copy now describes these actual compositions. Each canonical thumbnail uses the
unchanged generator with an explicit 1280px viewport: the chart/ledger, two decisions,
and impact/trace remain visible in actual 1440px and 390px gallery cards. No global
capture changes or other template/thumbnail churn. All twenty options, nineteen HTML
plus Markdown, keep their existing slugs, categories, slots and API contracts.

### Source provenance and the bounded semantic exception

| Template | Accepted SHA-256 | Integrated SHA-256 |
| --- | --- | --- |
| metrics-dashboard | `696deb41eba35235f401244d909a1505f3b5424a35e578ade883a55c6fcc1730` | `7305ae47ce611cbf81cd39a230b10542a46d2d1eb97de399a78b43718ec59ea4` |
| project-status | `d8f0db0a085f20cf58bcdff20c04b1525e4e41f19fb17218cbfd7d41c16f484f` | same, byte-for-byte |
| postmortem | `791e91c086761ac21825ceca2ccb13d86699209e9533ec91e179b96dd38815a9` | `2b4660e588413516dd26f01e32123256911ac2cefd9bc3428809d533f78512b3` |

Project Status is exact. The only accepted-source changes elsewhere are one
justified `noRedundantRoles`-only HTML file directive in Metrics and Postmortem,
and exactly four Postmortem action IDs changed from `td` to native `th scope="row"`,
retaining their class, explicit role and mobile-label attributes. No title changes,
CSS changes, text/data/link/code/SVG changes or other rule suppressions.

The table-family roles are intentionally retained: responsive CSS uses block/grid
display and visually clips, rather than removes, column headings. [MDN's display
accessibility guidance](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/display)
warns that changing table display can alter accessibility representation in some
browsers. This is a compatibility exception, not a general permission to add redundant
roles. The scoped regression fixes its inventory:

| Explicit role | Metrics | Postmortem |
| --- | ---: | ---: |
| table | 1 | 1 |
| rowgroup | 3 | 2 |
| row | 7 | 5 |
| columnheader | 5 | 5 |
| rowheader | 6 | 4 |
| cell | 24 | 16 |

Each also retains one unchanged named SVG `img` role. Any expansion needs a new
justification. Native scoped row-header tests fail against the accepted pre-fix
Postmortem. Browser tests verify native scope, accessible names, row membership,
column order and matching mobile labels at all seven existing viewport projects.
Eight paired accepted/final captures (both tables at 1440/768/390/320) have identical
PNG bytes and Chromium accessibility snapshots. Native HTML header association plus
Chromium table/row hierarchy is verified; this is **not** a Safari/Firefox or screen
reader navigation claim.

### Validation and known warnings

All 301 original text nodes, 251 numeric occurrences and 47 keyed comparison groups
remain intact, including action relationships, SVG bytes and meter data. The old
Postmortem tag-bucket parity check normalizes only the four authorized ID tags;
independent action-record checks and exact allowed-transform equality remain strict.

Initial lint: **87 errors → 0**. Four native IDs fix twelve semantic errors; the
approved compatibility directives account for 75 redundant-role diagnostics.
Warnings: **22 → 31**, not an unexplained baseline pass. Fifteen elsewhere are
unchanged; old Metrics seven specificity warnings are replaced by two in its new
CSS; Project Status adds nine specificity warnings; Postmortem adds five important
style warnings. These are sixteen warnings in accepted new CSS minus seven removed,
net nine. Contextual verdict/section and keyed-column overrides retain their approved
cascade. Postmortem's explicit ID/due font sizes and ID weight retain approved native
header/mobile presentation. No warning suppression or CSS reorder was applied;
current/prior breakpoint checks and pixel parity show no observed rendering defect.

Final evidence includes check/build/full unit and browser suites, three frames at
four main widths plus 36 boundary captures, all nineteen HTML and Markdown smoke,
no-JS and growth checks, actual gallery cards, full-gallery interim variety, exact
source/thumbnail hashes and first-five live preservation. The integration remains
**unmerged and undeployed pending project-lead integrated review**.

[Integrated review and machine-readable evidence](https://anacreon.ai/downloads/aa-template-revamp-1788686289312/integrated-batch03/index.html)
retain the original design approval provenance and distinguish fresh final-source
checks from reused unchanged-source evidence. No runtime, schema, billing, sandbox,
launch, infrastructure or dependency change is included.

## Accepted decision-oriented templates — Batch02 integration (Astra)

This separate four-template adoption is based on the deployed PR41 merge
`1b48644469a8a392263482cd31ceb8db8ac7ab2a`. The first eight redesigned HTML sources
and their thumbnails remain byte-for-byte unchanged. Seven additional accepted
technical/editorial designs are still queued; this PR does not finish the section.

- **Meeting recap:** six owned action rows lead beside the complete decision minutes,
  followed by the explicit deferral, open questions and meeting handover.
- **Decision brief:** a compact recommendation above the complete five-criterion
  option bench, then alternatives, explicit asks and the deadline.
- **Spec:** scope pairing and ruled native requirement records, keeping every ID,
  priority, acceptance clause and blocking question relationship.
- **Research Brief:** the answer qualified by confidence and method, an evidence and
  provenance register, grouped sources, answer-changing conditions and unknowns.

Catalog descriptions reflect these compositions. The unchanged canonical thumbnail
pipeline uses 1600px source viewports for Meeting recap and Decision brief (all six
owned actions / all five comparison criteria visible), and 1440px for Spec and
Research Brief (scope/requirements and answer/confidence/evidence visible). The
actual gallery cards were reviewed at 1440px and 390px. No global capture hack,
manual PNG edit, other thumbnail change, slug/category/slot or API contract change.
The catalog stays at nineteen HTML examples plus the Markdown One-pager.

### Exact accepted-source mapping

| Template | Accepted SHA-256 | Canonical SHA-256 |
| --- | --- | --- |
| meeting-recap | `e8ff4f5203c169c60bd559eea0c8998bd4a629a5904e58c3d4915d2a4d1c8b28` | `be10b99a09fa0e589619bf5f2b07f3027722e0e9f8ad5c5e9e01c50416fee495` |
| decision-brief | `18b8f4f8bf9eddc649e17de08bd932257f5da7163654a69cc1e3eded1b26eda6` | `77da9c704f717c821792d30f2276742f277d3a13f57977a43fa1040e6cc9d68f` |
| spec | `1cc6c161b5e158ea6692f5b4219fa1f9e1077127e6272a2953a2a2df8e601451` | same, byte-for-byte |
| research-brief | `2ba837d4421fffb84c551813e3462e7bc67c25c041e139f02677ec4175316945` | same, byte-for-byte |

The only source differences are one approved `noRedundantRoles`-only compatibility
comment at the beginning of Meeting recap and Decision brief. No CSS, body, title,
tag, ID, scope, role, headers reference, text, data, code, link or SVG change. Both
already have native scoped headers; there is no cell-tag correction in this batch.
The accepted previews and the earlier public evidence remain immutable.

These two responsive tables retain explicit table roles because their mobile CSS
uses block/grid display and visually clips column headings. [MDN's table display
accessibility warning](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/display#tables)
provides the compatibility rationale. This adds only these two named files to the
local exception list; it is not permission for other files, rules or global config.

| Explicit role | Meeting recap | Decision brief |
| --- | ---: | ---: |
| table | 1 | 1 |
| rowgroup | 2 | 2 |
| row | 7 | 6 |
| columnheader | 4 | 4 |
| rowheader | 0 | 5 |
| cell | 24 | 15 |

The existing scoped unit test now bounds all four approved exception inventories.
Its two new cases fail against the accepted pre-comment files and pass with the
exact approved candidates. Existing browser tests are extended, not duplicated:
the new cases traverse the real app sandbox and verify native `headers` IDs, scope,
correct table/row/column membership, accessible names and phone overflow. Disposable
DOM red controls must reject dangling IDs and existing-but-wrong row/column headers,
then recover when original references are restored. No production data is involved.

Eight accepted/candidate pairs at 1440/768/390/320 have equal PNG bytes and ARIA
snapshots; their candidate hashes equal the final canonical hashes. Eight real
local app sandbox measurements record table hierarchy and header associations with
actual child-frame widths. Evidence is Chromium-only: not a Safari/Firefox or
screen-reader navigation certification. Case-insensitive accessible-name comparison
accounts only for visual CSS uppercase versus authored ARIA snapshot case; IDs,
scopes, relationships and original names remain recorded without normalization.

### Validation, provenance and warning disposition

Independent content parity retains all 298 text nodes, 159 numeric occurrences,
70 keyed groups and the link/code/ordinal relationships. Final source identity is
proved by the exact allowed transform, not by screenshots alone. The earlier
16 main plus 24 actual/prior breakpoint captures, 58 detailed semantic width checks,
12 fixtures, no-JS/growth checks and actual gallery images remain valid evidence of
unchanged rendered source, explicitly labelled as reused where appropriate. Final
checks, build, complete unit/browser suites and final-head CI are reported separately.

Accepted-source lint: **71 errors → 0** through only the two approved comments.
Warnings: **31 → 37**, with all 31 baseline warnings unchanged. Meeting recap adds
five specificity diagnostics (`caption b`, two `.open-section`, two `.opens`) and
one mobile `.num` spacing `!important` warning. The caption and facts selectors
address different elements; scoped meeting-grid rules intentionally outrank generic
section/list fallbacks. The `!important` priority appears unnecessary in the current
stylesheet, but no rendering/accessibility defect was observed. Accepted CSS is
preserved rather than rewritten merely to quiet diagnostics; no warnings suppressed.

[Final integrated review and source-bound evidence](https://anacreon.ai/downloads/aa-template-revamp-1788686289312/integrated-batch02/final/index.html)
links to the immutable earlier approval/candidate evidence and separates fresh tests
from unchanged-source reuse. This PR is **not merged or deployed** pending internal
integrated review. No runtime, dependencies, schema, billing, sandbox, launch,
credentials or infrastructure change is included.

A separate **test-fixture-only** correction was necessary for reliable full-suite
validation: the existing returning-reader analytics test used real time plus one
hour while promising the same UTC day. It fails on unchanged main after 23:00 UTC,
when the production privacy salt correctly rotates. This one test now fixes
`Date.now()` at noon using Vitest's automatically restored spy. Its assertions,
tomorrow/rotation coverage and all production analytics code remain unchanged.
The unchanged-base failure and corrected fourteen-test pass are recorded in the
review; no runtime clock, customer data, analytics behavior or financial change.

## Accepted technical templates — Astra integration

Adopts the parent's accepted Batch04 compositions: Changelog / Release Ledger, Migration guide /
Conversion Workbench, and Runbook / Operator's Bench. gpt-6-astra is the sole integrator. The
immutable acceptance bundle is
`aa-template-revamp-1788686289312/batch-04-technical/bundle.json` (SHA-256
`bd219cc78d9f71c984ed4c49a1744a8c55d25d0213c5a934ecf4e85227b7c886`).
Integration evidence is published under
`https://anacreon.ai/downloads/aa-template-revamp-1788686289312/integrated-batch04/`.

Changelog and Migration guide are exact accepted files, including CSS and reader-facing titles.
Runbook has precisely one authorized copy correction: “Only once the check below has been clean
for five minutes.” becomes “Only once the verification check has been clean for five minutes.”
The complete Verify block stays between the four-step ordered list and the list starting at5.
Every other byte is unchanged. No sample commands are executed; no production instructions,
credentials, customer records or financial behavior are modified by these inert examples.

Canonical SHA-256:
- Changelog: `77ff080efe080fc40813e626c7e8d217bd9d5e31d25b7fdeec8e539ef9bda124`
- Migration guide: `f903fe929606e0538cd66a5ca3f316055a5b17edd808f3b6d2c66bc0431d8606`
- Runbook: `64f9d4322e821044456be0a4ebd798339a9eb52d1ef16982759eba6995c965c7`
  (accepted `bc6270a80eb633b43f5e48afb65800563f76b3c6e19364cde3906d50547633cc`
  plus the one sentence above).

All262 original text nodes,147 numeric occurrences and49 keyed record groups are compared with
only that explicit expected sentence change. The11 original pre blocks and every command/output
descendant remain exact; no SVG or meter exists in this batch. The existing Changelog patch-count
mismatch and Migration guide documentation link are preserved, not “corrected” by inventing facts.
Historical preview comments remain as acceptance provenance, not an indication that canonical files
are unapproved. There is no document-height cap.

The unchanged thumbnail generator uses1280px for Changelog and Migration guide, showing the version
slab/breaking actions and actual code conversion pairs. Runbook uses1920px so its whole precondition
rail, Stop panel and opening command/output records enter the crop; the explicit trade-off is smaller
text and wider gutters at gallery scale. All output remains1000×625. Descriptions match these actual
compositions. Other template sources, PNGs and catalog fields remain untouched.

Native sections name locally scrolling code, with no explicit role/tabindex or lint suppression.
Chromium keyboard tests exercise native region focus, ArrowRight panning, Enter disclosures, and
footer reachability inside the real app sandbox. Cross-engine auto-focus and screen-reader
navigation are not certified. Unit tests protect the Runbook order/copy and original pre descendants,
including negative controls; e2e coverage runs through the existing seven viewport projects.

Lint has zero errors.40warnings comprise30 unchanged outside this batch and10 in the accepted
Runbook CSS, replacing7 legacy Runbook warnings: seven descending-specificity diagnostics plus
three new important-style diagnostics. The three local note-margin overrides preserve the selected
base/tablet/mobile caution spacing, including the existing inline Verify note margin. They are
inventoried rather than suppressed or “fixed” by changing approved CSS. No global configuration,
runtime, schema, billing, dependencies, sandbox or launch settings change.

## Accepted final editorial templates — Astra integration

Adopts the accepted Astra Daily Digest newspaper, Interview Notes quote spread, Case Study evidence
ledger and Launch Announcement dark/light poster. The immutable original batch is
`aa-template-revamp-1788686289312/batch-01-editorial/`; rejected inherited-Sol material is not adopted.
The first fifteen redesigned templates remain unchanged. This is a separate final integration PR,
not deployment authorization; all nineteen are only live after the later reviewed rollout.

Daily and Interview are exact accepted source files. Case adds one first-line, file-local
`noRedundantRoles` compatibility directive. Launch adds one **element-local** `useSemanticElements`
directive immediately before its existing named CODE region. Nothing else in any template changes:
CSS, titles, body elements, roles, scopes, IDs, links, SVG, meters and command descendants are exact.
Canonical SHA-256:
- Daily: `500f1619164f01ec4aa19a6c1e00277696b50cf3a711463800b22f128a010129`
- Interview: `146ebab1a80f985196bf788ad5d7ab4fc564dec5c72ec0c4f7b9df154a2a9691`
- Case: `bda5f8984424f791f6707dc0565c198a6607fcd98f41d851eaed001e2151b007`
- Launch: `c50f7b44e6e2193126e085fa2b3d3b89266d5dfbb5760dd11633de51fd26fa19`

Case's explicit inventory is one table, seven rows, four columnheaders and twenty-one cells. Four
native `th scope="col"` headers continue to associate by column with five complete value/meter rows;
the footer cell spans four columns. The exception is bounded by regression assertions, not permission
for future unrelated roles. [MDN's display accessibility note](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/display#tables)
warns that changing table display can affect accessibility in some browsers. Launch preserves its
one named CODE scrolling region and native Chromium keyboard behavior. No other rule suppression or
global configuration change is authorized. Eight paired sandbox PNGs/accessibility trees and native
relationships match the accepted candidates; Chromium evidence does not certify Safari/Firefox or
screen-reader navigation.

Original content parity accounts for307 text nodes,303 retained after four already-approved decorative
quote-mark removals in Interview, and170 numeric occurrences. All substantive text and keyed story,
quote, ledger, feature and availability records remain; code/SVG/meter/link data are exact. No factual
correction is invented for Case's existing baseline-period wording. Integration adds no content delta.
Canonical thumbnails use the unchanged generator: Daily1600, Interview1440, Case1280, Launch1440.
Descriptions name the actual compositions; no other PNG or catalog contract changes.

### Explicitly approved viewer runtime exception

The required twelve-story Daily fixture exposed the existing12000px auto-height ceiling through the
real locally published artifact viewer, reporter and opaque sandbox. At390px it measures11456px
closed and12316px with the six-item archive open; at320px,13757px and14745px. Previously the outer frame
stopped at12000px (all content remained reachable through nested scrolling). The template is not
shortened or redesigned to conceal this runtime limit.

Only `src/ui/client/viewer.js` changes: `FRAME_MAX_HEIGHT`12000→32768 and its explanatory comment,
retiring obsolete approximately3000px template-budget advice. Exact approved source SHA-256:
`43142918625f52d55ac08c0659dcc3eb05e286cf4637199636ac33e391bc1cd4`. This is a bounded operating choice
with headroom above the14745px fixture, **not** a universal maximum, future-proof promise or browser
resource-safety proof; the previous test's permissive40000 upper bound is not its justification.
Matched sender, message type, finite/positive checks, rounding,48px floor and nested-scroll fallback
remain unchanged. No reporter, CSP, origin, sandbox permissions, dependencies or external assets change.

Regression tests use the actual built repository asset, never a substituted green candidate. The
Daily open/close test fails before at320/390 and passes afterward, with all twelve stories, six archive
entries, reachable footer and stable closed/open/closed sizes. The unit test now asserts32768 exactly.
Existing nine guard controls remain; added at/just-above boundary and real65536px synthetic content
prove clamping plus usable keyboard/nested scrolling. Ordinary80→160→24px content tests resizing and
the48px floor. A separate fresh two-origin cloud-mode proof checks byte-exact served viewer asset,
real published fixture source, both phone widths and settled message counts. No production fixtures.

Lint:34 errors→0 via only the two comments.41warnings comprise40 exact prior warnings and one Case
mobile `.l-chg display:grid!important` override that preserves the selected grid against generic cell
`display:block`. It is inventoried, not rewritten merely to quiet warnings. New unit assertions cover
the two bounded exceptions; browser tests protect native associations, exact data-meter rows, Launch
keyboard scrolling and the real viewer. Existing tests/frameworks are extended, not replaced.

[Final integrated review](https://anacreon.ai/downloads/aa-template-revamp-1788686289312/integrated-batch01/final/index.html)
separates fresh final checks, applied-asset viewer proof and final sandbox checks from reused,
unchanged-source16main/48boundary/no-JS/growth/contrast/fallback evidence. Private fixture databases,
authentication, logs and backup material are excluded. No analytics, customer/financial data,
launch, billing, schema, infrastructure or unrelated runtime behavior changes.

## Limited customer UI approval: artifact detail and template library

The user rejected broad admin redesign adoption. This change adopts only the artifact-detail **arrangement**, keeping the current product shell, type, palette, red Sparkline and StatCard/Audience implementations. The document/sharing pair uses a scoped 2:1 layout at the existing 760px breakpoint and stacks in DOM order below it; native focusable anchors lead to Document, Sharing, Audience, History and Save as template. Real forms, confirmation dialogs, preview security and domain behavior are unchanged.

Only the authenticated `/dashboard/templates` cards are simplified to image, linked title and tags. The separate public catalog renderer is unchanged. Stored/API/preview descriptions and all 20 canonical template/source/thumbnail options are untouched. The redundant Preview button is removed, not the preview action: the existing stretched title link opens it from the whole card.

Library navigation uses native links, styled as tabs, with `library=mine|builtin` and `aria-current=page`; Tab/Enter, reload, back and no-JavaScript navigation work without a new client script. Built-in remains the default because it was the first group before this change, including for accounts with personal templates. Legacy preview URLs select the preview's library; explicit mismatched library/preview pairs show only the chosen library, not a confusing cross-library preview. Successful promotion's existing notice selects My templates. Preview/close preserve the library; switching library clears preview. There was no template-list filter or pagination to replace.

Scoped integration red controls fail on the previous source for missing detail groups, missing library selection and visible card descriptions. Existing assertions move to the explicit personal destination / new query-preserving preview URLs. Browser regressions exercise the existing seven responsive projects, real sandboxed owner preview and JavaScript-disabled library navigation. The style guide documents these two targeted patterns using current primitives; no global redesign, dependency, schema, provider or launch-flag change is included.

Homepage activation is separately authorized after this UI rollout is verified: existing `AA_COMING_SOON=false` selects the already-built HomePage. This PR does not merge/deploy or change that runtime flag. Existing production deployment and rollback safeguards remain required.

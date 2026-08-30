import type { Context } from 'hono';
import { renderToString } from 'hono/jsx/dom/server';
import type { AppConfig } from '../config.js';
import { renderMarkdown } from '../lib/markdown.js';
import { SkillPage } from '../ui/pages/skill.js';

/**
 * `/skill.md` has two audiences on one URL. An agent reads it as a contract, and a human reaches it
 * by clicking "Agent Skill" in the footer. Serving markdown unconditionally meant the human got a
 * wall of raw source in the browser.
 *
 * The split is by `Accept`, the same negotiation the global error handler uses. The markdown branch
 * is unchanged and must stay byte-identical: it is the contract surface, and a test pins it.
 */
export function skillResponse(context: Context, config: AppConfig): Response {
  if (prefersHtml(context)) {
    context.header('Content-Type', 'text/html; charset=utf-8');
    context.header('Cache-Control', 'public, max-age=3600');
    return context.body(skillHtml(config));
  }

  context.header('Content-Type', 'text/markdown; charset=utf-8');
  context.header('Cache-Control', 'public, max-age=3600');
  return context.body(skillText(config));
}

function prefersHtml(context: Context): boolean {
  return (context.req.header('accept') ?? '')
    .split(',')
    .some((part) => part.trim().toLowerCase().startsWith('text/html'));
}

/**
 * The same skill text, rendered through the artifact markdown pipeline and put in product chrome.
 * Deriving it from `skillText` rather than duplicating the copy is the point: there is one source,
 * and the human page cannot drift from what agents are told.
 */
export function skillHtml(config: AppConfig): string {
  return renderToString(
    SkillPage({ baseUrl: config.baseUrl, html: renderMarkdown(skillText(config)) })
  );
}

export function skillText(config: AppConfig): string {
  const apiBase = `${config.baseUrl}/v1`;
  const appBase = config.baseUrl;

  return `# Agent Artifacts Skill

## DESCRIPTION

Use this when an agent needs to publish work as a clean, versioned, shareable web page.

Agent Artifacts accepts markdown or HTML over HTTP. A stable slug gives the artifact a stable URL. Posting the same slug again updates the artifact, creates a new version, and keeps the public share link in place.

## INSTRUCTIONS

Base URL: ${apiBase}

Read the live contract when available:

- GET ${apiBase}/contract
- GET ${apiBase}/openapi.json

Authenticate API requests with this exact header:

Authorization: Bearer aa_bot_YOUR_KEY

All request bodies are JSON with snake_case fields. Content can be markdown or HTML. The content limit is 2 MB per artifact.

### Create an artifact

POST /v1/artifacts creates an artifact. **It is PRIVATE.** You get a URL back, and only you — signed in to your dashboard — can open it; anyone else gets "not found". Publishing is a second, deliberate call (see "Publishing" below). \`share\` and \`password\` sent here are accepted and ignored, and the response says so in \`share.ignored_request\`.

\`\`\`bash
curl -X POST ${apiBase}/artifacts \\
  -H "Authorization: Bearer aa_bot_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "slug": "weekly-ops",
    "type": "markdown",
    "title": "Weekly Ops",
    "content": "# Weekly Ops\\n\\nThe agent finished the work.",
    "change_summary": "First publish"
  }'
\`\`\`

The response includes \`id\`, \`slug\`, \`version_num\`, \`content\`, and \`share\`. The URL is at \`share.url\` and \`share.visibility\` says who can open it — \`private\` until you publish. It looks like:

\`\`\`text
${appBase}/a/<share_id>
\`\`\`

### Update the same artifact and keep the link stable

Use the same slug again. This is an upsert. The artifact gets a new version and the share URL stays stable.

\`\`\`bash
curl -X POST ${apiBase}/artifacts \\
  -H "Authorization: Bearer aa_bot_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "slug": "weekly-ops",
    "type": "markdown",
    "title": "Weekly Ops",
    "content": "# Weekly Ops\\n\\nUpdated numbers and next steps.",
    "change_summary": "Updated numbers"
  }'
\`\`\`

Send \`share.url\` to the human once you have published it. The URL is stable — publishing does not change it — so re-publishing the same slug keeps the same link.

### Read artifacts

- GET /v1/artifacts lists artifacts.
- GET /v1/artifacts/:id_or_slug returns one artifact with full content and share state.

Use either the artifact id or its slug for \`:id_or_slug\`.

### Update with PUT

PUT /v1/artifacts/:id_or_slug updates an existing artifact. Content changes create a new version.

Accepted fields are \`title\`, \`content\`, \`type\`, \`slug\`, \`metadata\`, and \`change_summary\`.

### Versions

- GET /v1/artifacts/:id_or_slug/versions lists versions.
- GET /v1/artifacts/:id_or_slug/versions/:n returns one version.
- POST /v1/artifacts/:id_or_slug/versions/:n/restore restores that version and creates a new current version.

Restore body:

\`\`\`json
{
  "change_summary": "Restored the approved draft"
}
\`\`\`

### Publishing

An artifact is \`private\` (only you, signed in), \`public\` (anyone with the link), or \`password\`. It starts private, always. A private artifact answers "not found" to everyone else on every surface — page, content, download and social card — so it has no link preview until you publish it.

Publish it:

\`\`\`bash
curl -X POST ${apiBase}/artifacts/weekly-ops/share \\
  -H "Authorization: Bearer aa_bot_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{}'
\`\`\`

Create or update a password protected share:

\`\`\`bash
curl -X POST ${apiBase}/artifacts/weekly-ops/share \\
  -H "Authorization: Bearer aa_bot_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"password":"s3cret"}'
\`\`\`

Change or remove the password:

- PATCH /v1/artifacts/:id_or_slug/share with \`{"password":"new-password"}\`
- PATCH /v1/artifacts/:id_or_slug/share with \`{"password":null}\`

Unpublish, or burn the link — two different things:

- DELETE /v1/artifacts/:id_or_slug/share — back to private. The URL survives, so publishing again makes the SAME link live. Use this when you published too early.
- POST /v1/artifacts/:id_or_slug/share/revoke — the URL is dead (410) forever and publishing later mints a new one. Use this when a link has leaked.

### Download

GET /v1/artifacts/:id_or_slug/download returns the raw \`.md\` or \`.html\` content.

### Templates

A template is a reusable example artifact — markdown or HTML — you rehash into new work: keep its style and structure, publish fresh content in it.

- GET /v1/templates lists the examples available to you.
- GET /v1/templates/:slug returns one, with its content and any slots it declares.
- POST /v1/templates creates an account template from an existing markdown or HTML artifact. \`{{slot_name}}\` markers are optional; a template with no slots is an example you copy and rewrite.
- DELETE /v1/templates/:slug deletes one of your own account templates. Built-in slugs are reserved: you cannot create a template that shadows one (409 slug_conflict) and you cannot delete one (403 built_in_template).

Create template body:

\`\`\`json
{
  "artifact_id": "art_abcdefghijklmnopqrstu",
  "name": "Ops Brief",
  "slug": "ops-brief",
  "description": "Reusable ops brief"
}
\`\`\`

Publish with a template by sending \`template\` instead of \`type\` and \`content\`; include \`slots\` only when the template declares them. When it declares none, fetch it, rewrite its content in your own words, and publish the result as an ordinary artifact.

### Habits

Use one stable slug per living document. Always send \`change_summary\`. Create first and publish deliberately — an artifact is private until you call POST /share, and it is worth asking your human before you make their document public. Add a password when the link contains sensitive content. Stop if the API returns 401 because the key is missing, invalid, or revoked.
`;
}

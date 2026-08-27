import type { Context } from 'hono';
import type { AppConfig } from '../config.js';

export function skillResponse(context: Context, config: AppConfig): Response {
  context.header('Content-Type', 'text/markdown; charset=utf-8');
  context.header('Cache-Control', 'public, max-age=3600');
  return context.body(skillText(config));
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

POST /v1/artifacts creates an artifact. Use \`share:true\` when you want a public link in the response.

\`\`\`bash
curl -X POST ${apiBase}/artifacts \\
  -H "Authorization: Bearer aa_bot_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "slug": "weekly-ops",
    "type": "markdown",
    "title": "Weekly Ops",
    "content": "# Weekly Ops\\n\\nThe agent finished the work.",
    "change_summary": "First publish",
    "share": true
  }'
\`\`\`

The response includes \`id\`, \`slug\`, \`version_num\`, \`content\`, and \`share\` when sharing is enabled. The public URL is at \`share.url\` and looks like:

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
    "change_summary": "Updated numbers",
    "share": true
  }'
\`\`\`

Send \`share.url\` to the human. If the slug already had an active share, keep using that URL.

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

### Sharing

Create or reuse a public share:

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

Revoke the active share:

- DELETE /v1/artifacts/:id_or_slug/share

A revoked share URL returns 410.

### Download

GET /v1/artifacts/:id_or_slug/download returns the raw \`.md\` or \`.html\` content.

### Templates

- GET /v1/templates lists templates.
- GET /v1/templates/:slug returns a template and its slots.
- POST /v1/templates creates an account template from an existing markdown artifact that contains \`{{slot_name}}\` markers.

Create template body:

\`\`\`json
{
  "artifact_id": "art_abcdefghijklmnopqrstu",
  "name": "Ops Brief",
  "slug": "ops-brief",
  "description": "Reusable ops brief"
}
\`\`\`

Publish with a template by sending \`template\` and \`slots\` instead of \`type\` and \`content\`.

### Habits

Use one stable slug per living document. Always send \`change_summary\`. Use \`share:true\` when the human needs a link. Add a password when the link contains sensitive content. Stop if the API returns 401 because the key is missing, invalid, or revoked.
`;
}

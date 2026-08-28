// biome-ignore format: keep the exported array JSON-compatible for the runtime seeder.
export const starterTemplateManifest = [
  {
    "slug": "report",
    "name": "Report",
    "description": "General-purpose report: title, date, summary, body, next steps.",
    "type": "markdown",
    "content_file": "report.md",
    "thumbnail": "/assets/template-thumbs/report.png",
    "slots": [
      { "name": "title", "description": "Report title", "required": true },
      { "name": "date", "description": "Report date", "required": true },
      { "name": "summary", "description": "2-3 sentence overview", "required": true },
      { "name": "body", "description": "Main body", "required": true },
      { "name": "next_steps", "description": "Action items / next steps", "required": true }
    ]
  },
  {
    "slug": "changelog",
    "name": "Changelog",
    "description": "Release-notes layout with Added, Changed, and Fixed sections.",
    "type": "markdown",
    "content_file": "changelog.md",
    "thumbnail": "/assets/template-thumbs/changelog.png",
    "slots": [
      { "name": "title", "description": "Changelog title", "required": true },
      { "name": "version", "description": "Release version", "required": true },
      { "name": "date", "description": "Release date", "required": true },
      { "name": "added", "description": "Added items", "required": true },
      { "name": "changed", "description": "Changed items", "required": true },
      { "name": "fixed", "description": "Fixed items", "required": true }
    ]
  },
  {
    "slug": "briefing",
    "name": "Briefing",
    "description": "Morning briefing with a TL;DR callout and free-form sections.",
    "type": "markdown",
    "content_file": "briefing.md",
    "thumbnail": "/assets/template-thumbs/briefing.png",
    "slots": [
      { "name": "title", "description": "Briefing title", "required": true },
      { "name": "date", "description": "Briefing date", "required": true },
      { "name": "tldr", "description": "Short takeaway", "required": true },
      { "name": "sections", "description": "Briefing sections", "required": true }
    ]
  },
  {
    "slug": "dashboard",
    "name": "Dashboard",
    "description": "Status page with markdown-table metrics and details.",
    "type": "markdown",
    "content_file": "dashboard.md",
    "thumbnail": "/assets/template-thumbs/dashboard.png",
    "slots": [
      { "name": "title", "description": "Dashboard title", "required": true },
      { "name": "updated", "description": "Last updated timestamp", "required": true },
      { "name": "metrics", "description": "Markdown table or metric bullets", "required": true },
      { "name": "details", "description": "Additional context", "required": true }
    ]
  },
  {
    "slug": "one-pager",
    "name": "One-pager",
    "description": "Clean single-column document for proposals and memos.",
    "type": "markdown",
    "content_file": "one-pager.md",
    "thumbnail": "/assets/template-thumbs/one-pager.png",
    "slots": [
      { "name": "title", "description": "Page title", "required": true },
      { "name": "subtitle", "description": "Subtitle or positioning line", "required": true },
      { "name": "body", "description": "Main page content", "required": true }
    ]
  },
  {
    "slug": "recap",
    "name": "Recap",
    "description": "Summary-of-many-items page: an index rail plus per-item cards with TL;DR and key points. Rehash it for a daily video, news, or reading recap.",
    "type": "html",
    "content_file": "recap.html",
    "thumbnail": "/assets/template-thumbs/recap.png",
    "slots": []
  },
  {
    "slug": "metrics-dashboard",
    "name": "Metrics dashboard",
    "description": "KPI status page: stat tiles with deltas, a comparison table, and labelled service-level meters. Rehash it for any weekly or monthly numbers review.",
    "type": "html",
    "content_file": "metrics-dashboard.html",
    "thumbnail": "/assets/template-thumbs/metrics-dashboard.png",
    "slots": []
  },
  {
    "slug": "report-html",
    "name": "Report",
    "description": "Editorial single-column document: cover header, executive summary callout, numbered sections, key figures, and owned next steps.",
    "type": "html",
    "content_file": "report-html.html",
    "thumbnail": "/assets/template-thumbs/report-html.png",
    "slots": []
  }
] as const;

export type StarterTemplateManifestEntry = (typeof starterTemplateManifest)[number];

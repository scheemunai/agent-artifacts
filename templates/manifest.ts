// biome-ignore format: keep the exported array JSON-compatible for the runtime seeder.
export const starterTemplateManifest = [
    {
      "slug": "daily-digest",
      "category": "meetings",
      "name": "Daily digest",
      "description": "Many items condensed with an index rail: a jump index and today's themes on the left, per-item cards with a TL;DR on the right, and the long tail collapsed to one line each.",
      "type": "html",
      "content_file": "daily-digest.html",
      "thumbnail": "/assets/template-thumbs/daily-digest.png",
      "slots": []
    },
    {
      "slug": "interview-notes",
      "category": "meetings",
      "name": "Interview notes",
      "description": "One conversation, quotes-led. Who they are, what they said in a timestamped pull quote, and your reading kept visibly separate. For user research and hiring debriefs.",
      "type": "html",
      "content_file": "interview-notes.html",
      "thumbnail": "/assets/template-thumbs/interview-notes.png",
      "slots": []
    },
    {
      "slug": "meeting-recap",
      "category": "meetings",
      "name": "Meeting recap",
      "description": "What was decided, who owes what by when, and what is still open. A numbered decision ledger over an owned action table with per-item status.",
      "type": "html",
      "content_file": "meeting-recap.html",
      "thumbnail": "/assets/template-thumbs/meeting-recap.png",
      "slots": []
    },
    {
      "slug": "decision-brief",
      "category": "decisions",
      "name": "Decision brief",
      "description": "Two to four options scored on identical criteria, a recommendation up front, an honest account of why the alternatives lose, and the ask with a dated deadline.",
      "type": "html",
      "content_file": "decision-brief.html",
      "thumbnail": "/assets/template-thumbs/decision-brief.png",
      "slots": []
    },
    {
      "slug": "one-pager",
      "category": "decisions",
      "name": "One-pager",
      "description": "Clean single-column document for proposals and memos.",
      "type": "markdown",
      "content_file": "one-pager.md",
      "thumbnail": "/assets/template-thumbs/one-pager.png",
      "slots": [
        {
          "name": "title",
          "description": "Page title",
          "required": true
        },
        {
          "name": "subtitle",
          "description": "Subtitle or positioning line",
          "required": true
        },
        {
          "name": "body",
          "description": "Main page content",
          "required": true
        }
      ]
    },
    {
      "slug": "proposal",
      "category": "decisions",
      "name": "Proposal",
      "description": "A single argument, led by the number that carries it: the problem, what you propose, what it costs, what it buys, and the decision you are asking for.",
      "type": "html",
      "content_file": "proposal.html",
      "thumbnail": "/assets/template-thumbs/proposal.png",
      "slots": []
    },
    {
      "slug": "spec",
      "category": "decisions",
      "name": "Spec",
      "description": "Goals and non-goals side by side, numbered requirements you can cite in review, and the open questions stated rather than buried.",
      "type": "html",
      "content_file": "spec.html",
      "thumbnail": "/assets/template-thumbs/spec.png",
      "slots": []
    },
    {
      "slug": "report",
      "category": "research",
      "name": "Report",
      "description": "General-purpose report: title, date, summary, body, next steps.",
      "type": "markdown",
      "content_file": "report.md",
      "thumbnail": "/assets/template-thumbs/report.png",
      "slots": [
        {
          "name": "title",
          "description": "Report title",
          "required": true
        },
        {
          "name": "date",
          "description": "Report date",
          "required": true
        },
        {
          "name": "summary",
          "description": "2-3 sentence overview",
          "required": true
        },
        {
          "name": "body",
          "description": "Main body",
          "required": true
        },
        {
          "name": "next_steps",
          "description": "Action items / next steps",
          "required": true
        }
      ]
    },
    {
      "slug": "report-html",
      "category": "research",
      "name": "Executive report",
      "description": "Editorial single-column document: cover header, executive summary callout, numbered sections, key figures, and owned next steps.",
      "type": "html",
      "content_file": "report-html.html",
      "thumbnail": "/assets/template-thumbs/report-html.png",
      "slots": []
    },
    {
      "slug": "dashboard",
      "category": "status",
      "name": "Dashboard",
      "description": "Status page with markdown-table metrics and details.",
      "type": "markdown",
      "content_file": "dashboard.md",
      "thumbnail": "/assets/template-thumbs/dashboard.png",
      "slots": [
        {
          "name": "title",
          "description": "Dashboard title",
          "required": true
        },
        {
          "name": "updated",
          "description": "Last updated timestamp",
          "required": true
        },
        {
          "name": "metrics",
          "description": "Markdown table or metric bullets",
          "required": true
        },
        {
          "name": "details",
          "description": "Additional context",
          "required": true
        }
      ]
    },
    {
      "slug": "metrics-dashboard",
      "category": "status",
      "name": "Metrics dashboard",
      "description": "KPI status page: stat tiles with deltas, a comparison table, and labelled service-level meters. Rehash it for any weekly or monthly numbers review.",
      "type": "html",
      "content_file": "metrics-dashboard.html",
      "thumbnail": "/assets/template-thumbs/metrics-dashboard.png",
      "slots": []
    },
    {
      "slug": "changelog",
      "category": "releases",
      "name": "Changelog",
      "description": "Release-notes layout with Added, Changed, and Fixed sections.",
      "type": "markdown",
      "content_file": "changelog.md",
      "thumbnail": "/assets/template-thumbs/changelog.png",
      "slots": [
        {
          "name": "title",
          "description": "Changelog title",
          "required": true
        },
        {
          "name": "version",
          "description": "Release version",
          "required": true
        },
        {
          "name": "date",
          "description": "Release date",
          "required": true
        },
        {
          "name": "added",
          "description": "Added items",
          "required": true
        },
        {
          "name": "changed",
          "description": "Changed items",
          "required": true
        },
        {
          "name": "fixed",
          "description": "Fixed items",
          "required": true
        }
      ]
    }
  ] as const;

export type StarterTemplateManifestEntry = (typeof starterTemplateManifest)[number];

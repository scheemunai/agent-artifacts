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
        "description": "A PRD that opens on scope itself — what the release does, beside what it deliberately does not — then numbered requirements each carrying a priority and an acceptance line, and the open questions still blocking the build.",
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
        "description": "Release notes as a reading document: breaking changes hoisted above the fold, versions set in the margin, entries tagged Added / Changed / Fixed / Removed, and older releases collapsed behind one line. Rehash it for any product's release history.",
        "type": "html",
        "content_file": "changelog.html",
        "thumbnail": "/assets/template-thumbs/changelog.png",
        "slots": []
      },
      {
        "slug": "launch-announcement",
        "category": "releases",
        "name": "Launch announcement",
        "description": "The friendly end of the releases family: an inverted black masthead with the headline claim and the facts strip, one lead feature with a diagram, two supporting ones, beta numbers, three steps to try it, and a plain-spoken availability table.",
        "type": "html",
        "content_file": "launch-announcement.html",
        "thumbnail": "/assets/template-thumbs/launch-announcement.png",
        "slots": []
      },
      {
        "slug": "migration-guide",
        "category": "releases",
        "name": "Migration guide",
        "description": "A version-to-version upgrade guide built around before/after code pairs: a dated deadline callout, an effort strip, every breaking change shown as old code beside new code, a three-command upgrade path with real terminal output, and a collapsed troubleshooting list.",
        "type": "html",
        "content_file": "migration-guide.html",
        "thumbnail": "/assets/template-thumbs/migration-guide.png",
        "slots": []
      },
      {
        "slug": "checklist",
        "category": "plans",
        "name": "Checklist",
        "description": "A readiness review that leads with what is still in the way: the blocking count as the hero number, a segmented meter of every item reviewed, the blockers in full with owner and date, everything cleared listed by area, and the waivers with who signed them and when they come back.",
        "type": "html",
        "content_file": "checklist.html",
        "thumbnail": "/assets/template-thumbs/checklist.png",
        "slots": []
      },
      {
        "slug": "project-plan",
        "category": "plans",
        "name": "Project plan",
        "description": "Phases, owners, dates and dependencies on one page: a seventeen-week rail with a today line and a part-filled bar for the phase in flight, a phase card per stage with its deliverables and exit criterion, what the plan depends on other teams for, and the risks with mitigations.",
        "type": "html",
        "content_file": "project-plan.html",
        "thumbnail": "/assets/template-thumbs/project-plan.png",
        "slots": []
      },
      {
        "slug": "runbook",
        "category": "plans",
        "name": "Runbook",
        "description": "A procedure somebody follows at 3am: preconditions as runnable checks with a stop rule, five numbered steps each with the command and its real output, a verification gate placed between the two steps that matter, a rollback with its safe window stated, and the two conditions that mean escalate.",
        "type": "html",
        "content_file": "runbook.html",
        "thumbnail": "/assets/template-thumbs/runbook.png",
        "slots": []
      }
    ] as const;

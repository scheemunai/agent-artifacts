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
        "description": "A working meeting handover: six owned actions lead beside complete decision minutes, with compact outcome counts, explicit deferrals and open questions that keep their owners and deadlines.",
        "type": "html",
        "content_file": "meeting-recap.html",
        "thumbnail": "/assets/template-thumbs/meeting-recap.png",
        "slots": [],
        "thumbnail_viewport": 1600
      },
      {
        "slug": "decision-brief",
        "category": "decisions",
        "name": "Decision brief",
        "description": "An evidence-first option bench: a compact recommendation above the full five-criterion comparison, the selected option marked in words, then rejected alternatives, explicit asks and the decision deadline.",
        "type": "html",
        "content_file": "decision-brief.html",
        "thumbnail": "/assets/template-thumbs/decision-brief.png",
        "slots": [],
        "thumbnail_viewport": 1600
      },
      {
        "slug": "one-pager",
        "category": "decisions",
        "name": "One-pager",
        "description": "The markdown starter, and the only built-in that takes slots: send `template` plus `title`, `subtitle` and `body` and the server merges them. Deliberately plain — it is a form to fill, not a page to rewrite.",
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
        "description": "A single argument with the dated decision first, then the problem, cost, payoff, trade-off and evidence in a numbered decision spine.",
        "type": "html",
        "content_file": "proposal.html",
        "thumbnail": "/assets/template-thumbs/proposal.png",
        "slots": [],
        "thumbnail_viewport": 1280
      },
      {
        "slug": "spec",
        "category": "decisions",
        "name": "Spec",
        "description": "A technical requirements folio: in-and-out scope, ruled ID and priority records pairing each requirement with its acceptance clause, then blocking questions with their owners and timings.",
        "type": "html",
        "content_file": "spec.html",
        "thumbnail": "/assets/template-thumbs/spec.png",
        "slots": [],
        "thumbnail_viewport": 1440
      },
      {
        "slug": "case-study",
        "category": "research",
        "name": "Case Study",
        "description": "A customer outcome told with the customer's own numbers: one display figure and what it is measured against, a before-and-after ledger with magnitude bars, the situation that caused it, an honest account of what the change cost, and quotes from the people who lived it.",
        "type": "html",
        "content_file": "case-study.html",
        "thumbnail": "/assets/template-thumbs/case-study.png",
        "slots": []
      },
      {
        "slug": "postmortem",
        "category": "research",
        "name": "Incident Postmortem",
        "description": "A blameless incident atlas: impact accounting beside the failure trace, a time-indexed incident record, the complete root cause and contributing factors, then owned action items with due dates and states.",
        "type": "html",
        "content_file": "postmortem.html",
        "thumbnail": "/assets/template-thumbs/postmortem.png",
        "slots": [],
        "thumbnail_viewport": 1280
      },
      {
        "slug": "report",
        "category": "research",
        "name": "Report",
        "description": "The serious long document: an editorial masthead followed by a briefing band that puts the finding beside its recommendation and quarter evidence, then numbered sections with a ranked magnitude figure, a customer quote, and owned next steps with dates.",
        "type": "html",
        "content_file": "report.html",
        "thumbnail": "/assets/template-thumbs/report.png",
        "thumbnail_viewport": 1280,
        "slots": []
      },
      {
        "slug": "research-brief",
        "category": "research",
        "name": "Research Brief",
        "description": "An evidence register: the question and answer qualified immediately by confidence and method, five claims beside their provenance, a grouped source register, and the conditions and unknowns that could change the answer.",
        "type": "html",
        "content_file": "research-brief.html",
        "thumbnail": "/assets/template-thumbs/research-brief.png",
        "slots": [],
        "thumbnail_viewport": 1440
      },
      {
        "slug": "metrics-dashboard",
        "category": "status",
        "name": "Metrics Dashboard",
        "description": "A recurring performance sheet: a broad twelve-week trend beside a compact metric ledger, change commentary directly below, then a channel breakdown and service levels metered against their targets.",
        "type": "html",
        "content_file": "metrics-dashboard.html",
        "thumbnail": "/assets/template-thumbs/metrics-dashboard.png",
        "slots": [],
        "thumbnail_viewport": 1280
      },
      {
        "slug": "project-status",
        "category": "status",
        "name": "Project Status",
        "description": "A decisions-first sponsor dispatch: the changed verdict beside two owned, dated asks, followed by committed milestones, scope totals, and blockers with their owners, ages and next decisions.",
        "type": "html",
        "content_file": "project-status.html",
        "thumbnail": "/assets/template-thumbs/project-status.png",
        "slots": [],
        "thumbnail_viewport": 1280
      },
      {
        "slug": "service-health",
        "category": "status",
        "name": "Service Health",
        "description": "A reliability review that treats uptime as a budget rather than a state: how much unreliability is left this quarter, a burn-down showing where it went, the incidents ranked by budget consumed rather than by date.",
        "type": "html",
        "content_file": "service-health.html",
        "thumbnail": "/assets/template-thumbs/service-health.png",
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
        "description": "Phases, owners, dates and dependencies on one page: a seventeen-week phase-and-gate ledger with a today line and all four phases, followed by each phase's deliverables and exit criterion, cross-team dependencies, and risks with mitigations.",
        "type": "html",
        "content_file": "project-plan.html",
        "thumbnail": "/assets/template-thumbs/project-plan.png",
        "slots": [],
        "thumbnail_viewport": 1440
      },
      {
        "slug": "runbook",
        "category": "plans",
        "name": "Runbook",
        "description": "A procedure somebody follows at 3am: preconditions as runnable checks with a stop rule, five numbered steps each with the command and its real output, a verification gate placed between the two steps that matter, a rollback with its safe window stated.",
        "type": "html",
        "content_file": "runbook.html",
        "thumbnail": "/assets/template-thumbs/runbook.png",
        "slots": []
      }
    ] as const;

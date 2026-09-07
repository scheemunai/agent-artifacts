// biome-ignore format: keep the exported array JSON-compatible for the runtime seeder.
export const starterTemplateManifest = [
      {
        "slug": "daily-digest",
        "category": "meetings",
        "name": "Daily digest",
        "description": "A newspaper-style daily desk: a complete story index beside four open, ruled articles with relevance, summaries and evidence, followed by a native six-item archive.",
        "type": "html",
        "content_file": "daily-digest.html",
        "thumbnail": "/assets/template-thumbs/daily-digest.png",
        "slots": [],
        "thumbnail_viewport": 1600
      },
      {
        "slug": "interview-notes",
        "category": "meetings",
        "name": "Interview notes",
        "description": "A voice-and-interpretation spread: a broad serif quotation beside the participant identity, then paired verbatim evidence and analyst readings with timed quotes and owned next actions.",
        "type": "html",
        "content_file": "interview-notes.html",
        "thumbnail": "/assets/template-thumbs/interview-notes.png",
        "slots": [],
        "thumbnail_viewport": 1440
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
        "description": "An evidence spread: the customer outcome opposite five before/after metric records, followed by serif customer voices, the operational story and an equally prominent honest-cost section.",
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
        "description": "A release ledger: the latest version and date beside two complete breaking-action records, followed by version, change type and release notes, with a native archive.",
        "type": "html",
        "content_file": "changelog.html",
        "thumbnail": "/assets/template-thumbs/changelog.png",
        "slots": []
      },
      {
        "slug": "launch-announcement",
        "category": "releases",
        "name": "Launch announcement",
        "description": "A dark launch poster pairs the headline and update links with an offline-flow diagram, then shifts to a light beta-evidence strip, open feature rows and a practical trial sequence.",
        "type": "html",
        "content_file": "launch-announcement.html",
        "thumbnail": "/assets/template-thumbs/launch-announcement.png",
        "slots": [],
        "thumbnail_viewport": 1440
      },
      {
        "slug": "migration-guide",
        "category": "releases",
        "name": "Migration guide",
        "description": "A conversion workbench: version and deadline context above paired before/after code, followed by three execution steps with exact commands and output, troubleshooting and support dates.",
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
        "description": "An operator’s bench: static preconditions beside the procedure, labelled command/output records and a complete verification check between steps four and five, followed by rollback and escalation.",
        "type": "html",
        "content_file": "runbook.html",
        "thumbnail": "/assets/template-thumbs/runbook.png",
        "slots": [],
        "thumbnail_viewport": 1920
      }
    ] as const;

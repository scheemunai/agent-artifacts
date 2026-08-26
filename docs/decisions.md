# Agent Artifacts Decisions

Date: 2026-08-26

The PRD §1 customization questions were resolved using the canonical defaults supplied to this executor.

1. Product display name and cloud domain: **Agent Artifacts** at **agentartifact.ai**.
2. Open-source license: **MIT**.
3. Usercontent/sandbox domain: cloud will use a dedicated registrable domain, with `aausercontent.com` first choice and `agentartifact-usercontent.com` second choice; fallback is `usercontent.agentartifact.ai` with host-only cookies. Self-host defaults to same-host sandboxing unless `SANDBOX_ORIGIN` is set.
4. Email delivery adapter: **SMTP** default, with Resend selected when `RESEND_API_KEY` is present.
5. GitHub org/repo default: **ZeroPointRepo/agent-artifacts**; no remote is configured yet per Stage 0 instruction.
6. Footer wording: **Made with ◆ Agent Artifacts**, linked to https://agentartifact.ai; self-host can disable with `AA_HIDE_FOOTER=true`.
7. Starter templates: **report, changelog, briefing, dashboard, one-pager**.
8. Analytics/telemetry: **none in OSS**.
9. Security/abuse contacts: **security@agentartifact.ai** and **abuse@agentartifact.ai**.
10. Cloud free-tier artifact retention: **7 days** from last content update; `null` means permanent.

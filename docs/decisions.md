# Agent Artifacts Decisions

Date: 2026-08-26

The PRD §1 customization questions were resolved using the canonical defaults supplied to this executor.

1. Product display name and cloud domain: **Agent Artifacts** at **agentartifact.ai**.
2. Open-source license: **MIT**.
3. Usercontent/sandbox domain: cloud will use a dedicated registrable domain; fallback during testing is a sibling subdomain such as `usercontent.example.com` with host-only cookies. Self-host defaults to same-host sandboxing unless `SANDBOX_ORIGIN` is set.
4. Email delivery adapter: **SMTP** default, with Resend selected when `RESEND_API_KEY` is present.
5. GitHub org/repo and container image: **not yet published**. The founder still needs to choose the public owner/namespace before launch.
6. Footer wording: **Made with ◆ Agent Artifacts**, linked to https://agentartifact.ai; self-host can disable with `AA_HIDE_FOOTER=true`.
7. Starter templates: **report, changelog, briefing, dashboard, one-pager**.
8. Analytics/telemetry: **none in OSS**.
9. Security/abuse contacts: **security@agentartifact.ai** and **abuse@agentartifact.ai**.
10. Cloud free-tier artifact retention: **7 days** from last content update; `null` means permanent.

## Repository publication status

This section is the source of truth for public repository and image references.

As of 2026-08-27, the public GitHub repository and GHCR image are **not yet published**. Do not present a clone URL, one-click deploy URL, or GHCR image as working until the founder chooses the owner/namespace and the repo/image are live.

Launch placeholders:

- Repository: `https://github.com/<owner>/agent-artifacts`
- Clone URL: `https://github.com/<owner>/agent-artifacts.git`
- Container image: `ghcr.io/<owner>/agent-artifacts:latest`

Until then, docs should say "not yet published" instead of naming an unavailable owner. Deploy buttons are intentionally omitted until they can target a real public repository.

When the owner is decided, update this section first, then update the places that intentionally reference it:

- `README.md` quickstart and deploy section
- `CONTRIBUTING.md` development setup
- `docs/self-hosting.md` Docker Compose walkthrough
- `docs/deploy.md` platform sections
- `docker-compose.yml` only if the default should switch from local build tag to the published GHCR image

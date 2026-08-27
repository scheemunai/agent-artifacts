# Security Policy

Please do not open public GitHub issues for vulnerabilities.

Report privately by either:

1. Opening a GitHub Security Advisory for this repository, or
2. Emailing the address configured by `AA_SECURITY_EMAIL` (default: security@agentartifact.ai).

If your self-host sets a different `AA_SECURITY_EMAIL`, use that instance's published security contact.

## What is in scope

We especially want reports for:

- HTML sandbox escapes: artifact HTML reading cookies, reaching the parent DOM, escaping `sandbox="allow-scripts"`, bypassing frame CSP, or accessing account/API routes.
- Share-password bypasses or token invalidation failures.
- Authentication/session issues, CSRF, magic-link token consumption bugs, or cookie flag problems.
- Bot API key leaks, key-auth bypasses, or cross-account access.
- Stored XSS in markdown, templates, dashboard fields, or OG rendering.
- Rate-limit/cap bypasses that enable abuse or data exposure.
- Path traversal, arbitrary file access, SSRF, or unsafe dependency behavior.
- Deployment defaults that expose secrets or fail to persist required security state.

Out of scope unless there is a concrete exploit path: generic scanner output, missing cosmetic headers on non-sensitive responses, denial-of-service requiring unrealistic local access, social engineering, spam, and vulnerabilities in a self-host's custom reverse proxy configuration.

## Response expectations

- Acknowledgment target: within 72 hours.
- Triage/update target: within 7 days after acknowledgment.
- Coordinated disclosure window: up to 90 days, shorter when practical.
- Fixes ship as patch releases for supported versions.
- Credit is offered unless you prefer to remain anonymous.

Supported for security fixes: the latest minor release.

## What to include

Please include:

- Affected version or commit SHA.
- Deployment mode: self-hosted or cloud.
- Database mode: SQLite or Postgres.
- Reproduction steps and expected/actual behavior.
- Any proof-of-concept artifact content, request, or curl command.
- Whether the issue is already public or actively exploited.

Do not send real user data, live API keys, passwords, session cookies, or secrets. Redact anything sensitive.

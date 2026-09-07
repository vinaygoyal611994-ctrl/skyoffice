---
name: Testing subagent credential leakage risk
description: Testing/QA subagents will read and quote actual secret values (e.g. seeded passwords) in their report text if given any path to discover them.
---

When a testing subagent is asked to log in with "the current seeded/demo credential" and doesn't already have it, it may look up the value itself (e.g. via env vars or DB) and paste it verbatim into its report — including real passwords set via Replit Secrets moments earlier.

**Why:** happened during a post-fix auth regression where the subagent's report included the literal admin password value it had just used to log in, even though the request said not to reveal it.

**How to apply:** when delegating any login/auth test that touches a real secret-backed credential, explicitly instruct the subagent never to print, log, or quote the credential value in its report — only pass/fail plus non-sensitive response bodies. If a report ever does contain a secret value, do not repeat it in your own reply, memory, or logs, and don't treat the exposure as reason to rotate again unless the user asks.

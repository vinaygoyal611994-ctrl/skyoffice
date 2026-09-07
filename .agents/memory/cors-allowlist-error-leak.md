---
name: CORS rejection needs explicit error handling
description: Express's default error handler leaks a stack trace when a cors() origin callback rejects with an Error, unless you add your own error-handling middleware right after cors().
---

Switching CORS from `origin: true` to an allowlist callback that calls `callback(new Error(...))` for disallowed origins causes Express's default error handler to return a 500 HTML page with a full stack trace (file paths, line numbers) for any blocked cross-origin request.

**Why:** discovered while hardening SkayOffice pilot's CORS config — curl with a disallowed `Origin` header returned a stack trace instead of a clean rejection.

**How to apply:** define a distinct Error subclass for the CORS rejection and add a 4-arg error-handling middleware immediately after `app.use(cors(...))` that catches that specific error type and responds with a plain 403 JSON message (bilingual if the app is bilingual) before it reaches the default handler.

---
name: Moderated public profile freshness
description: Prevent stale public media after admin moderation or owner visibility changes.
---

Public office-profile responses that include moderated or owner-controlled media must use `Cache-Control: no-store`, and the browser request should also use `cache: no-store`. Query refetching by itself does not guarantee the browser or proxy will stop serving a pre-approval snapshot.

**Why:** Works approval and visibility changed correctly in the database and fresh API inspection, but an already-open customer Decision Card retained the old media state across actor/session changes until both HTTP cache boundaries were disabled.

**How to apply:** Use this rule for public profile fields changed by an admin or another session, especially media approval, rejection, and owner visibility toggles. Keep query refetch-on-focus/mount for prompt UI refresh.
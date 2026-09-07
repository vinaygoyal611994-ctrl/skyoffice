---
name: SkayOffice assistant language resolution
description: How the per-office AI assistant decides which language to reply in, and why a hardcoded default broke async replies.
---

## The bug
The assistant had three places computing "which language to reply in", and two of them silently defaulted to `"en"` whenever a request didn't carry an explicit `language` value: the conversation-start route and the send-message route. Worse, the async delayed/outside-hours activation sweep (which runs on a timer, not inside a request) had `language` **hardcoded** to `"en"` with no way to know the customer's actual language at all.

**Why this matters:** the platform's own default interface language is Arabic (`currentLanguage: Language = 'ar'` in the frontend's i18n module), not English. A hardcoded/defaulted-to-English reply is doubly wrong: it ignores the customer's real language *and* contradicts the platform's own default.

## The fix — precedence rule
`assistant_conversations` now has a persisted `language` column (`ar`/`en`, default `ar`). Every language decision follows the same precedence:
1. If the current request explicitly supplies a valid `language` (query param on start, body field on send-message), use it and persist it onto the conversation row.
2. Otherwise, use the conversation's already-persisted `language`.
3. Only for a brand-new conversation with no request-supplied language at all, default to `'ar'` — never `'en'`.

The async sweep has no request to read from, so it *must* read the persisted column — that's the only source of truth once a conversation exists.

**How to apply:** any new code path that generates or triggers an assistant reply (including future notification/summary features) must resolve language via this same precedence, sourced from the conversation row — never assume English, and never invent a fourth default.

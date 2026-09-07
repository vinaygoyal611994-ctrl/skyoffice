---
name: SkayOffice dashboard raw hardcoded Arabic strings
description: The office Dashboard page was built with large blocks of UI copy hardcoded in Arabic entirely outside the t() i18n system, not just key-naming mismatches.
---

## The bug
A prior i18n fix covered only the AI Assistant tab. The user then reported the *entire* Office Dashboard still showed Arabic in English mode. Auditing found `pages/dashboard.tsx` had ~126 raw Arabic-only strings baked directly into JSX and toast calls — status labels/hints, card titles/descriptions, field labels/placeholders, toast titles/descriptions, document type labels, empty states, and a module-level `STATUS_META` object whose renderer always read a `labelAr` field regardless of the active language. This is a different failure class than mismatched i18n key casing: there was no `t()` call at all for most of these strings.

**Why this matters:** partial i18n fixes create false confidence. Fixing one tab/section does not imply the rest of the page routes through `t()` — large legacy pages can have entire tabs of literal-string UI copy.

## The fix — approach
1. `grep -noP '.{0,15}[\x{0600}-\x{06FF}]+.{0,15}'` (Arabic Unicode range) across every page/component file first, before assuming `t()` coverage, to find every hardcoded string exhaustively rather than sampling.
2. For any hardcoded object whose fields are literal per-language strings picked by data (e.g. `STATUS_META` with `labelAr`/`labelEn`), replace the literal fields with a translation-key reference (`statusKey: TranslationKey`) and resolve via `t(meta.statusKey)` at render time — never store both language variants and pick one by hand, since that pick is exactly where "always show Arabic" bugs hide.
3. Module-level helper functions that build user-facing error/toast messages but sit outside the component (no hook access) should accept `t` as a parameter from the call site rather than being turned into hooks themselves.
4. Distinguish office-entered data (name, city, descriptions, service text they typed) from interface chrome around it — only chrome gets `t()`; typed values are correctly left in whatever language the office wrote them, and a test agent flagging English text inside a value field is a false positive, not a bug.

**How to apply:** for any future "translation is broken on page X" report, re-run the Arabic/English-range grep on that page's actual files before trusting an earlier partial fix — don't assume no-`t()`-call sections don't exist.

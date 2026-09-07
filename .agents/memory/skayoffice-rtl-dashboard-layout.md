---
name: SkayOffice RTL dashboard layout bug
description: CSS logical property error caused the right-side sidebar to overlap main content in RTL mode, blocking button clicks.
---

## Rule
Always use `lg:ms-60` (margin-inline-start) for the main content area offset — never a conditional `isRtl ? 'lg:me-60' : 'lg:ms-60'`.

**Why:** In RTL mode, `margin-inline-end` = margin-LEFT, which pushes the content away from the left edge — not away from the right-side sidebar. This caused the fixed sidebar (`right-0`, 240px wide) to physically overlap the right portion of the main content, intercepting pointer events on buttons near the right edge (Save, Submit Application).

**How to apply:** `margin-inline-start` (Tailwind: `ms-*`) is a CSS logical property that automatically resolves to margin-right in RTL and margin-left in LTR — matching whichever side the sidebar sits on (start side = right in RTL, left in LTR). No `isRtl` conditional needed.

**Fix location:** `artifacts/skayoffice-pilot/src/pages/dashboard/index.tsx` line 167.

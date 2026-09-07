---
name: Chat modal mobile layout
description: Root causes and fixes for the SkayOffice assistant chat modal being clipped/broken on mobile.
---

## Root causes

1. **`h-fit` on the outer `DialogContent`** — prevents `flex-1` children from filling available space; the message list can never independently scroll because the container just expands to content height.
2. **`overflow-y-auto` on the outer container** — when `h-fit` is present, the *whole dialog* scrolls (header + footer scroll away) instead of only the message area.
3. **Missing `min-h-0` on the `flex-1` message list** — without it, a flex child's default `min-height: auto` expands to content size regardless of the parent's height, breaking internal scroll.
4. **`vh` instead of `dvh`** — `100vh` on mobile doesn't account for dynamic address bar / bottom toolbar, so the modal is taller than the visible viewport.
5. **No `min-w-0` / `overflow-wrap: anywhere` on message rows** — long unbroken text (URLs, Arabic run-ons) overflows the modal horizontally.
6. **`right-4` (physical) on close button** — in RTL the title text also starts from the physical right, causing overlap; fix: use logical `end-4` so the button is at the visual "end" of the line in both LTR and RTL.

## Fix pattern for a flex chat dialog

```
DialogContent:
  flex flex-col gap-0 p-0
  overflow-y-hidden        ← suppress outer scroll
  h-[min(85dvh,680px)]     ← definite height so flex-1 works; dvh = dynamic toolbar-aware
  w-[calc(100vw-24px)] max-w-md
  sm:h-auto sm:max-h-[85dvh] sm:w-auto sm:max-w-md   ← desktop: shrink to content

Header:      shrink-0  pe-10 (reserve room for close button at inline-end)
Message list: flex-1 min-h-0 overflow-y-auto overscroll-contain
Message row:  w-full min-w-0 flex-col
Bubble:      max-w-[88%] min-w-0 break-words [overflow-wrap:anywhere]
WhatsApp:    shrink-0
Composer:    shrink-0  Input: min-w-0 flex-1  Button: shrink-0
```

**Why:** `h-fit` + no `min-h-0` is the classic "flex child won't scroll" trap. Always give a chat-style dialog a definite height via `min()` with a dvh and px cap.

## Files changed
- `artifacts/skayoffice-pilot/src/components/ui/dialog.tsx` — removed `h-fit`, changed `max-h-[85vh]` → `max-h-[85dvh]`, `right-4` → `end-4` on close button
- `artifacts/skayoffice-pilot/src/components/assistant/AssistantChatDialog.tsx` — full layout rewrite per above pattern

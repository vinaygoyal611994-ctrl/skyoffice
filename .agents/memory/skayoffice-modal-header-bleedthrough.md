---
name: Fixed-position modal over sticky header needs opaque background
description: Why a full-screen fixed overlay can still show a "ghosted" header behind it despite correct z-index, and the fix.
---

In SkayOffice Pilot, `OfficeProfile` (the Digital Office card) renders as `variant="modal"` using a `fixed inset-0 z-50` wrapper stacked above `Shell`'s `sticky top-0 z-40` header. Z-index ordering was already correct, but the wrapper's background was translucent (`bg-muted/20`, ~20% opacity), so the header's logo/language toggle/hamburger visually bled through behind the modal's own masthead text and close button — looking like an overlap bug even though nothing was actually mis-positioned.

**Why:** Opacity and stacking are independent. A higher z-index only guarantees paint order, not visual opacity — a translucent layer on top still shows what's underneath through it.

**How to apply:** Any full-viewport `fixed`/`absolute` overlay meant to fully replace what's behind it (modals, drawers, takeover views) needs a fully opaque background (e.g. `bg-background`), not just a tint. Reserve translucent tints (`bg-muted/20` etc.) for in-flow backgrounds where nothing needs to be visually hidden underneath, like the standalone (`variant="page"`) rendering of the same component.

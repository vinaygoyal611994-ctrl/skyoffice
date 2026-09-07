---
name: SkayOffice logo asset only has white text for dark backgrounds
description: The only available SkayOffice logo source is a screenshot with white wordmark text baked onto a solid navy background — making the background transparent alone leaves white-on-white invisible text on the app's light header/footer.
---

The only source asset (a phone screenshot) shows the icon + "SkayOffice" wordmark on a solid dark-navy rectangle, with the wordmark rendered in near-white. Simply chroma-keying the navy background to transparent (via ImageMagick `-fuzz -transparent`) produces a technically-transparent PNG whose text is invisible once placed on the app's white/light-gray header and footer.

**Why:** No official light-background/dark-text brand asset exists in the project. The white wordmark was designed to sit on the dark navy card, not on a light surface.

**How to apply:** Before chroma-keying, recolor the wordmark to a color visible on light backgrounds (this app used its own `--primary` slate, `rgb(52,64,79)`, matching existing header button color) — do this recolor pass with a *tight* fuzz threshold (~5-7%) so it only catches near-pure-white text pixels and not the icon's light-blue gradient highlights (which can be as pale as `rgb(168,201,244)` and get wrongly recolored if the fuzz threshold is too loose, e.g. 15%). Do the background-transparency `-transparent` pass *after* recoloring the text, using a wider fuzz (~12%) keyed to the exact sampled navy value, and use a text-recolor target color that's numerically far (Euclidean RGB distance) from the navy background so it survives the second pass untouched. Verify by flattening the result onto both a white and a dark test background before shipping.

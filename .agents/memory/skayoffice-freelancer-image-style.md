---
name: SkayOffice freelancerImageStyle field
description: Durable rules for the freelancer_image_style column, its pending-changes bypass, and the video-call feature gate.
---

## Column

`freelancer_image_style` is nullable TEXT on the offices table with a DB-level CHECK constraint (`personal_photo` | `brand_image`). `null` is treated as `brand_image` everywhere in application code.

**Why:** Lets the same `logoUrl` render as a circular avatar (personal photo) or rounded-square logo without adding a second media column.

## Pending-changes bypass

When an approved/active/suspended office PATCH includes `freelancerImageStyle`, the route handler extracts it, applies it **immediately** to the DB row, then stages remaining fields as a pending revision. A purely presentational toggle should not need admin approval.

**How to apply:** Any future "display-only" field (doesn't change what the provider offers) should follow the same extract-and-apply-immediately pattern in the PATCH /offices/me handler around `LOCKED_EDIT_STATUSES`.

## Upload category

Personal photos use the `personal_photo` upload category in `UPLOAD_LIMITS` (image MIME only, 5 MB). The path is stored in `logoUrl` — same field as brand logo. No separate DB column.

## Video call feature gate

The public Video Call button is gated behind `VIDEO_CALL_FEATURE_RELEASED = false as const` in office-profile.tsx. All backend infrastructure (routes, DB field `video_call_enabled`, existing requests table) is preserved. To release publicly: set this constant to `true` and verify the toggle correctly gates per-office.

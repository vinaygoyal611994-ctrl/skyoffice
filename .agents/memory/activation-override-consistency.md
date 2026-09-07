---
name: Activation override consistency
description: Concurrency and audit invariants for exceptional office activation.
---

An activation override must bind the admin's confirmation to the exact blocker
codes they reviewed. Recompute blockers server-side and reject the request if
the submitted snapshot differs from the current snapshot.

**Why:** A boolean confirmation alone can become stale while a dialog is open,
and separate database reads can produce an audit record that never represented
one consistent state. A concurrent status change can also be overwritten unless
activation is conditional.

**How to apply:** Run blocker reads, the status-constrained activation update,
and the audit write in one serializable transaction. Require the office to
still be approved, abort on zero updated rows, and refresh the UI after a stale
snapshot conflict. Apply the same atomicity rule to strict activation.
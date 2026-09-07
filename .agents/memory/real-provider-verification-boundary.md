---
name: Real provider verification boundary
description: How to distinguish real production provider ownership from legacy seeded provider accounts during readiness checks.
---

Production readiness checks must identify the real Office and Freelancer records from the existing non-demo production rows and verify their owner foreign keys, active user accounts, and ownership/login audit evidence. Legacy seeded provider accounts are test data and must not be used to infer ownership, repair relationships, or decide whether the real dashboards are healthy.

**Why:** Seeded provider accounts can survive while their original provider rows are missing, and assigning them to current records would risk overwriting real ownership.

**How to apply:** For ownership verification, use read-only production evidence and the owner-controlled login for the real account. If direct login is unavailable, report the relationship as structurally verified but the live dashboard as not manually tested; never reset or reassign the account.
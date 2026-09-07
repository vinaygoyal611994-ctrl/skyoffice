---
name: Cross-artifact production module tests
description: How API-suite tests can execute browser code from the pilot artifact without breaking API TypeScript boundaries.
---

When a test in the API artifact must exercise a browser-side production module
from the pilot artifact, load it by a runtime file URL rather than a static
TypeScript import.

**Why:** A static cross-artifact import causes the API compiler to include the
pilot source outside the API project's `rootDir`, which fails the repository
typecheck. Re-declaring the browser module's functions in the test avoids that
compiler error but does not test production behavior.

**How to apply:** Keep the test's browser-global mocks local, dynamically load
the real `.ts` module by absolute file URL under Vitest, and assert behavior
through the actual exported functions. Re-run both the focused test and the
full API suite after changing the test harness.
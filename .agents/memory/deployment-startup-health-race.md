---
name: Deployment startup health-probe race
description: Multi-artifact Autoscale deployments can emit transient 500/connection-refused health probes while sibling services start.
---

Treat early deployment health-probe failures as transient until the build record, live root, shallow API health, and deep database health are checked after startup. Do not change app or deployment configuration solely because of those early probe lines.

**Why:** The API and frontend artifacts start in parallel; the deployment supervisor probes `/api` and `/` before both ports are ready, while the build can still finish successfully and the live service can become healthy.

**How to apply:** Correlate probe timestamps with the deployment build status and verify `/`, `/api/healthz`, and `/api/healthz?deep=1` before attempting a code fix.

A failed build that ends at “Creating Autoscale service” before `upsertCloudRunService completed`, artifact-process logs, port detection, or readiness probes is a Replit control-plane failure, not an application health-check failure.

**Why:** The application container has not started at that boundary, so its port binding, startup order, and health endpoints cannot be responsible.

**How to apply:** Retry through the Publishing UI after restarting workspace compute. If no new build record appears or the retry stops at the same boundary, provide the build/deployment identifiers and logs to Replit Support rather than changing application configuration.
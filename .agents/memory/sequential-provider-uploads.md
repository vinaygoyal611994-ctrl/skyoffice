---
name: Sequential provider uploads
description: The required client/server concurrency contract for provider media batches.
---

Provider file batches must be queued with upload concurrency set to one. Do not restore Uppy's default parallel upload behavior unless the server's upload-relay memory model is deliberately redesigned at the same time.

**Why:** The same-origin relay intentionally permits only one in-flight direct upload per provider account to bound server memory. Parallel batch PUTs cause every request after the first to receive `429 upload_in_progress`, making normal multi-image gallery selection fail.

**How to apply:** Any uploader that uses the provider direct-upload relay must either reuse the shared uploader's sequential queue or enforce the same one-at-a-time behavior itself. Keep batch selection enabled; only network execution is serialized.
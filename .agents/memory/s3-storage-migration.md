---
name: S3 storage migration
description: Decisions and gotchas from replacing the Replit GCS sidecar with @aws-sdk/client-s3
---

# S3-compatible storage layer

Storage must be configured explicitly from environment variables and must
never fall back to Replit infrastructure in production.

**Why:** A portable production deployment cannot depend on a workspace-local
sidecar, while local development should remain usable before credentials are
provisioned.

**How to apply:**
- Prefer direct browser uploads only after bucket CORS is verified. If the
  active storage credentials cannot manage CORS, use an authenticated
  same-origin relay rather than leaving uploads broken.
  **Why:** R2 accepted server-side writes while browser preflight failed, and
  the available credentials could not add a bucket CORS policy.
  **How to apply:** authenticate and validate the upload claim before parsing,
  enforce category-specific size/MIME and strict in-flight limits, serialize
  claim consumption against the storage write, resolve the returned relative
  relay path to an absolute same-origin URL in every browser consumer, attach
  bearer auth only for that local URL, and return the storage `ETag` expected
  by browser upload clients.
- Keep private documents private. Public media is served only after the API
  verifies it is approved; do not open the whole bucket to the internet.
- Use a dedicated backup bucket when possible. A same-bucket fallback may
  keep backups running temporarily, but is not disaster isolation.
- Plan an object-data migration before cutover when old files matter. Stored
  database paths only remain valid if legacy objects are copied to the new
  bucket under matching keys.
  **Why:** Copying a known Office's files was not sufficient coverage: the real
  Freelancer's approved images and marketing video remained in legacy GCS while
  every corresponding R2 key was absent, producing correct API payloads with
  broken public media.
  **How to apply:** derive the migration manifest from every live database media
  reference across every provider type and every variant, verify each source
  object exists, copy exact bytes under the same key, then compare source/target
  hashes and exercise the public storage route before cutover.
- For private, verified uploads, never persist the temporary presigned-PUT
  object path. Copy the verified exact bytes to a fresh server-owned key first.
  **Why:** a client can reuse a presigned PUT URL until it expires and overwrite
  the temporary key after validation. **How to apply:** bind signed PUTs to
  declared MIME/size and a short TTL, then delete the temporary key best-effort
  after finalization; bucket-side write constraints still need live verification.
- Some Cloudflare R2 deployments reject S3 `x-amz-tagging` on `PutObject`.
  **Why:** a live R2 verification probe failed solely on that unsupported header.
  **How to apply:** keep application uploads tag-free unless the configured R2
  account has explicitly verified tag support.

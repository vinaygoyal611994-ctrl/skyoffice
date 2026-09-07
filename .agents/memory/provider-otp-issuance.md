---
name: Provider OTP issuance
description: Durable concurrency and resend rules for provider email and phone verification challenges.
---

Serialize verification-code issuance per user and channel across API instances, and enforce resend quotas from retained successful token rows rather than process memory. Failed delivery must not invalidate a previously delivered token or create a new usable token.

**Why:** External delivery and token persistence can otherwise race: concurrent requests may revoke each other out of order, and per-process limits multiply when the API scales horizontally.

**How to apply:** Hold a transaction-scoped advisory lock for the user/channel through provider acceptance and token replacement. Keep historical rows for quota counting, while allowing only one unused token per channel.
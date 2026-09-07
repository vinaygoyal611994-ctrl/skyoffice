---
name: Marketing-video server verification
description: Runtime and security constraints for authoritative Decision Card MP4 duration validation.
---

Decision Card marketing videos must be verified from the actual private object,
not from client metadata. The selected approach uses the system `ffprobe`
executable supplied by Replit's declared Nix FFmpeg dependency.

**Why:** The client duration can be omitted or falsified. A mature media parser
is safer than maintaining a partial MP4 parser. The development workspace had
ffprobe implicitly, but Autoscale did not; undeclared system tools must never be
assumed to carry into production.

**How to apply:** Stream the size-bounded private object to a restrictive
temporary file, invoke ffprobe with fixed arguments and no shell, restrict
protocols to local file/pipe, enforce a timeout/output cap, validate an MP4
container with a video stream, and fail closed on storage/probe errors. Compare
the exact probed duration before rounding upward for the existing integer field.
Keep FFmpeg declared through Replit's system-dependency configuration, and
verify the running service's PATH rather than checking only an interactive shell.
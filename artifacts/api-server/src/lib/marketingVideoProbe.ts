import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import type { ObjectStorageService } from "./objectStorage";

const execFileAsync = promisify(execFile);
const FFPROBE_TIMEOUT_MS = 20_000;
const FFPROBE_MAX_OUTPUT_BYTES = 64 * 1024;

type FfprobeOutput = {
  streams?: Array<{ codec_type?: string }>;
  format?: {
    format_name?: string;
    duration?: string;
  };
};

export type MarketingVideoVerificationResult =
  | {
      ok: true;
      durationSeconds: number;
      storedDurationSeconds: number;
    }
  | {
      ok: false;
      reason:
        | "video_too_long"
        | "invalid_video"
        | "duration_unavailable"
        | "storage_unavailable";
      cause?: unknown;
    };

function isProbeUnavailable(error: unknown): boolean {
  const probeError = error as NodeJS.ErrnoException & {
    killed?: boolean;
    signal?: NodeJS.Signals | null;
  };
  return (
    probeError.code === "ENOENT" ||
    probeError.code === "ETIMEDOUT" ||
    probeError.killed === true ||
    probeError.signal === "SIGTERM"
  );
}

/**
 * Streams a private S3/R2 object to an isolated temporary file and asks the
 * existing ffprobe runtime binary to inspect the actual bytes. No shell is
 * involved and no client-supplied value is passed as an executable argument.
 */
export async function verifyMarketingVideoFile(
  objectPath: string,
  storage: Pick<ObjectStorageService, "writeObjectEntityToFile">,
  options: { maxBytes: number; maxSeconds: number },
): Promise<MarketingVideoVerificationResult> {
  const tempDirectory = await mkdtemp(join(tmpdir(), "skayoffice-video-"));
  const tempFile = join(tempDirectory, "upload.mp4");

  try {
    try {
      await storage.writeObjectEntityToFile(
        objectPath,
        tempFile,
        options.maxBytes,
      );
    } catch (error) {
      return { ok: false, reason: "storage_unavailable", cause: error };
    }

    let stdout: string;
    try {
      const result = await execFileAsync(
        "ffprobe",
        [
          "-v",
          "error",
          "-protocol_whitelist",
          "file,pipe",
          "-select_streams",
          "v:0",
          "-show_entries",
          "stream=codec_type:format=format_name,duration",
          "-of",
          "json",
          tempFile,
        ],
        {
          encoding: "utf8",
          maxBuffer: FFPROBE_MAX_OUTPUT_BYTES,
          timeout: FFPROBE_TIMEOUT_MS,
          windowsHide: true,
        },
      );
      stdout = result.stdout;
    } catch (error) {
      return {
        ok: false,
        reason: isProbeUnavailable(error)
          ? "duration_unavailable"
          : "invalid_video",
        cause: error,
      };
    }

    let probe: FfprobeOutput;
    try {
      probe = JSON.parse(stdout) as FfprobeOutput;
    } catch (error) {
      return { ok: false, reason: "invalid_video", cause: error };
    }

    const formatNames = probe.format?.format_name?.split(",") ?? [];
    const hasVideoStream = probe.streams?.some(
      (stream) => stream.codec_type === "video",
    );
    if (!formatNames.includes("mp4") || !hasVideoStream) {
      return { ok: false, reason: "invalid_video" };
    }

    const durationSeconds = Number(probe.format?.duration);
    if (!Number.isFinite(durationSeconds)) {
      return { ok: false, reason: "duration_unavailable" };
    }
    if (durationSeconds < 1) {
      return { ok: false, reason: "invalid_video" };
    }
    if (durationSeconds > options.maxSeconds) {
      return { ok: false, reason: "video_too_long" };
    }

    return {
      ok: true,
      durationSeconds,
      // The database/API expose whole seconds. Round upward so the stored
      // value never understates the duration that passed the exact check.
      storedDurationSeconds: Math.ceil(durationSeconds),
    };
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}
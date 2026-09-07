import { execFile } from "node:child_process";
import { copyFile, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { verifyMarketingVideoFile } from "../marketingVideoProbe";

const execFileAsync = promisify(execFile);

describe("verifyMarketingVideoFile", () => {
  let fixtureDirectory: string;
  const fixtures = new Map<number, string>();

  beforeAll(async () => {
    fixtureDirectory = await mkdtemp(join(tmpdir(), "skayoffice-probe-test-"));
    for (const duration of [74, 75, 76]) {
      const fixture = join(fixtureDirectory, `${duration}.mp4`);
      await execFileAsync(
        "ffmpeg",
        [
          "-v",
          "error",
          "-f",
          "lavfi",
          "-i",
          `color=c=black:s=16x16:r=1:d=${duration}`,
          "-an",
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-pix_fmt",
          "yuv420p",
          "-movflags",
          "+faststart",
          "-y",
          fixture,
        ],
        { timeout: 30_000 },
      );
      fixtures.set(duration, fixture);
    }
  }, 60_000);

  afterAll(async () => {
    await rm(fixtureDirectory, { recursive: true, force: true });
  });

  function storageForFixture(fixture: string) {
    return {
      async writeObjectEntityToFile(
        _objectPath: string,
        destinationPath: string,
        maxBytes: number,
      ) {
        const metadata = await stat(fixture);
        if (metadata.size > maxBytes) {
          throw new Error("fixture exceeds limit");
        }
        await copyFile(fixture, destinationPath);
        return metadata.size;
      },
    };
  }

  it.each([
    [74, true],
    [75, true],
    [76, false],
  ])(
    "enforces the actual MP4 duration at %i seconds",
    async (duration, expectedOk) => {
      const fixture = fixtures.get(duration);
      expect(fixture).toBeDefined();

      const result = await verifyMarketingVideoFile(
        "/objects/uploads/test",
        storageForFixture(fixture!),
        { maxBytes: 80 * 1024 * 1024, maxSeconds: 75 },
      );

      expect(result.ok).toBe(expectedOk);
      if (expectedOk) {
        expect(result).toMatchObject({
          ok: true,
          storedDurationSeconds: duration,
        });
      } else {
        expect(result).toMatchObject({
          ok: false,
          reason: "video_too_long",
        });
      }
    },
    30_000,
  );

  it("rejects a corrupt MP4", async () => {
    const fixture = join(fixtureDirectory, "corrupt.mp4");
    await writeFile(fixture, Buffer.from("not a valid media container"));

    const result = await verifyMarketingVideoFile(
      "/objects/uploads/corrupt",
      storageForFixture(fixture),
      { maxBytes: 80 * 1024 * 1024, maxSeconds: 75 },
    );

    expect(result).toMatchObject({ ok: false, reason: "invalid_video" });
  });

  it("rejects a non-MP4 file even when it has an .mp4 name", async () => {
    const fixture = join(fixtureDirectory, "disguised.mp4");
    await execFileAsync(
      "ffmpeg",
      [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "color=c=black:s=16x16:r=1:d=2",
        "-an",
        "-c:v",
        "libvpx-vp9",
        "-f",
        "webm",
        "-y",
        fixture,
      ],
      { timeout: 30_000 },
    );

    const result = await verifyMarketingVideoFile(
      "/objects/uploads/disguised",
      storageForFixture(fixture),
      { maxBytes: 80 * 1024 * 1024, maxSeconds: 75 },
    );

    expect(result).toMatchObject({ ok: false, reason: "invalid_video" });
  });

  it("rejects safely when the storage object is unavailable", async () => {
    const result = await verifyMarketingVideoFile(
      "/objects/uploads/missing",
      {
        async writeObjectEntityToFile() {
          throw new Error("storage unavailable");
        },
      },
      { maxBytes: 80 * 1024 * 1024, maxSeconds: 75 },
    );

    expect(result).toMatchObject({
      ok: false,
      reason: "storage_unavailable",
    });
  });
});
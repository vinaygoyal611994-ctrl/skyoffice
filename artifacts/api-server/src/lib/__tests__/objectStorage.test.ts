/**
 * Unit tests for the S3-compatible storage layer's pure logic:
 * presigned-URL → internal path normalization and env-var validation.
 * (Network-dependent methods are covered by e2e testing against a real
 * provider; they are thin wrappers over the AWS SDK.)
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ObjectStorageService } from "../objectStorage";
import { missingStorageEnvVars } from "../storageConfig";

const ENV_KEYS = [
  "STORAGE_ENDPOINT",
  "STORAGE_REGION",
  "STORAGE_ACCESS_KEY_ID",
  "STORAGE_SECRET_ACCESS_KEY",
  "STORAGE_PUBLIC_BUCKET",
  "STORAGE_PRIVATE_BUCKET",
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.STORAGE_ENDPOINT = "https://accountid.r2.cloudflarestorage.com";
  process.env.STORAGE_REGION = "auto";
  process.env.STORAGE_ACCESS_KEY_ID = "test-key";
  process.env.STORAGE_SECRET_ACCESS_KEY = "test-secret";
  process.env.STORAGE_PUBLIC_BUCKET = "sk-public";
  process.env.STORAGE_PRIVATE_BUCKET = "sk-private";
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

describe("normalizeObjectEntityPath", () => {
  const svc = new ObjectStorageService();

  it("passes through non-URL paths unchanged", () => {
    expect(svc.normalizeObjectEntityPath("/objects/uploads/abc")).toBe(
      "/objects/uploads/abc",
    );
    expect(svc.normalizeObjectEntityPath("uploads/abc")).toBe("uploads/abc");
  });

  it("maps a path-style presigned PUT URL to the internal /objects path", () => {
    const url =
      "https://accountid.r2.cloudflarestorage.com/sk-private/uploads/uuid-1" +
      "?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Signature=deadbeef";
    expect(svc.normalizeObjectEntityPath(url)).toBe("/objects/uploads/uuid-1");
  });

  it("maps a virtual-hosted-style URL to the internal /objects path", () => {
    const url =
      "https://sk-private.s3.us-east-1.amazonaws.com/uploads/uuid-2?X-Amz-Expires=900";
    expect(svc.normalizeObjectEntityPath(url)).toBe("/objects/uploads/uuid-2");
  });

  it("returns the pathname when the URL does not reference the private bucket", () => {
    const url = "https://accountid.r2.cloudflarestorage.com/other-bucket/x/y";
    expect(svc.normalizeObjectEntityPath(url)).toBe("/other-bucket/x/y");
  });

  it("round-trips: uploads/<uuid> key produces path getObjectEntityFile can parse", () => {
    const url =
      "https://accountid.r2.cloudflarestorage.com/sk-private/uploads/round-trip-id?sig=x";
    const normalized = svc.normalizeObjectEntityPath(url);
    expect(normalized.startsWith("/objects/")).toBe(true);
    // key extraction logic used by getObjectEntityFile:
    const key = normalized.slice(1).split("/").slice(1).join("/");
    expect(key).toBe("uploads/round-trip-id");
  });
});

describe("missingStorageEnvVars", () => {
  it("returns an empty array when everything is configured", () => {
    expect(missingStorageEnvVars()).toEqual([]);
  });

  it("reports each missing var by name", () => {
    delete process.env.STORAGE_ENDPOINT;
    delete process.env.STORAGE_PRIVATE_BUCKET;
    expect(missingStorageEnvVars()).toEqual([
      "STORAGE_ENDPOINT",
      "STORAGE_PRIVATE_BUCKET",
    ]);
  });
});

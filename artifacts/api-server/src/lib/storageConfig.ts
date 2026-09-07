/**
 * S3-compatible storage configuration.
 *
 * All object storage (media, documents, DB backups) goes through an
 * S3-compatible endpoint (AWS S3, Cloudflare R2, MinIO, …) configured
 * entirely via environment variables — no Replit-specific infrastructure.
 *
 * Required env vars (production startup fails if any is missing):
 *   STORAGE_ENDPOINT           e.g. https://<accountid>.r2.cloudflarestorage.com
 *   STORAGE_REGION             e.g. auto (R2) or us-east-1
 *   STORAGE_ACCESS_KEY_ID
 *   STORAGE_SECRET_ACCESS_KEY
 *   STORAGE_PUBLIC_BUCKET      bucket for public assets served via /storage/public-objects
 *   STORAGE_PRIVATE_BUCKET     bucket for private object entities (/objects/…)
 *
 * Optional backup-specific overrides (see backup.ts):
 *   BACKUP_S3_BUCKET, BACKUP_S3_ENDPOINT, BACKUP_S3_REGION,
 *   BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY
 */
import { S3Client } from '@aws-sdk/client-s3';

export const REQUIRED_STORAGE_ENV_VARS = [
  'STORAGE_ENDPOINT',
  'STORAGE_REGION',
  'STORAGE_ACCESS_KEY_ID',
  'STORAGE_SECRET_ACCESS_KEY',
  'STORAGE_PUBLIC_BUCKET',
  'STORAGE_PRIVATE_BUCKET',
] as const;

/** Returns the names of required storage env vars that are not set. */
export function missingStorageEnvVars(): string[] {
  return REQUIRED_STORAGE_ENV_VARS.filter((name) => !process.env[name]);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} is not set. Configure the S3-compatible storage env vars ` +
        `(${REQUIRED_STORAGE_ENV_VARS.join(', ')}) before using object storage.`,
    );
  }
  return value;
}

export function getStorageEndpoint(): string {
  // Normalise: no trailing slash so URL construction is predictable.
  return requireEnv('STORAGE_ENDPOINT').replace(/\/+$/, '');
}

export function getPublicBucket(): string {
  return requireEnv('STORAGE_PUBLIC_BUCKET');
}

export function getPrivateBucket(): string {
  return requireEnv('STORAGE_PRIVATE_BUCKET');
}

let cachedClient: S3Client | null = null;

/**
 * Lazily-constructed shared S3 client.
 *
 * Lazy so that a development environment without storage credentials can
 * still boot the server (storage routes will fail loudly on first use);
 * production startup validation in index.ts guarantees the vars exist
 * before any request is served.
 */
export function getS3Client(): S3Client {
  if (!cachedClient) {
    cachedClient = new S3Client({
      endpoint: getStorageEndpoint(),
      region: requireEnv('STORAGE_REGION'),
      credentials: {
        accessKeyId: requireEnv('STORAGE_ACCESS_KEY_ID'),
        secretAccessKey: requireEnv('STORAGE_SECRET_ACCESS_KEY'),
      },
      // Path-style URLs (endpoint/bucket/key) work across all S3-compatible
      // providers, including those without wildcard-subdomain DNS (MinIO, R2).
      forcePathStyle: true,
    });
  }
  return cachedClient;
}

/** Test-only: reset the cached client so env changes take effect. */
export function resetS3ClientForTests(): void {
  cachedClient = null;
}

/**
 * S3-compatible object storage service.
 *
 * Portable across AWS S3, Cloudflare R2, MinIO and any other S3-compatible
 * provider — configured entirely via env vars (see storageConfig.ts).
 *
 * Path conventions (unchanged from the previous implementation, so all DB
 * rows keep working):
 *   - Private object entities are stored under `uploads/<uuid>[-suffix]` in
 *     STORAGE_PRIVATE_BUCKET and referenced everywhere as
 *     `/objects/uploads/<uuid>[-suffix]`.
 *   - Public assets live in STORAGE_PUBLIC_BUCKET and are served via
 *     GET /storage/public-objects/<key>.
 */
import { randomUUID } from 'crypto';
import { createWriteStream } from 'fs';
import { Readable } from 'stream';
import { Transform } from 'stream';
import { pipeline } from 'stream/promises';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import {
  canAccessObject,
  parseAclPolicyFromMetadata,
  ObjectAclPolicy,
  ObjectPermission,
  setObjectAclPolicy,
  StorageObject,
} from './objectAcl';
import { getPrivateBucket, getPublicBucket, getS3Client } from './storageConfig';

export type { StorageObject } from './objectAcl';

export class ObjectNotFoundError extends Error {
  constructor() {
    super('Object not found');
    this.name = 'ObjectNotFoundError';
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

/** True when an AWS SDK error means "object/bucket not found" (HTTP 404). */
function isNotFoundError(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e?.name === 'NotFound' ||
    e?.name === 'NoSuchKey' ||
    e?.$metadata?.httpStatusCode === 404
  );
}

/**
 * Confirms an uploaded object is actually readable in storage before the
 * caller treats the upload as successful. The existence check is a live
 * network call to the storage provider, which can fail transiently
 * (timeout, brief network hiccup, or eventual-consistency lag right after
 * the client's PUT completes) independent of whether the file truly
 * exists — retry up to 10 times before concluding it's unreadable. A
 * genuine "not found" short-circuits immediately since retrying won't
 * change that outcome.
 *
 * 10 attempts × 500 ms = 5 s max, which comfortably covers normal
 * propagation lag. This function is used only for verification-document
 * registration (where an admin will immediately review the file).
 * Media uploads (gallery, quick-card cover, marketing video) skip this
 * check entirely — see the comments in POST /offices/me/media.
 */
export async function verifyObjectReadable(objectPath: string): Promise<boolean> {
  const storage = new ObjectStorageService();
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await storage.getObjectEntityFile(objectPath);
      return true;
    } catch (err) {
      if (err instanceof ObjectNotFoundError) return false;
      if (attempt < 9) {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }
  return false;
}

export class ObjectStorageService {
  constructor() {}

  /** Allocates a new private object path without exposing storage credentials. */
  createObjectEntityPath(): string {
    return `/objects/uploads/${randomUUID()}`;
  }

  /**
   * Looks for a public asset in the public bucket. Returns a descriptor
   * for the object if it exists, or null if not found.
   */
  async searchPublicObject(filePath: string): Promise<StorageObject | null> {
    const bucket = getPublicBucket();
    const key = filePath.replace(/^\/+/, '');
    try {
      await getS3Client().send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      );
      return { bucket, key };
    } catch (err) {
      if (isNotFoundError(err)) return null;
      throw err;
    }
  }

  /**
   * Streams an object to a web Response, with Content-Type / Content-Length
   * and a Cache-Control header derived from the object's ACL visibility.
   */
  async downloadObject(
    storageObject: StorageObject,
    cacheTtlSec: number = 3600,
  ): Promise<Response> {
    const result = await getS3Client().send(
      new GetObjectCommand({
        Bucket: storageObject.bucket,
        Key: storageObject.key,
      }),
    );

    const aclPolicy = parseAclPolicyFromMetadata(result.Metadata);
    const isPublic = aclPolicy?.visibility === 'public';

    const headers: Record<string, string> = {
      'Content-Type': result.ContentType || 'application/octet-stream',
      'Cache-Control': `${isPublic ? 'public' : 'private'}, max-age=${cacheTtlSec}`,
    };
    if (result.ContentLength !== undefined) {
      headers['Content-Length'] = String(result.ContentLength);
    }

    const body = result.Body;
    if (!body) {
      return new Response(null, { headers });
    }
    const webStream = Readable.toWeb(body as Readable) as ReadableStream;
    return new Response(webStream, { headers });
  }

  /** Downloads a full object into memory (used by the image processor). */
  async downloadObjectBuffer(
    storageObject: StorageObject,
    maxBytes?: number,
  ): Promise<Buffer> {
    const result = await getS3Client().send(
      new GetObjectCommand({
        Bucket: storageObject.bucket,
        Key: storageObject.key,
        ...(maxBytes ? { Range: `bytes=0-${maxBytes - 1}` } : {}),
      }),
    );
    if (!result.Body) {
      throw new ObjectNotFoundError();
    }
    const bytes = await result.Body.transformToByteArray();
    if (maxBytes !== undefined && bytes.length > maxBytes) {
      throw new Error("Object exceeds the permitted download size");
    }
    return Buffer.from(bytes);
  }

  /**
   * Streams a private object to a caller-controlled local path without loading
   * it into memory. The byte limiter protects against a storage object changing
   * between the authoritative HEAD check and this GET.
   */
  async writeObjectEntityToFile(
    objectPath: string,
    destinationPath: string,
    maxBytes: number,
  ): Promise<number> {
    const storageObject = await this.getObjectEntityFile(objectPath);
    const result = await getS3Client().send(
      new GetObjectCommand({
        Bucket: storageObject.bucket,
        Key: storageObject.key,
      }),
    );
    if (!result.Body) {
      throw new ObjectNotFoundError();
    }

    let bytesWritten = 0;
    const byteLimiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytesWritten += chunk.length;
        if (bytesWritten > maxBytes) {
          callback(new Error('Object exceeds the permitted download size'));
          return;
        }
        callback(null, chunk);
      },
    });

    await pipeline(
      result.Body as Readable,
      byteLimiter,
      createWriteStream(destinationPath, { flags: 'wx', mode: 0o600 }),
    );
    return bytesWritten;
  }

  /**
   * Generates a presigned PUT URL for a new private object entity.
   * The client uploads the file directly to this URL.
   */
  async getObjectEntityUploadURL(options?: {
    contentType?: string;
    contentLength?: number;
    expiresIn?: number;
  }): Promise<string> {
    const objectId = randomUUID();
    const key = `uploads/${objectId}`;

    return getSignedUrl(
      getS3Client(),
      new PutObjectCommand({
        Bucket: getPrivateBucket(),
        Key: key,
        ...(options?.contentType ? { ContentType: options.contentType } : {}),
        ...(options?.contentLength !== undefined
          ? { ContentLength: options.contentLength }
          : {}),
      }),
      { expiresIn: options?.expiresIn ?? 900 },
    );
  }

  /**
   * Writes browser-uploaded bytes to a pre-allocated private object path.
   * The API route validates authentication, ownership, MIME type, and size
   * before calling this method.
   */
  async uploadObjectEntity(
    objectPath: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string | undefined> {
    if (!objectPath.startsWith('/objects/uploads/')) {
      throw new ObjectNotFoundError();
    }
    const key = objectPath.slice('/objects/'.length);
    if (!key) throw new ObjectNotFoundError();

    const result = await getS3Client().send(
      new PutObjectCommand({
        Bucket: getPrivateBucket(),
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );
    return result.ETag;
  }

  /**
   * Resolves an internal `/objects/…` path to a StorageObject in the
   * private bucket, confirming the object exists.
   */
  async getObjectEntityFile(objectPath: string): Promise<StorageObject> {
    if (!objectPath.startsWith('/objects/')) {
      throw new ObjectNotFoundError();
    }

    const parts = objectPath.slice(1).split('/');
    if (parts.length < 2) {
      throw new ObjectNotFoundError();
    }

    const key = parts.slice(1).join('/');
    const bucket = getPrivateBucket();
    try {
      await getS3Client().send(
        new HeadObjectCommand({ Bucket: bucket, Key: key }),
      );
    } catch (err) {
      if (isNotFoundError(err)) {
        throw new ObjectNotFoundError();
      }
      throw err;
    }
    return { bucket, key };
  }

  /**
   * Returns the authoritative metadata recorded by S3 for a private object.
   * Registration routes must use this instead of client-provided MIME and size
   * values, which are trivially forgeable.
   */
  async getObjectEntityMetadata(
    objectPath: string,
  ): Promise<{ contentType: string | undefined; contentLength: number | undefined }> {
    if (!objectPath.startsWith('/objects/')) {
      throw new ObjectNotFoundError();
    }
    const key = objectPath.slice('/objects/'.length);
    if (!key) throw new ObjectNotFoundError();
    try {
      const result = await getS3Client().send(
        new HeadObjectCommand({ Bucket: getPrivateBucket(), Key: key }),
      );
      return {
        contentType: result.ContentType,
        contentLength: result.ContentLength,
      };
    } catch (err) {
      if (isNotFoundError(err)) throw new ObjectNotFoundError();
      throw err;
    }
  }

  /**
   * Best-effort deletion of a previously-uploaded private object (e.g. a
   * replaced/removed marketing video). Callers should not fail the
   * surrounding request if this throws — treat cleanup as advisory, since
   * the DB row is always the source of truth for what's "live".
   */
  async deleteObjectEntity(objectPath: string): Promise<void> {
    try {
      const storageObject = await this.getObjectEntityFile(objectPath);
      await getS3Client().send(
        new DeleteObjectCommand({
          Bucket: storageObject.bucket,
          Key: storageObject.key,
        }),
      );
    } catch (err) {
      if (err instanceof ObjectNotFoundError) return;
      throw err;
    }
  }

  /**
   * Maps a presigned upload URL (or any storage URL for the private bucket)
   * back to the internal `/objects/…` path. Non-URL inputs pass through
   * unchanged.
   *
   * Handles both path-style URLs (`https://endpoint/bucket/key`) — which is
   * what our client produces (forcePathStyle: true) — and virtual-hosted
   * style (`https://bucket.endpoint/key`) for robustness.
   */
  normalizeObjectEntityPath(rawPath: string): string {
    if (!/^https?:\/\//i.test(rawPath)) {
      return rawPath;
    }

    let url: URL;
    try {
      url = new URL(rawPath);
    } catch {
      return rawPath;
    }

    const privateBucket = getPrivateBucket();
    const pathname = decodeURIComponent(url.pathname);

    let key: string | null = null;
    if (pathname.startsWith(`/${privateBucket}/`)) {
      // Path-style: /bucket/key
      key = pathname.slice(privateBucket.length + 2);
    } else if (url.hostname.startsWith(`${privateBucket}.`)) {
      // Virtual-hosted style: bucket.endpoint/key
      key = pathname.replace(/^\/+/, '');
    }

    if (key === null) {
      return pathname;
    }
    return `/objects/${key}`;
  }

  async trySetObjectEntityAclPolicy(
    rawPath: string,
    aclPolicy: ObjectAclPolicy,
  ): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (!normalizedPath.startsWith('/')) {
      return normalizedPath;
    }

    const storageObject = await this.getObjectEntityFile(normalizedPath);
    await setObjectAclPolicy(storageObject, aclPolicy);
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: StorageObject;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }

  /**
   * Writes a buffer directly to storage as a new private object entity,
   * without requiring a client-side signed-URL upload.  Used by the image
   * processor to store optimised WebP variants after server-side processing.
   *
   * Returns the normalised object path (`/objects/uploads/<uuid>[-suffix]`)
   * that can be persisted in the database and later served via the storage
   * serving route.
   */
  async saveObjectEntity(
    buffer: Buffer,
    contentType: string,
    nameSuffix?: string,
  ): Promise<string> {
    const baseName = randomUUID();
    const segmentName = nameSuffix ? `${baseName}-${nameSuffix}` : baseName;
    const key = `uploads/${segmentName}`;
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: getPrivateBucket(),
        Key: key,
        Body: buffer,
        ContentType: contentType,
      }),
    );
    return `/objects/${key}`;
  }
}

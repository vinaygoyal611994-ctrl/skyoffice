import { Readable } from 'stream';
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from '@workspace/api-zod';
import express, { Router, type IRouter, type NextFunction, type Request, type Response } from 'express';
import {
  db,
  officesTable,
  officeVerificationDocumentsTable,
  uploadClaimsTable,
} from '@workspace/db';
import { eq, sql } from 'drizzle-orm';

import { ObjectPermission } from '../lib/objectAcl';
import {
  ObjectNotFoundError,
  ObjectStorageService,
} from '../lib/objectStorage';
import { directUploadLimiter, uploadUrlLimiter } from '../lib/rateLimiter';

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
const MAX_CONCURRENT_DIRECT_UPLOADS = 2;
const activeDirectUploadsByUser = new Map<number, number>();
let activeDirectUploads = 0;

function acquireDirectUploadSlot(req: Request, res: Response, next: NextFunction) {
  const user = req.session.user!;
  const userActive = activeDirectUploadsByUser.get(user.id) ?? 0;
  if (activeDirectUploads >= MAX_CONCURRENT_DIRECT_UPLOADS || userActive >= 1) {
    res.status(429).json({
      error: 'يوجد رفع آخر قيد التنفيذ. انتظر حتى يكتمل ثم حاول مرة أخرى.\nAnother upload is already in progress. Wait for it to finish and try again.',
      code: 'upload_in_progress',
    });
    return;
  }

  activeDirectUploads += 1;
  activeDirectUploadsByUser.set(user.id, userActive + 1);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    activeDirectUploads = Math.max(0, activeDirectUploads - 1);
    const remaining = (activeDirectUploadsByUser.get(user.id) ?? 1) - 1;
    if (remaining <= 0) activeDirectUploadsByUser.delete(user.id);
    else activeDirectUploadsByUser.set(user.id, remaining);
  };
  res.once('finish', release);
  res.once('close', release);
  next();
}

// Item 6: server-side type/size allow-lists per asset class. The client
// (ObjectUploader in dashboard.tsx) mirrors these as Uppy restrictions for
// fast feedback, but this is the check that actually matters — a client
// could bypass the UI and hit this endpoint directly.
const UPLOAD_LIMITS: Record<
  string,
  { contentTypes: string[]; maxSizeBytes: number }
> = {
  cover: {
    contentTypes: ["image/jpeg", "image/png", "image/webp"],
    maxSizeBytes: 8 * 1024 * 1024,
  },
  gallery_image: {
    contentTypes: ["image/jpeg", "image/png", "image/webp"],
    maxSizeBytes: 8 * 1024 * 1024,
  },
  // Optional portfolio Works items. These are always raster images.
  works_image: {
    contentTypes: ["image/jpeg", "image/png", "image/webp"],
    maxSizeBytes: 8 * 1024 * 1024,
  },
  gallery_video: {
    contentTypes: ["video/mp4", "video/webm", "video/quicktime"],
    maxSizeBytes: 100 * 1024 * 1024,
  },
  // The single optional marketing-video slot on the Digital Office /
  // Decision Card — stricter than gallery_video (MP4 only, smaller cap).
  marketing_video: {
    contentTypes: ["video/mp4"],
    maxSizeBytes: 80 * 1024 * 1024,
  },
  document: {
    contentTypes: ["application/pdf", "image/jpeg", "image/png"],
    maxSizeBytes: 15 * 1024 * 1024,
  },
  // Quick Card cover — the thumbnail shown in the search/listing card.
  // Distinct from `cover` so approval workflows can distinguish the asset class
  // in audit logs. Same MIME/size rules as `cover`.
  quick_card_cover: {
    contentTypes: ["image/jpeg", "image/png", "image/webp"],
    maxSizeBytes: 8 * 1024 * 1024,
  },
  // Decision Card cover — the hero image shown at the top of the full office
  // profile. Distinct from `gallery_image` for the same audit-log reason.
  decision_card_cover: {
    contentTypes: ["image/jpeg", "image/png", "image/webp"],
    maxSizeBytes: 8 * 1024 * 1024,
  },
};
// Requests that omit `category` (older clients) fall back to the most
// permissive image rule rather than being rejected outright.
const DEFAULT_UPLOAD_LIMIT = UPLOAD_LIMITS.gallery_image;

/**
 * Same-origin upload relay used because browser PUTs to the current R2 bucket
 * cannot pass CORS preflight. The existing upload claim still binds every
 * object path to one authenticated office and category; association endpoints
 * remain responsible for consuming that claim exactly once.
 */
router.put(
  '/storage/uploads/direct/:objectId',
  (req: Request, res: Response, next: NextFunction) => {
    const user = req.session.user;
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (user.role !== 'office') {
      res.status(403).json({ error: 'Forbidden: only office accounts may upload files' });
      return;
    }
    next();
  },
  directUploadLimiter,
  acquireDirectUploadSlot,
  async (req: Request, res: Response, next: NextFunction) => {
    const user = req.session.user!;

    const rawObjectId = req.params.objectId;
    const objectId = Array.isArray(rawObjectId) ? rawObjectId[0] : rawObjectId;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(objectId)) {
      res.status(400).json({ error: 'Invalid upload path' });
      return;
    }
    const objectPath = `/objects/uploads/${objectId}`;

    const [claim] = await db
      .select()
      .from(uploadClaimsTable)
      .where(eq(uploadClaimsTable.objectPath, objectPath));
    if (!claim) {
      res.status(400).json({ error: 'No valid upload claim exists for this file', code: 'no_upload_claim' });
      return;
    }
    if (claim.userId !== user.id) {
      res.status(403).json({ error: 'Upload claim belongs to a different office', code: 'claim_office_mismatch' });
      return;
    }
    if (claim.expiresAt <= new Date()) {
      await db.delete(uploadClaimsTable).where(eq(uploadClaimsTable.id, claim.id));
      res.status(400).json({ error: 'Upload claim has expired', code: 'claim_expired' });
      return;
    }

    const limit = UPLOAD_LIMITS[claim.category];
    const contentType = req.get('content-type')?.split(';', 1)[0]?.trim() ?? '';
    if (!limit || !limit.contentTypes.includes(contentType)) {
      res.status(400).json({
        error: `نوع الملف "${contentType}" غير مسموح به لهذا الرفع.\nFile type "${contentType}" is not allowed for this upload.`,
        code: 'invalid_file_type',
      });
      return;
    }

    res.locals.directUpload = { objectPath, claim, contentType, limit };
    express.raw({ type: () => true, limit: limit.maxSizeBytes })(
      req,
      res,
      (error) => {
        if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') {
          const maxMb = Math.round(limit.maxSizeBytes / (1024 * 1024));
          res.status(413).json({
            error: `حجم الملف كبير جدًا. الحد الأقصى هو ${maxMb} ميغابايت.\nFile is too large. Maximum size is ${maxMb}MB.`,
            code: 'file_too_large',
          });
          return;
        }
        next(error);
      },
    );
  },
  async (req: Request, res: Response) => {
    const user = req.session.user!;
    const {
      objectPath,
      claim,
      contentType,
      limit,
    } = res.locals.directUpload as {
      objectPath: string;
      claim: typeof uploadClaimsTable.$inferSelect;
      contentType: string;
      limit: { contentTypes: string[]; maxSizeBytes: number };
    };

    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({
        error: 'الملف فارغ أو غير صالح.\nThe uploaded file is empty or invalid.',
        code: 'invalid_file_body',
      });
      return;
    }
    if (req.body.length > limit.maxSizeBytes) {
      const maxMb = Math.round(limit.maxSizeBytes / (1024 * 1024));
      res.status(400).json({
        error: `حجم الملف كبير جدًا. الحد الأقصى هو ${maxMb} ميغابايت.\nFile is too large. Maximum size is ${maxMb}MB.`,
        code: 'file_too_large',
      });
      return;
    }

    try {
      const etag = await db.transaction(async (tx) => {
        // Serialize this write with claim consumption. If association wins the
        // race and removes the claim first, no bytes are written. If this PUT
        // wins, association waits until the immutable bytes are fully stored.
        const [lockedClaim] = await tx
          .select()
          .from(uploadClaimsTable)
          .where(eq(uploadClaimsTable.objectPath, objectPath))
          .for('update');
        if (
          !lockedClaim ||
          lockedClaim.id !== claim.id ||
          lockedClaim.userId !== user.id ||
          lockedClaim.expiresAt <= new Date()
        ) {
          const error = new Error('Upload claim is no longer valid');
          Object.assign(error, { status: 409, code: 'upload_claim_changed' });
          throw error;
        }
        return objectStorageService.uploadObjectEntity(objectPath, req.body, contentType);
      });
      if (etag) res.setHeader('ETag', etag);
      res.status(204).end();
    } catch (error) {
      if (
        error instanceof Error &&
        'status' in error &&
        (error as Error & { status?: number }).status === 409
      ) {
        res.status(409).json({
          error: 'لم تعد مطالبة الرفع صالحة. ابدأ الرفع مرة أخرى.\nThe upload claim is no longer valid. Start the upload again.',
          code: 'upload_claim_changed',
        });
        return;
      }
      req.log.error({ err: error }, 'Error uploading file through storage relay');
      res.status(500).json({
        error: 'تعذر رفع الملف إلى التخزين. حاول مرة أخرى.\nFailed to upload file to storage. Please try again.',
        code: 'storage_upload_failed',
      });
    }
  },
);

function hasAuthenticatedSession(
  req: Request,
): req is Request & { isAuthenticated: () => boolean } {
  if (
    !('isAuthenticated' in req) ||
    typeof req.isAuthenticated !== 'function'
  ) {
    return false;
  }

  return req.isAuthenticated();
}

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload.
 * The client sends JSON metadata (name, size, contentType) — NOT the file.
 * Then uploads the file directly to the returned presigned URL.
 *
 * Restricted to the `office` role — customers and admins have no legitimate
 * upload use-case and must not be able to mint write-capable signed URLs.
 * (Admins approve/reject office-uploaded media; they never upload directly.)
 */
router.post(
  '/storage/uploads/request-url',
  uploadUrlLimiter,          // MED-06: cap signed-URL generation per IP
  async (req: Request, res: Response) => {
    const user = req.session.user;
    if (!user) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (user.role !== 'office') {
      res.status(403).json({ error: 'Forbidden: only office accounts may upload files' });
      return;
    }

    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Missing or invalid required fields' });
      return;
    }

    const { name, size, contentType, category } = parsed.data;

    const limit = category ? UPLOAD_LIMITS[category] : DEFAULT_UPLOAD_LIMIT;
    if (!limit) {
      res.status(400).json({ error: 'Unknown upload category' });
      return;
    }
    if (!limit.contentTypes.includes(contentType)) {
      // Bilingual (AR/EN) since this message is surfaced as-is in the
      // office dashboard, which has no language toggle of its own.
      res.status(400).json({
        error: `نوع الملف "${contentType}" غير مسموح به لهذا الرفع. الأنواع المسموحة: ${limit.contentTypes.join(', ')}\nFile type "${contentType}" is not allowed for this upload. Allowed: ${limit.contentTypes.join(', ')}`,
        code: 'invalid_file_type',
      });
      return;
    }
    if (size > limit.maxSizeBytes) {
      const maxMb = Math.round(limit.maxSizeBytes / (1024 * 1024));
      res.status(400).json({
        error: `حجم الملف كبير جدًا. الحد الأقصى هو ${maxMb} ميغابايت.\nFile is too large. Maximum size is ${maxMb}MB.`,
        code: 'file_too_large',
      });
      return;
    }

    try {
      // Resolve the office at issuance, rather than trusting a user-supplied
      // office id later at registration time.
      const [office] = await db
        .select({ id: officesTable.id })
        .from(officesTable)
        .where(eq(officesTable.userId, user.id));
      if (!office) {
        res.status(401).json({ error: 'Office profile not found' });
        return;
      }

      const objectPath = objectStorageService.createObjectEntityPath();
      const objectId = objectPath.slice('/objects/uploads/'.length);
      const uploadURL = `/api/storage/uploads/direct/${objectId}`;
      // The URL and claim use the same 15-minute lifetime. The unique path
      // index makes this reservation unambiguous even under concurrent calls.
      await db.insert(uploadClaimsTable).values({
        userId: user.id,
        officeId: office.id,
        objectPath,
        category: category ?? 'gallery_image',
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      });

      res.json(
        RequestUploadUrlResponse.parse({
          uploadURL,
          objectPath,
          metadata: { name, size, contentType },
        }),
      );
    } catch (error) {
      req.log.error({ err: error }, 'Error generating upload URL');
      res.status(500).json({ error: 'Failed to generate upload URL' });
    }
  },
);

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 * IMPORTANT: Always provide this endpoint when object storage is set up.
 */
router.get(
  '/storage/public-objects/*filePath',
  async (req: Request, res: Response) => {
    try {
      const raw = req.params.filePath;
      const filePath = Array.isArray(raw) ? raw.join('/') : raw;
      const file = await objectStorageService.searchPublicObject(filePath);
      if (!file) {
        res.status(404).json({ error: 'File not found' });
        return;
      }

      const response = await objectStorageService.downloadObject(file);

      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));

      if (response.body) {
        const nodeStream = Readable.fromWeb(
          response.body as ReadableStream<Uint8Array>,
        );
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      req.log.error({ err: error }, 'Error serving public object');
      res.status(500).json({ error: 'Failed to serve public object' });
    }
  },
);

/**
 * Returns true when objectPath is confirmed approved public media — meaning
 * it is safe to serve without a session.
 *
 * Public media is defined as a path that belongs to an active, publicly
 * visible office and appears in:
 *   - offices.cover_url            (Quick Card cover — medium variant)
 *   - offices.cover_variants       (original / medium / thumbnail of cover)
 *   - offices.marketing_video_url  (profile/marketing video)
 *   - office_media.url             WHERE status = 'approved'  (DC gallery display)
 *   - office_media.variants        WHERE status = 'approved'  (public display variants only)
 *
 * Everything else — verification documents, pending covers, pending media,
 * rejected media — falls through to Gate 1 (session required) and Gate 2
 * (ownership check for documents). The entire bucket is never made public;
 * only confirmed approved paths bypass the auth check.
 */
async function isApprovedPublicMedia(objectPath: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT EXISTS (
      -- Quick Card cover (medium variant stored in cover_url)
       SELECT 1 FROM offices
         WHERE status = 'active'
           AND COALESCE(is_subscription_hidden, false) = false
           AND cover_url = ${objectPath}
      UNION ALL
      -- Marketing / profile video
       SELECT 1 FROM offices
         WHERE status = 'active'
           AND COALESCE(is_subscription_hidden, false) = false
           AND marketing_video_url = ${objectPath}
      UNION ALL
      -- Cover image variants: original, medium, thumbnail
      -- cover_variants is jsonb: { "medium": "...", "original": "...", "thumbnail": "..." }
      -- ::text cast is required: jsonb_build_object() uses variadic anyelement and
      -- PostgreSQL cannot infer the parameter type without an explicit cast.
      SELECT 1 FROM offices
         WHERE status = 'active'
           AND COALESCE(is_subscription_hidden, false) = false
           AND cover_variants IS NOT NULL
          AND (
               cover_variants @> jsonb_build_object('medium',    ${objectPath}::text)
            OR cover_variants @> jsonb_build_object('original',  ${objectPath}::text)
            OR cover_variants @> jsonb_build_object('thumbnail', ${objectPath}::text)
          )
      UNION ALL
      -- Approved gallery media display URL
       SELECT 1 FROM office_media media
         INNER JOIN offices office ON office.id = media.office_id
         WHERE media.url = ${objectPath}
           AND media.status = 'approved'
           AND office.status = 'active'
           AND COALESCE(office.is_subscription_hidden, false) = false
      UNION ALL
      -- Approved media display variants (including Works). Raw original
      -- uploads intentionally remain private even after approval.
       SELECT 1 FROM office_media media
         INNER JOIN offices office ON office.id = media.office_id
         WHERE media.status = 'approved'
           AND office.status = 'active'
           AND COALESCE(office.is_subscription_hidden, false) = false
           AND media.variants IS NOT NULL
          AND (
                media.variants @> jsonb_build_object('display',   ${objectPath}::text)
             OR media.variants @> jsonb_build_object('thumbnail', ${objectPath}::text)
             OR media.variants @> jsonb_build_object('medium',    ${objectPath}::text)
          )
    ) AS is_public
  `);
  const row = result.rows[0] as { is_public: boolean } | undefined;
  return row?.is_public === true;
}

/**
 * GET /storage/objects/*
 *
 * Serve object entities from PRIVATE_OBJECT_DIR.
 *
 * Access-control model (checked in order):
 *
 * 1. APPROVED PUBLIC MEDIA — no auth required.
 *    Covers, gallery display images, and marketing videos are already visible
 *    on the public-facing Decision Card and Quick Card pages. A DB lookup
 *    against offices.cover_url, offices.cover_variants,
 *    offices.marketing_video_url, and approved office_media rows confirms
 *    the path before serving it unauthenticated.
 *    Browser <img> and <video> tags cannot send Authorization headers, so
 *    this path is the only way for public pages to load media.
 *
 * 2. ALL OTHER RECOGNIZED OBJECTS — Gate 1: valid session required.
 *    Every recognized private path is bound to its owning office. Pending
 *    covers, unapproved/rejected gallery items, inactive-office media,
 *    verification documents, and unregistered upload claims are accessible
 *    only to that owner or an admin.
 *
 * 3. UNKNOWN PRIVATE PATHS — denied even to an authenticated user.
 *    Knowing an object path must never grant read access to a private bucket.
 */
router.get('/storage/objects/*path', async (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join('/') : raw;
    const objectPath = `/objects/${wildcardPath}`;

    // Fast path: approved public media is served without authentication.
    // This covers browser <img>/<video> tags on the public Decision Card and
    // Quick Card, which cannot carry Authorization headers.
    const isPublic = await isApprovedPublicMedia(objectPath);

    if (!isPublic) {
      // Gate 1: private objects require a valid session. Unauthenticated
      // callers — including <img> without an Authorization header and any
      // path not confirmed as approved public media — are rejected here.
      const user = req.session.user;
      if (!user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      // Gate 2: Every private path must be attributable to a known owner.
      // Service-request attachments are intentionally different from office
      // media: the request customer and assigned office may both access them,
      // while their object paths remain private and never join the public-media
      // allowlist above.
      const ownership = await db.execute(sql`
        SELECT office_id, request_id, customer_id FROM (
          SELECT office_id, NULL::integer AS request_id, NULL::integer AS customer_id
            FROM office_verification_documents
            WHERE object_path = ${objectPath}
          UNION ALL
          SELECT office_id, NULL::integer AS request_id, NULL::integer AS customer_id
            FROM upload_claims
            WHERE object_path = ${objectPath}
          UNION ALL
          SELECT office_id, NULL::integer AS request_id, NULL::integer AS customer_id
            FROM office_media
            WHERE url = ${objectPath}
              OR (variants IS NOT NULL AND variants::text LIKE ${'%' + objectPath + '%'})
          UNION ALL
          SELECT id AS office_id, NULL::integer AS request_id, NULL::integer AS customer_id
            FROM offices
            WHERE cover_url = ${objectPath}
              OR marketing_video_url = ${objectPath}
              OR (
                cover_variants IS NOT NULL
                AND cover_variants::text LIKE ${'%' + objectPath + '%'}
              )
          UNION ALL
          SELECT request.office_id, request.id AS request_id, request.customer_id
            FROM service_request_attachments attachment
            INNER JOIN service_requests request ON request.id = attachment.request_id
            WHERE attachment.object_path = ${objectPath}
          UNION ALL
          SELECT request.office_id, request.id AS request_id, request.customer_id
            FROM service_request_attachment_reservations reservation
            INNER JOIN service_requests request ON request.id = reservation.request_id
            WHERE reservation.object_path = ${objectPath}
        ) private_object_owners
        LIMIT 1
      `);
      const ownerRow = ownership.rows[0] as
        | { office_id: number; request_id: number | null; customer_id: number | null }
        | undefined;
      if (!ownerRow) {
        res.status(404).json({ error: 'Object not found' });
        return;
      }

      if (user.role !== 'admin') {
        const isRequestCustomer =
          ownerRow.request_id !== null && ownerRow.customer_id === user.id && user.role === 'customer';
        const [requesterOffice] = await db
          .select({ id: officesTable.id })
          .from(officesTable)
          .where(eq(officesTable.userId, user.id));
        const isRequestOffice =
          user.role === 'office' && requesterOffice?.id === ownerRow.office_id;
        const isOfficeOwnedObject =
          ownerRow.request_id === null && isRequestOffice;
        if (!isRequestCustomer && !isRequestOffice && !isOfficeOwnedObject) {
          res.status(403).json({ error: 'Forbidden' });
          return;
        }
      }
    }

    const objectFile =
      await objectStorageService.getObjectEntityFile(objectPath);

    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(
        response.body as ReadableStream<Uint8Array>,
      );
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, 'Object not found');
      res.status(404).json({ error: 'Object not found' });
      return;
    }
    req.log.error({ err: error }, 'Error serving object');
    res.status(500).json({ error: 'Failed to serve object' });
  }
});

export default router;

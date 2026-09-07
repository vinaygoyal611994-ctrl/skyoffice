import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  officesTable,
  officeServicesTable,
  officeMediaTable,
  officeVerificationDocumentsTable,
  uploadClaimsTable,
  defaultSpokenLanguageCodes,
  type MediaPlacement,
} from "@workspace/db";
import { and, eq, gt, ilike, inArray, or, sql } from "drizzle-orm";
import { expandCitySynonyms } from "../lib/citySynonyms";
// Phase 1 analytics imports — fire-and-forget; never affect response path
import { fireAnalyticsEvent, extractRequestContext } from "../lib/analyticsWriter";
import { getOrCreateVisitorId, readVisitorId, resolveSource } from "../lib/visitorSession";
import {
  normalizeSearchQuery,
  classifyCityId,
  classifyCategoryId,
  classifySearchIntent,
  detectQueryLanguage,
} from "../lib/searchNormalizer";
import { buildRankOrderBy, haversineKm } from "../lib/ranking";
import {
  ListOfficesQueryParams,
  ListOfficesResponse,
  GetOfficeParams,
  GetOfficeResponse,
  GetMyOfficeResponse,
  UpdateMyOfficeBody,
  UpdateMyOfficeWorksVisibilityBody,
  UpdateMyOfficeResponse,
  AddMyOfficeServiceBody,
  AddMyOfficeServiceResponse,
  RemoveMyOfficeServiceParams,
  AddMyOfficeMediaBody,
  AddMyOfficeMediaResponse,
  RemoveMyOfficeMediaParams,
  SetMyOfficeMarketingVideoBody,
  SetMyOfficeMarketingVideoResponse,
  RemoveMyOfficeMarketingVideoResponse,
  ListMyOfficeDocumentsResponse,
  AddMyOfficeDocumentBody,
  AddMyOfficeDocumentResponse,
  RemoveMyOfficeDocumentParams,
  SubmitMyOfficeApplicationResponse,
  SetMyOfficePrimaryMediaParams,
  SetMyOfficePrimaryMediaResponse,
} from "@workspace/api-zod";
import {
  serializeOfficeSummary,
  serializeOfficeProfile,
  serializePublicOfficeProfile,
  loadServiceTagsByOfficeId,
  batchLoadTrustMetrics,
  serializeVerificationDocument,
  loadDocumentsByOfficeId,
} from "../lib/officeSerializer";
import { verifyObjectReadable, ObjectStorageService } from "../lib/objectStorage";
import { verifyMarketingVideoFile } from "../lib/marketingVideoProbe";
import {
  processAndStoreVariants,
  deleteImageVariants,
  type ImageVariants,
  type ImageVariantCategory,
} from "../lib/imageProcessor";

const objectStorageService = new ObjectStorageService();

// Mirrors storage.ts's UPLOAD_LIMITS.marketing_video — defense in depth in
// case this endpoint is hit directly with a fabricated body. Duration is
// independently verified from the uploaded MP4 bytes below.
const MARKETING_VIDEO_MAX_BYTES = 80 * 1024 * 1024;
const MARKETING_VIDEO_MAX_SECONDS = 75;

const UPLOAD_LIMITS: Record<string, { contentTypes: string[]; maxSizeBytes: number }> = {
  cover: { contentTypes: ["image/jpeg", "image/png", "image/webp"], maxSizeBytes: 8 * 1024 * 1024 },
  gallery_image: { contentTypes: ["image/jpeg", "image/png", "image/webp"], maxSizeBytes: 8 * 1024 * 1024 },
  works_image: { contentTypes: ["image/jpeg", "image/png", "image/webp"], maxSizeBytes: 8 * 1024 * 1024 },
  gallery_video: { contentTypes: ["video/mp4", "video/webm", "video/quicktime"], maxSizeBytes: 100 * 1024 * 1024 },
  marketing_video: { contentTypes: ["video/mp4"], maxSizeBytes: MARKETING_VIDEO_MAX_BYTES },
  document: { contentTypes: ["application/pdf", "image/jpeg", "image/png"], maxSizeBytes: 15 * 1024 * 1024 },
  quick_card_cover: { contentTypes: ["image/jpeg", "image/png", "image/webp"], maxSizeBytes: 8 * 1024 * 1024 },
  decision_card_cover: { contentTypes: ["image/jpeg", "image/png", "image/webp"], maxSizeBytes: 8 * 1024 * 1024 },
};

/**
 * Validates a single-use upload reservation and the actual S3 object. Claims
 * are consumed only after HEAD validation, and before registration, so a path
 * can never be replayed into another office record.
 */
async function validateAndConsumeUploadClaim(
  office: { id: number },
  userId: number,
  objectPath: string,
  allowedCategories: string[],
  consume = true,
  database: Pick<typeof db, "select" | "delete"> = db,
): Promise<
  | { ok: true; contentType: string; contentLength: number }
  | { ok: false; status: number; error: string; code: string }
> {
  const [claim] = await database
    .select()
    .from(uploadClaimsTable)
    .where(eq(uploadClaimsTable.objectPath, objectPath));
  if (!claim) {
    return { ok: false, status: 400, error: "No valid upload claim exists for this file", code: "no_upload_claim" };
  }
  if (claim.userId !== userId || claim.officeId !== office.id) {
    return { ok: false, status: 403, error: "Upload claim belongs to a different office", code: "claim_office_mismatch" };
  }
  if (claim.expiresAt <= new Date()) {
    await database.delete(uploadClaimsTable).where(eq(uploadClaimsTable.id, claim.id));
    return { ok: false, status: 400, error: "Upload claim has expired", code: "claim_expired" };
  }
  if (!allowedCategories.includes(claim.category)) {
    return { ok: false, status: 400, error: "Upload claim category does not match this registration", code: "claim_category_mismatch" };
  }
  const limit = UPLOAD_LIMITS[claim.category];
  let contentType: string;
  let contentLength: number;
  try {
    const metadata = await objectStorageService.getObjectEntityMetadata(objectPath);
    if (!metadata.contentType || !limit.contentTypes.includes(metadata.contentType)) {
      return { ok: false, status: 400, error: "Uploaded file type is not allowed", code: "invalid_file_type" };
    }
    if (metadata.contentLength === undefined || metadata.contentLength > limit.maxSizeBytes) {
      return { ok: false, status: 400, error: "Uploaded file is too large", code: "file_too_large" };
    }
    contentType = metadata.contentType;
    contentLength = metadata.contentLength;
  } catch {
    return { ok: false, status: 400, error: "Uploaded file could not be confirmed readable in storage", code: "file_not_readable" };
  }
  if (!consume) return { ok: true, contentType, contentLength };
  // Conditional delete is the compare-and-swap that makes concurrent
  // registrations safe: precisely one request can consume this reservation.
  const consumed = await database
    .delete(uploadClaimsTable)
    .where(
      and(
        eq(uploadClaimsTable.id, claim.id),
        eq(uploadClaimsTable.userId, userId),
        eq(uploadClaimsTable.officeId, office.id),
        eq(uploadClaimsTable.objectPath, objectPath),
        gt(uploadClaimsTable.expiresAt, new Date()),
      ),
    )
    .returning({ id: uploadClaimsTable.id });
  if (consumed.length === 0) {
    return { ok: false, status: 400, error: "No valid upload claim exists for this file", code: "no_upload_claim" };
  }
  return { ok: true, contentType, contentLength };
}

// Statuses where the office's public profile is already live/decided.
// Direct edits are locked; changes are staged as a pending revision instead
// and only take effect once an admin approves them (item 2 of the audit).
const LOCKED_EDIT_STATUSES = ["approved", "active", "suspended"] as const;
import { requireRole } from "../middlewares/authMiddleware";
import { recordAuditLog } from "../lib/auditLog";
import {
  checkMarketGateForOffice,
  checkFullGate,
  buildMarketClosedError,
  buildCapFullError,
  type FullGateOutcome,
} from "../lib/marketGate";

const router: IRouter = Router();

/** Close gaps after an eligible Works item is removed. */
async function normalizePlacementOrdering(
  officeId: number,
  placement: "decision_gallery" | "works",
  database: Pick<typeof db, "select" | "update"> = db,
): Promise<void> {
  const rows = await database
    .select({ id: officeMediaTable.id, sortOrder: officeMediaTable.sortOrder })
    .from(officeMediaTable)
    .where(and(
      eq(officeMediaTable.officeId, officeId),
      eq(officeMediaTable.placement, placement),
      sql`${officeMediaTable.status} != 'rejected'`,
    ));
  await Promise.all(
    rows
      .sort((a, b) => (a.sortOrder ?? a.id) - (b.sortOrder ?? b.id))
      .map((row, index) =>
        database.update(officeMediaTable).set({ sortOrder: index + 1 })
          .where(eq(officeMediaTable.id, row.id)),
      ),
  );
}

router.get("/offices", async (req: Request, res: Response): Promise<void> => {
  const parsed = ListOfficesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const {
    category,
    search,
    verifiedOnly,
    providerType,
    sort,
    latitude,
    longitude,
    city,
    country,
    page,
    limit,
  } = parsed.data;

  // Only offices that have completed the approval workflow and been
  // activated by an admin are visible to the public — draft, under review,
  // changes-requested, approved-but-not-active, rejected, and suspended
  // offices must never appear in public discovery/search.
  // Demo offices (is_demo = true) are internal seed/QA data and must
  // never appear on the public listing regardless of their status.
  const conditions = [
    eq(officesTable.status, "active"),
    eq(officesTable.providerType, providerType),
    sql`${officesTable.isDemo} IS NOT TRUE`,
    // Offices hidden due to non-payment must not appear in public discovery.
    // is_subscription_hidden defaults to false for all existing offices.
    eq(officesTable.isSubscriptionHidden, false),
  ];
  if (category) conditions.push(eq(officesTable.category, category));
  if (verifiedOnly) conditions.push(eq(officesTable.isVerified, true));
  if (country) conditions.push(ilike(officesTable.country, country));
  if (search && search.trim() !== "") {
    const trimmed = search.trim();
    const term = `%${trimmed}%`;
    // Match both the English and Arabic office name, and the city column
    // against the typed term plus any known cross-language city synonyms
    // (see citySynonyms.ts) so a search typed in either language can find
    // offices whose name/city happens to be stored in the other language.
    const cityTerms = [term, ...expandCitySynonyms(trimmed).map((c) => `%${c}%`)];
    const searchCondition = or(
      ilike(officesTable.name, term),
      ilike(officesTable.nameAr, term),
      ...cityTerms.map((t) => ilike(officesTable.city, t)),
    );
    if (searchCondition) conditions.push(searchCondition);
  }

  const whereClause = and(...conditions);

  // Count total results for pagination metadata (runs in parallel with fetch)
  const [countResult, rankedOffices] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(officesTable)
      .where(whereClause),
    db
      .select()
      .from(officesTable)
      .where(whereClause)
      .orderBy(
        ...buildRankOrderBy({ sort, lat: latitude, lon: longitude, city }),
      )
      .limit(limit)
      .offset((page - 1) * limit),
  ]);

  const total = countResult[0]?.count ?? 0;

  const officeIds = rankedOffices.map((o) => o.id);
  const [serviceTags, trustMetricsMap] = await Promise.all([
    loadServiceTagsByOfficeId(officeIds),
    batchLoadTrustMetrics(officeIds),
  ]);

  const items = rankedOffices.map((office) => {
    let distance: number | null = null;
    if (
      latitude !== undefined &&
      longitude !== undefined &&
      office.latitude !== null &&
      office.longitude !== null
    ) {
      // Round to one decimal place for display; avoids spurious precision
      distance =
        Math.round(haversineKm(latitude, longitude, office.latitude, office.longitude) * 10) / 10;
    }
    return serializeOfficeSummary(
      office,
      serviceTags.get(office.id) ?? [],
      distance,
      trustMetricsMap.get(office.id),
    );
  });

  // HIGH-03: public listing is safe to cache at the edge / in the browser.
  // 60 s max-age lets CDN/proxy cache serve most discovery page loads; SWR
  // allows stale data while the cache refetches so the client never blocks.
  res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=30");
  res.json(ListOfficesResponse.parse({ items, total, page, limit }));

  // Phase 1 analytics: track search_performed (fire-and-forget, after response)
  if (search && search.trim()) {
    try {
      const ctx = extractRequestContext(req);
      const raw = search.trim();
      const normalized = normalizeSearchQuery(raw);
      const cityId = city
        ? city.toLowerCase().replace(/\s+/g, "_")
        : (classifyCityId(normalized) ?? undefined);
      const categoryId = category ?? (classifyCategoryId(normalized) ?? undefined);
      const intentResult = classifySearchIntent(normalized);
      const detectedLang = detectQueryLanguage(raw);
      const visitorId = readVisitorId(req);

      fireAnalyticsEvent({
        eventName: "search_performed",
        visitorId: visitorId ?? undefined,
        authenticatedUserId: ctx.authenticatedUserId ?? undefined,
        searchSessionId: ctx.searchSessionId ?? undefined,
        countryCode: country?.toUpperCase() ?? undefined,
        cityId,
        categoryId,
        searchQueryOriginal: raw,
        searchQueryNormalized: normalized,
        searchResultsCount: total,
        detectedLanguage: detectedLang ?? undefined,
        inputMethod: "typed",
        searchIntent: intentResult.intent,
        intentConfidence: intentResult.confidence > 0 ? intentResult.confidence : undefined,
        interfaceLanguage: ctx.interfaceLanguage ?? undefined,
        deviceCategory: ctx.deviceCategory ?? undefined,
        osFamily: ctx.osFamily ?? undefined,
        browserFamily: ctx.browserFamily ?? undefined,
        isBot: ctx.isBot,
        botDetectionVersion: ctx.botDetectionVersion,
        exclusionReason: ctx.exclusionReason ?? undefined,
        referrerDomain: ctx.referrerDomain ?? undefined,
        utmSource: ctx.utmSource ?? undefined,
        utmMedium: ctx.utmMedium ?? undefined,
        utmCampaign: ctx.utmCampaign ?? undefined,
        qrCampaignId: ctx.qrCampaignId ?? undefined,
      });
    } catch {
      // Never block the response path
    }
  }
});

router.get(
  "/offices/me",
  requireRole("office"),
  async (req: Request, res: Response): Promise<void> => {
    const [office] = await db
      .select()
      .from(officesTable)
      .where(eq(officesTable.userId, req.session.user!.id));

    if (!office) {
      res.status(401).json({ error: "Office profile not found" });
      return;
    }

    // Return serializer output directly — the generated response schemas use
    // .and() (ZodIntersection) which does not support .passthrough(), and
    // response parsing provides no security benefit (serializer guarantees shape).
    res.json(await serializeOfficeProfile(office));
  },
);

router.patch(
  "/offices/me/works-visibility",
  requireRole("office"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = UpdateMyOfficeWorksVisibilityBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [office] = await db
      .update(officesTable)
      .set({ worksEnabled: parsed.data.enabled })
      .where(eq(officesTable.userId, req.session.user!.id))
      .returning();

    if (!office) {
      res.status(401).json({ error: "Office profile not found" });
      return;
    }

    await recordAuditLog({
      actor: req.session.user,
      action: "office.works_visibility.update",
      targetType: "office",
      targetId: office.id,
      metadata: { enabled: parsed.data.enabled },
    });

    res.json(await serializeOfficeProfile(office));
  },
);

router.patch(
  "/offices/me",
  requireRole("office"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = UpdateMyOfficeBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    if (parsed.data.name !== undefined) {
      parsed.data.name = parsed.data.name.trim();
      if (!parsed.data.name) {
        res.status(400).json({ error: "Office name cannot be blank" });
        return;
      }
      if (parsed.data.name === "Draft Office" || parsed.data.name === "مكتب جديد") {
        res.status(400).json({ error: "Placeholder office names are not allowed" });
        return;
      }
    }
    if (parsed.data.nameAr !== undefined && parsed.data.nameAr !== null) {
      parsed.data.nameAr = parsed.data.nameAr.trim();
      if (parsed.data.nameAr === "مكتب جديد" || parsed.data.nameAr === "Draft Office") {
        res.status(400).json({ error: "Placeholder office names are not allowed" });
        return;
      }
      parsed.data.nameAr = parsed.data.nameAr || null;
    }

    if (
      parsed.data.spokenLanguages &&
      parsed.data.spokenLanguages.some(
        (code) =>
          !defaultSpokenLanguageCodes.includes(
            code as (typeof defaultSpokenLanguageCodes)[number],
          ),
      )
    ) {
      res.status(400).json({ error: "Unrecognized spoken language code" });
      return;
    }

    const [existing] = await db
      .select()
      .from(officesTable)
      .where(eq(officesTable.userId, req.session.user!.id));
    if (!existing) {
      res.status(401).json({ error: "Office profile not found" });
      return;
    }

    if (existing.status === "under_review") {
      res.status(400).json({
        error:
          "Your application is under review and cannot be edited until an admin makes a decision.",
      });
      return;
    }

    // Determine whether this office's edits will be staged for admin review
    // (locked) or applied directly to the live row (unlocked).  This must be
    // decided before the readability check because the appropriate behaviour
    // differs: direct updates need immediate readability (the image goes live
    // right away), but pending-change updates do not — the admin review process
    // gives GCS plenty of time to propagate the object before it ever appears
    // publicly.  Running verifyObjectReadable before this split caused a
    // systematic 400 "file_not_readable" for every cover/logo upload on active
    // offices: the Uppy onComplete fires within milliseconds of the GCS PUT
    // completing, but GCS object propagation can take 3-4 s.  Because
    // ObjectNotFoundError short-circuits immediately (no retries), the check
    // consistently returned false even for objects that were successfully
    // uploaded, so coverUrl was never staged in pendingChanges.
    const isLocked = LOCKED_EDIT_STATUSES.includes(
      existing.status as (typeof LOCKED_EDIT_STATUSES)[number],
    );

    // Legacy clients can still send coverUrl through the generic profile
    // endpoint. Treat it exactly like the dedicated cover endpoint; otherwise
    // an office could point its public card at an arbitrary private object.
    if (parsed.data.coverUrl) {
      const claimValidation = await validateAndConsumeUploadClaim(
        existing,
        req.session.user!.id,
        parsed.data.coverUrl,
        ["quick_card_cover", "cover"],
      );
      if (!claimValidation.ok) {
        res.status(claimValidation.status).json({
          error: claimValidation.error,
          code: claimValidation.code,
        });
        return;
      }
    }

    // For direct updates only: verify uploaded image is readable before
    // accepting the URL.  Skipping this for locked offices is safe because
    // changes don't go live until an admin approves them.
    if (!isLocked) {
      for (const [field, objectPath] of [
        ["coverUrl", parsed.data.coverUrl],
      ] as const) {
        if (objectPath && !(await verifyObjectReadable(objectPath))) {
          res.status(400).json({
            error: `Uploaded file for "${field}" could not be confirmed readable in storage. Please try uploading it again.`,
            code: "file_not_readable",
          });
          return;
        }
      }
    }

    if (isLocked) {
      // Public-facing data must stay stable once approved/active/suspended.
      // Stage the edit as a pending revision instead of mutating the live row;
      // an admin must approve it before it takes effect.
      //
      // Note: freelancerImageStyle is stripped from pendingData above; the
      // personal-photo feature has been removed so this field is no-op.
      const {
        // Strip coverUrl from the pendingChanges blob — the new
        // PATCH /offices/me/quick-card-cover endpoint handles it via the
        // dedicated pending_quick_card_cover column. If a legacy client sends
        // coverUrl here, redirect it to that column rather than losing the upload.
        coverUrl: legacyCoverUrl,
        // Strip freelancerImageStyle — the personal-photo feature has been
        // removed; discard this field silently so legacy clients don't
        // accidentally stage it as a pending change.
        freelancerImageStyle: _discardedFis,
        ...pendingData
      } = parsed.data;

      let latestOffice = existing;

      // If a legacy client sent coverUrl, route it to the pending_quick_card_cover
      // column instead of staging it in the pendingChanges blob. This is a
      // graceful backward-compat shim — new clients should use the dedicated
      // PATCH /offices/me/quick-card-cover endpoint.
      if (legacyCoverUrl) {
        const [fisUpdated] = await db
          .update(officesTable)
          .set({
            pendingQuickCardCoverUrl: legacyCoverUrl,
            pendingMediaSubmittedAt: new Date(),
            pendingMediaRejectionReason: null,
          })
          .where(eq(officesTable.id, existing.id))
          .returning();
        latestOffice = fisUpdated;
      }

      // Stage remaining changes as a pending revision (if any), merging
      // with whatever is already staged.  Without this merge a cover-image
      // upload (PATCH { coverUrl }) followed immediately by a profile-text
      // save (PATCH { name, city, … }) — or the reverse — would silently
      // discard the first change because each call previously replaced the
      // pendingChanges blob in full.
      if (Object.keys(pendingData).length > 0) {
        const existingPending: Record<string, unknown> = existing.pendingChanges
          ? (JSON.parse(existing.pendingChanges) as Record<string, unknown>)
          : {};
        // The dashboard submits a complete form. Do not turn unchanged identity
        // fields into new requests, and do not let them collide with an already
        // pending rename while the provider saves unrelated profile fields.
        if (pendingData.name === existing.name) delete pendingData.name;
        if (pendingData.nameAr === existing.nameAr) delete pendingData.nameAr;
        if (pendingData.category === existing.category) delete pendingData.category;
        if (
          typeof existingPending.name === "string" &&
          typeof pendingData.name === "string" &&
          existingPending.name !== pendingData.name
        ) {
          res.status(409).json({
            error: "A different office-name change is already pending review.",
            code: "name_change_pending",
          });
          return;
        }
        if (
          Object.prototype.hasOwnProperty.call(existingPending, "nameAr") &&
          Object.prototype.hasOwnProperty.call(pendingData, "nameAr") &&
          existingPending.nameAr !== pendingData.nameAr
        ) {
          res.status(409).json({
            error: "A different Arabic office-name change is already pending review.",
            code: "name_change_pending",
          });
          return;
        }
        const mergedPending = { ...existingPending, ...pendingData };
        const [updated] = await db
          .update(officesTable)
          .set({
            pendingChanges: JSON.stringify(mergedPending),
            pendingChangesSubmittedAt: new Date(),
          })
          .where(eq(officesTable.id, existing.id))
          .returning();
        latestOffice = updated;
      }

      await recordAuditLog({
        actor: req.session.user,
        action: "office.pending_changes.submit",
        targetType: "office",
        targetId: latestOffice.id,
        metadata: {
          ...(typeof pendingData.name === "string" && pendingData.name !== existing.name
            ? {
                identityChange: "name",
                previousName: existing.name,
                newName: pendingData.name,
                requestedAt: new Date().toISOString(),
                requesterId: req.session.user!.id,
              }
            : {}),
          ...(typeof pendingData.category === "string" && pendingData.category !== existing.category
            ? {
                categoryChange: true,
                previousCategory: existing.category,
                newCategory: pendingData.category,
              }
            : {}),
        },
      });

      res.json(await serializeOfficeProfile(latestOffice));
      return;
    }

    const [office] = await db
      .update(officesTable)
      .set(parsed.data)
      .where(eq(officesTable.id, existing.id))
      .returning();

    res.json(await serializeOfficeProfile(office));
  },
);

router.post(
  "/offices/me/services",
  requireRole("office"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = AddMyOfficeServiceBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [office] = await db
      .select()
      .from(officesTable)
      .where(eq(officesTable.userId, req.session.user!.id));
    if (!office) {
      res.status(401).json({ error: "Office profile not found" });
      return;
    }

    const [service] = await db
      .insert(officeServicesTable)
      .values({ officeId: office.id, name: parsed.data.name })
      .returning();

    res.status(201).json(AddMyOfficeServiceResponse.parse(service));
  },
);

router.delete(
  "/offices/me/services/:serviceId",
  requireRole("office"),
  async (req: Request, res: Response): Promise<void> => {
    const params = RemoveMyOfficeServiceParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [office] = await db
      .select()
      .from(officesTable)
      .where(eq(officesTable.userId, req.session.user!.id));
    if (!office) {
      res.status(401).json({ error: "Office profile not found" });
      return;
    }

    const [deleted] = await db
      .delete(officeServicesTable)
      .where(
        and(
          eq(officeServicesTable.id, params.data.serviceId),
          eq(officeServicesTable.officeId, office.id),
        ),
      )
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "Service not found" });
      return;
    }

    res.sendStatus(204);
  },
);

router.post(
  "/offices/me/media",
  requireRole("office"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = AddMyOfficeMediaBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    // Omission is retained solely for legacy clients; generated enum validation
    // rejects unknown values rather than silently mapping them to gallery.
    const placement: MediaPlacement = parsed.data.placement ?? "decision_gallery";

    const [office] = await db
      .select()
      .from(officesTable)
      .where(eq(officesTable.userId, req.session.user!.id));
    if (!office) {
      res.status(401).json({ error: "Office profile not found" });
      return;
    }

    // Works allocation is serialized per office.  Preflight validates the
    // reservation without consuming it; this means a full portfolio never
    // burns a valid upload claim or creates image variants.
    if (placement === "works") {
      if (parsed.data.type !== "image") {
        res.status(400).json({ error: "Works accepts images only.", code: "works_image_only" });
        return;
      }
      const preflight = await validateAndConsumeUploadClaim(
        office, req.session.user!.id, parsed.data.objectPath, ["works_image"], false,
      );
      if (!preflight.ok) {
        res.status(preflight.status).json({ error: preflight.error, code: preflight.code });
        return;
      }
      const outcome = await db.transaction(async (tx) => {
        // 119 is the namespace for the Works placement.  xact locks are
        // released automatically on both commit and rollback.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${office.id}, 119)`);
        const [{ worksCount }] = await tx
          .select({ worksCount: sql<number>`count(*)::int` })
          .from(officeMediaTable)
          .where(and(
            eq(officeMediaTable.officeId, office.id),
            eq(officeMediaTable.placement, "works"),
            sql`${officeMediaTable.status} != 'rejected'`,
          ));
        if (worksCount >= 4) return { kind: "limit" as const };

        const claim = await validateAndConsumeUploadClaim(
          office, req.session.user!.id, parsed.data.objectPath, ["works_image"], true, tx,
        );
        if (!claim.ok) return { kind: "claim" as const, claim };

        let cropRegion: { left: number; top: number; width: number; height: number } | undefined;
        const rawCrop = (req.body as Record<string, unknown>).cropRegion;
        if (rawCrop && typeof rawCrop === "object" && !Array.isArray(rawCrop)) {
          const crop = rawCrop as Record<string, unknown>;
          const left = Number(crop.left);
          const top = Number(crop.top);
          const width = Number(crop.width);
          const height = Number(crop.height);
          if (
            Number.isFinite(left) && left >= 0 &&
            Number.isFinite(top) && top >= 0 &&
            Number.isFinite(width) && width > 0 &&
            Number.isFinite(height) && height > 0
          ) {
            cropRegion = { left, top, width, height };
          }
        }
        const result = await processAndStoreVariants(
          parsed.data.objectPath,
          "works",
          objectStorageService,
          cropRegion ? { cropRegion } : undefined,
        );
        if (!result.ok) return { kind: "image" as const, result };

        const [{ maxOrder }] = await tx
          .select({ maxOrder: sql<number | null>`max(sort_order)` })
          .from(officeMediaTable)
          .where(and(
            eq(officeMediaTable.officeId, office.id),
            eq(officeMediaTable.placement, "works"),
          ));
        const [media] = await tx.insert(officeMediaTable).values({
          officeId: office.id,
          url: result.variants.display ?? result.variants.thumbnail,
          type: "image",
          placement: "works",
          status: LOCKED_EDIT_STATUSES.includes(
            office.status as (typeof LOCKED_EDIT_STATUSES)[number],
          ) ? "pending_review" : "approved",
          variants: result.variants,
          sortOrder: (maxOrder ?? 0) + 1,
        }).returning();
        return { kind: "media" as const, media };
      });
      if (outcome.kind === "limit") {
        res.status(400).json({
          error: "Maximum of 4 Works images reached. Delete or wait for review of an existing item before uploading another.",
          code: "works_limit_reached",
        });
        return;
      }
      if (outcome.kind === "claim") {
        res.status(outcome.claim.status).json({ error: outcome.claim.error, code: outcome.claim.code });
        return;
      }
      if (outcome.kind === "image") {
        res.status(outcome.result.status).json({ error: outcome.result.error, code: outcome.result.code });
        return;
      }
      await recordAuditLog({
        actor: req.session.user,
        action: "office.media.upload",
        targetType: "office",
        targetId: office.id,
        metadata: { placement, status: outcome.media.status },
      });
      res.status(201).json(AddMyOfficeMediaResponse.parse(outcome.media));
      return;
    }

    const allowedCategories =
      placement === "decision_card_cover"
        ? ["decision_card_cover"]
        : parsed.data.type === "video"
          ? ["gallery_video"]
          : ["gallery_image"];
    const claimValidation = await validateAndConsumeUploadClaim(
      office,
      req.session.user!.id,
      parsed.data.objectPath,
      allowedCategories,
    );
    if (!claimValidation.ok) {
      res.status(claimValidation.status).json({
        error: claimValidation.error,
        code: claimValidation.code,
      });
      return;
    }

    // Determine whether this office is locked (approved / active / suspended).
    // For locked offices, new gallery/cover items go into pending_review so an
    // admin must approve them before they appear publicly.
    const isLocked = LOCKED_EDIT_STATUSES.includes(
      office.status as (typeof LOCKED_EDIT_STATUSES)[number],
    );

    // ── Decision Card image slot limits ──────────────────────────────────────
    // Slot 1 (decision_card_cover): only one pending replacement at a time.
    // Slots 2–4 (decision_gallery): max 3 non-rejected rows across the office.
    if (placement === "decision_card_cover") {
      const [{ pendingCount }] = await db
        .select({ pendingCount: sql<number>`count(*)::int` })
        .from(officeMediaTable)
        .where(
          and(
            eq(officeMediaTable.officeId, office.id),
            eq(officeMediaTable.placement, "decision_card_cover"),
            eq(officeMediaTable.status, "pending_review"),
          ),
        );
      if (pendingCount > 0) {
        res.status(400).json({
          error:
            "A replacement for the main Decision Card image is already pending review. Wait for it to be approved or rejected before submitting another.",
          code: "cover_pending_exists",
        });
        return;
      }
    }

    if (placement === "decision_gallery") {
      const [{ galleryCount }] = await db
        .select({ galleryCount: sql<number>`count(*)::int` })
        .from(officeMediaTable)
        .where(
          and(
            eq(officeMediaTable.officeId, office.id),
            eq(officeMediaTable.placement, placement),
            sql`${officeMediaTable.status} != 'rejected'`,
          ),
        );
      if (galleryCount >= 3) {
        res.status(400).json({
          error:
            "Maximum of 3 additional Decision Card images reached (slots 2–4 are full). Delete an existing image to upload a new one.",
          code: "gallery_limit_reached",
        });
        return;
      }
    }

    // ── Sort order for gallery inserts ───────────────────────────────────────
    // Assign the next sort_order so gallery items always render in the
    // owner-defined sequence regardless of insertion timing.
    let nextSortOrder: number | null = null;
    if (placement === "decision_gallery") {
      const [{ maxOrder }] = await db
        .select({ maxOrder: sql<number | null>`max(sort_order)` })
        .from(officeMediaTable)
        .where(
          and(
            eq(officeMediaTable.officeId, office.id),
            eq(officeMediaTable.placement, placement),
          ),
        );
      nextSortOrder = (maxOrder ?? 0) + 1;
    }

    // Note: verifyObjectReadable is intentionally NOT called here.
    // GCS propagation after a signed-URL PUT takes 3.5–4 s, but Uppy's
    // onComplete fires within milliseconds of the PUT returning HTTP 200.
    // The object path was generated by our signed-URL endpoint (not
    // user-supplied) and the PUT returned 200, so the file exists in GCS.
    // Items are correctly routed to pending_review vs. approved via isLocked.

    // ── Image processing ──────────────────────────────────────────────────
    // For image type items: validate format, strip all EXIF/GPS metadata,
    // auto-correct orientation, and generate optimised WebP variants.
    // Videos are stored as-is — no server-side video processing.
    let mediaUrl = parsed.data.objectPath;
    let mediaVariants: unknown = null;

    if (parsed.data.type === "image") {
      const imgCategory: ImageVariantCategory =
        placement === "decision_card_cover"
          ? "decision_card_cover"
          : "decision_gallery";

      // Parse an optional cropRegion sent by the crop dialog.
      // Forwarded to processAndStoreVariants for decision_card_cover (7:3)
      // and decision_gallery (7:3); both render in the same MarketingScreen
      // aspect-[7/3] container and use identical output dimensions.
      let cropRegion: { left: number; top: number; width: number; height: number } | undefined;
      const rawCrop = (req.body as Record<string, unknown>).cropRegion;
      if (rawCrop && typeof rawCrop === "object" && !Array.isArray(rawCrop)) {
        const c = rawCrop as Record<string, unknown>;
        const left = Number(c.left);
        const top = Number(c.top);
        const width = Number(c.width);
        const height = Number(c.height);
        if (
          Number.isFinite(left) && left >= 0 &&
          Number.isFinite(top) && top >= 0 &&
          Number.isFinite(width) && width > 0 &&
          Number.isFinite(height) && height > 0
        ) {
          cropRegion = { left, top, width, height };
        }
      }

      const result = await processAndStoreVariants(
        parsed.data.objectPath,
        imgCategory,
        objectStorageService,
        cropRegion ? { cropRegion } : undefined,
      );
      if (!result.ok) {
        res.status(result.status).json({ error: result.error, code: result.code });
        return;
      }
      // Store the display variant as the primary url.
      // Original is preserved privately inside the variants JSONB.
      mediaUrl = result.variants.display ?? result.variants.thumbnail;
      mediaVariants = result.variants;
    }

    const [media] = await db
      .insert(officeMediaTable)
      .values({
        officeId: office.id,
        url: mediaUrl,
        type: parsed.data.type,
        placement,
        status: isLocked ? "pending_review" : "approved",
        variants: mediaVariants,
        sortOrder: nextSortOrder,
      })
      .returning();

    await recordAuditLog({
      actor: req.session.user,
      action: "office.media.upload",
      targetType: "office",
      targetId: office.id,
      metadata: { placement, status: media.status },
    });

    res.status(201).json(AddMyOfficeMediaResponse.parse(media));
  },
);

// Sets or updates the pending quick-card-cover URL for this office.
// For draft/changes_requested offices this goes live immediately (as coverUrl).
// For locked (approved/active/suspended) offices it is staged for admin review.
router.patch(
  "/offices/me/quick-card-cover",
  requireRole("office"),
  async (req: Request, res: Response): Promise<void> => {
    const body = req.body as Record<string, unknown>;
    const objectPath = typeof body.objectPath === "string" && body.objectPath.trim() ? body.objectPath.trim() : null;
    if (!objectPath) {
      res.status(400).json({ error: "objectPath is required" });
      return;
    }

    // Optional user-specified crop region in natural image pixels.
    // Validated further in processAndStoreVariants; malformed values are
    // silently discarded and fall back to automatic center-crop.
    const rawCrop = body.cropRegion;
    let cropRegion: import("../lib/imageProcessor").CropRegion | undefined;
    if (rawCrop !== null && typeof rawCrop === "object" && !Array.isArray(rawCrop)) {
      const c = rawCrop as Record<string, unknown>;
      const left = Number(c.left);
      const top = Number(c.top);
      const width = Number(c.width);
      const height = Number(c.height);
      if (
        Number.isFinite(left) && left >= 0 &&
        Number.isFinite(top) && top >= 0 &&
        Number.isFinite(width) && width > 0 &&
        Number.isFinite(height) && height > 0
      ) {
        cropRegion = { left, top, width, height };
      }
    }

    const [office] = await db
      .select()
      .from(officesTable)
      .where(eq(officesTable.userId, req.session.user!.id));
    if (!office) {
      res.status(401).json({ error: "Office profile not found" });
      return;
    }

    const claimValidation = await validateAndConsumeUploadClaim(
      office,
      req.session.user!.id,
      objectPath,
      ["quick_card_cover", "cover"],
    );
    if (!claimValidation.ok) {
      res.status(claimValidation.status).json({
        error: claimValidation.error,
        code: claimValidation.code,
      });
      return;
    }

    const isLocked = LOCKED_EDIT_STATUSES.includes(
      office.status as (typeof LOCKED_EDIT_STATUSES)[number],
    );

    // ── Image processing ──────────────────────────────────────────────────
    // Validate, strip EXIF/GPS metadata, auto-rotate, and generate WebP variants
    // BEFORE writing anything to the database, so we never commit a failed upload.
    const processResult = await processAndStoreVariants(
      objectPath,
      "quick_card_cover",
      objectStorageService,
      { cropRegion },
    );
    if (!processResult.ok) {
      res.status(processResult.status).json({
        error: processResult.error,
        code: processResult.code,
      });
      return;
    }
    const { variants } = processResult;
    // The medium (1200×432) variant is the canonical cover URL; thumbnail
    // is retained in the variants blob for srcset / list-card optimisation.
    const processedCoverUrl = variants.medium!;

    if (isLocked) {
      // Stage the pending cover — admin must approve before it becomes coverUrl.
      // Clean up any existing pending cover variants first (best-effort).
      const oldPendingVariants = office.pendingQuickCardCoverVariants as ImageVariants | null;

      const [updated] = await db
        .update(officesTable)
        .set({
          pendingQuickCardCoverUrl: processedCoverUrl,
          pendingQuickCardCoverVariants: variants as unknown,
          pendingMediaSubmittedAt: new Date(),
          pendingMediaRejectionReason: null,
        })
        .where(eq(officesTable.id, office.id))
        .returning();

      // Clean up the replaced pending variants AFTER the DB write so the
      // new pending cover is always committed before any GCS deletion runs.
      await deleteImageVariants(oldPendingVariants, objectStorageService, req.log);

      await recordAuditLog({
        actor: req.session.user,
        action: "office.quick_card_cover.submit",
        targetType: "office",
        targetId: office.id,
      });

      res.json(await serializeOfficeProfile(updated));
    } else {
      // Draft / changes_requested: apply directly as coverUrl.
      // Clean up existing live cover variants first (best-effort).
      const oldCoverVariants = office.coverVariants as ImageVariants | null;

      const [updated] = await db
        .update(officesTable)
        .set({
          coverUrl: processedCoverUrl,
          coverVariants: variants as unknown,
        })
        .where(eq(officesTable.id, office.id))
        .returning();

      // Clean up the old cover GCS objects AFTER the DB write.
      await deleteImageVariants(oldCoverVariants, objectStorageService, req.log);

      await recordAuditLog({
        actor: req.session.user,
        action: "office.quick_card_cover.update",
        targetType: "office",
        targetId: office.id,
      });

      res.json(await serializeOfficeProfile(updated));
    }
  },
);

// Clears a pending quick-card-cover that hasn't been approved yet.
router.delete(
  "/offices/me/quick-card-cover/pending",
  requireRole("office"),
  async (req: Request, res: Response): Promise<void> => {
    const [office] = await db
      .select()
      .from(officesTable)
      .where(eq(officesTable.userId, req.session.user!.id));
    if (!office) {
      res.status(401).json({ error: "Office profile not found" });
      return;
    }

    if (!office.pendingQuickCardCoverUrl) {
      res.status(404).json({ error: "No pending quick-card cover to remove" });
      return;
    }

    // Capture pending variants before clearing so we can delete GCS objects.
    const pendingVariantsToDelete = office.pendingQuickCardCoverVariants as ImageVariants | null;

    const [updated] = await db
      .update(officesTable)
      .set({
        pendingQuickCardCoverUrl: null,
        pendingQuickCardCoverVariants: null,
        pendingMediaSubmittedAt: null,
        pendingMediaRejectionReason: null,
      })
      .where(eq(officesTable.id, office.id))
      .returning();

    // Clean up all GCS variant objects for the cancelled pending cover.
    await deleteImageVariants(pendingVariantsToDelete, objectStorageService, req.log);

    await recordAuditLog({
      actor: req.session.user,
      action: "office.quick_card_cover.cancel",
      targetType: "office",
      targetId: office.id,
    });

    res.json(await serializeOfficeProfile(updated));
  },
);

// Deletes the approved Quick Card cover image — clears coverUrl + coverVariants
// from the office row and best-effort removes the GCS objects.
// For freelancers, coverUrl points to a gallery item that must remain intact;
// only the DB pointer is cleared in that case, not the underlying file.
router.delete(
  "/offices/me/quick-card-image",
  requireRole("office"),
  async (req: Request, res: Response): Promise<void> => {
    const [office] = await db
      .select()
      .from(officesTable)
      .where(eq(officesTable.userId, req.session.user!.id));
    if (!office) {
      res.status(401).json({ error: "Office profile not found" });
      return;
    }

    if (!office.coverUrl) {
      res.status(404).json({ error: "No Quick Card image to remove" });
      return;
    }

    const coverVariantsToDelete = office.coverVariants as ImageVariants | null;
    // For offices the coverUrl is a standalone signed upload; for freelancers
    // it references a gallery media item — must not delete the underlying file.
    const rawCoverUrlToDelete =
      office.providerType !== "freelancer" ? office.coverUrl : null;

    const [updated] = await db
      .update(officesTable)
      .set({ coverUrl: null, coverVariants: null })
      .where(eq(officesTable.id, office.id))
      .returning();

    // Best-effort GCS cleanup — never fail the request over a storage hiccup.
    await deleteImageVariants(coverVariantsToDelete, objectStorageService, req.log);
    if (rawCoverUrlToDelete) {
      try {
        await objectStorageService.deleteObjectEntity(rawCoverUrlToDelete);
      } catch (err) {
        req.log.warn(
          { err, officeId: office.id },
          "Failed to clean up deleted Quick Card raw upload",
        );
      }
    }

    await recordAuditLog({
      actor: req.session.user,
      action: "office.quick_card_image.delete",
      targetType: "office",
      targetId: office.id,
    });

    res.json(await serializeOfficeProfile(updated));
  },
);

router.delete(
  "/offices/me/media/:mediaId",
  requireRole("office"),
  async (req: Request, res: Response): Promise<void> => {
    const params = RemoveMyOfficeMediaParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [office] = await db
      .select()
      .from(officesTable)
      .where(eq(officesTable.userId, req.session.user!.id));
    if (!office) {
      res.status(401).json({ error: "Office profile not found" });
      return;
    }

    const deleteWhere = and(
      eq(officeMediaTable.id, params.data.mediaId),
      eq(officeMediaTable.officeId, office.id),
    );
    const [candidate] = await db
      .select({ placement: officeMediaTable.placement })
      .from(officeMediaTable)
      .where(deleteWhere);
    const deleted = candidate?.placement === "works"
      ? await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(${office.id}, 119)`);
          const [removed] = await tx.delete(officeMediaTable).where(deleteWhere).returning();
          if (removed) await normalizePlacementOrdering(office.id, "works", tx);
          return removed;
        })
      : (await db.delete(officeMediaTable).where(deleteWhere).returning())[0];

    if (!deleted) {
      res.status(404).json({ error: "Media not found" });
      return;
    }

    // Clear pointer columns that reference the deleted item so stale URLs/IDs
    // do not persist after the underlying media row is gone.
    const clearSet: Partial<{ primaryMediaId: null; coverUrl: null; coverVariants: null }> = {};
    if (office.primaryMediaId === deleted.id) clearSet.primaryMediaId = null;
    // For freelancers, coverUrl is set from gallery; clear it when the deleted
    // image was the Quick Card image.
    if (office.providerType === "freelancer" && office.coverUrl === deleted.url) {
      clearSet.coverUrl = null;
      // Also clear coverVariants — for freelancers using a gallery image as
      // their Quick Card cover the cover variants live on the gallery item, but
      // for images processed after the image-optimisation feature launched the
      // coverVariants column on the office row may also have been set via the
      // quick-card-image endpoint.  Clearing both is safe.
      clearSet.coverVariants = null;
    }
    if (Object.keys(clearSet).length > 0) {
      await db.update(officesTable).set(clearSet).where(eq(officesTable.id, office.id));
    }

    // Best-effort GCS cleanup of all variant objects for the deleted media item.
    // Videos have null variants and deleteImageVariants handles that gracefully.
    await deleteImageVariants(
      deleted.variants as ImageVariants | null,
      objectStorageService,
      req.log,
    );

    await recordAuditLog({
      actor: req.session.user,
      action: "office.media.delete",
      targetType: "office",
      targetId: office.id,
      metadata: {
        mediaId: deleted.id,
        placement: deleted.placement,
        status: deleted.status,
        type: deleted.type,
      },
    });

    res.sendStatus(204);
  },
);

// Reorders one independently ordered media placement. Legacy requests without
// placement continue to mean decision_gallery.
router.patch(
  "/offices/me/media/reorder",
  requireRole("office"),
  async (req: Request, res: Response): Promise<void> => {
    const body = (req.body as Record<string, unknown>) ?? {};
    const rawPlacement = body.placement;
    if (
      rawPlacement !== undefined &&
      rawPlacement !== "decision_gallery" &&
      rawPlacement !== "works"
    ) {
      res.status(400).json({ error: "placement must be decision_gallery or works" });
      return;
    }
    const placement: "decision_gallery" | "works" =
      rawPlacement === "works" ? "works" : "decision_gallery";
    const rawItems = body.items;
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      res.status(400).json({ error: "items must be a non-empty array of { id, sortOrder }" });
      return;
    }
    for (const item of rawItems) {
      const i = item as Record<string, unknown>;
      if (!Number.isInteger(i.id) || !Number.isInteger(i.sortOrder)) {
        res.status(400).json({ error: "Each item must have integer id and sortOrder" });
        return;
      }
    }
    const items = rawItems as Array<{ id: number; sortOrder: number }>;
    const ids = items.map((i) => i.id);
    if (new Set(ids).size !== ids.length) {
      res.status(400).json({ error: "Each media id may appear only once" });
      return;
    }

    const [office] = await db
      .select()
      .from(officesTable)
      .where(eq(officesTable.userId, req.session.user!.id));
    if (!office) {
      res.status(401).json({ error: "Office profile not found" });
      return;
    }

    if (placement === "works") {
      const outcome = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${office.id}, 119)`);
        const rows = await tx
          .select({ id: officeMediaTable.id, placement: officeMediaTable.placement })
          .from(officeMediaTable)
          .where(and(
            inArray(officeMediaTable.id, ids),
            eq(officeMediaTable.officeId, office.id),
          ));
        if (rows.length !== ids.length) return { error: "One or more media items not found for this office", status: 404 };
        if (rows.some((row) => row.placement !== "works")) {
          return { error: "Only works items can be reordered", status: 400 };
        }
        await Promise.all(items.map((item) => tx.update(officeMediaTable)
          .set({ sortOrder: item.sortOrder })
          .where(eq(officeMediaTable.id, item.id))));
        return { status: 200 };
      });
      if (outcome.status !== 200) {
        res.status(outcome.status).json({ error: outcome.error });
        return;
      }
      await recordAuditLog({
        actor: req.session.user, action: "office.media.reorder", targetType: "office",
        targetId: office.id, metadata: { placement, items },
      });
      const [updatedOffice] = await db.select().from(officesTable).where(eq(officesTable.id, office.id));
      res.json(await serializeOfficeProfile(updatedOffice));
      return;
    }

    const mediaRows = await db
      .select({ id: officeMediaTable.id, placement: officeMediaTable.placement })
      .from(officeMediaTable)
      .where(
        and(
          inArray(officeMediaTable.id, ids),
          eq(officeMediaTable.officeId, office.id),
        ),
      );

    if (mediaRows.length !== ids.length) {
      res.status(404).json({ error: "One or more media items not found for this office" });
      return;
    }
    if (mediaRows.some((r) => r.placement !== placement)) {
      res.status(400).json({ error: `Only ${placement} items can be reordered` });
      return;
    }
    await Promise.all(
      items.map((item) =>
        db
          .update(officeMediaTable)
          .set({ sortOrder: item.sortOrder })
          .where(eq(officeMediaTable.id, item.id)),
      ),
    );

    await recordAuditLog({
      actor: req.session.user,
      action: "office.media.reorder",
      targetType: "office",
      targetId: office.id,
      metadata: { placement, items },
    });

    const [updatedOffice] = await db
      .select()
      .from(officesTable)
      .where(eq(officesTable.id, office.id));

    res.json(await serializeOfficeProfile(updatedOffice));
  },
);

router.patch(
  "/offices/me/media/:mediaId/primary",
  requireRole("office"),
  async (req: Request, res: Response): Promise<void> => {
    const params = SetMyOfficePrimaryMediaParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [office] = await db
      .select()
      .from(officesTable)
      .where(eq(officesTable.userId, req.session.user!.id));
    if (!office) {
      res.status(401).json({ error: "Office profile not found" });
      return;
    }

    const [media] = await db
      .select({ id: officeMediaTable.id })
      .from(officeMediaTable)
      .where(
        and(
          eq(officeMediaTable.id, params.data.mediaId),
          eq(officeMediaTable.officeId, office.id),
        ),
      );
    if (!media) {
      res.status(404).json({ error: "Media not found" });
      return;
    }

    const [updated] = await db
      .update(officesTable)
      .set({ primaryMediaId: media.id })
      .where(eq(officesTable.id, office.id))
      .returning();

    res.json(await serializeOfficeProfile(updated));
  },
);

// Freelancer-only: immediately set the Quick Card cover image from an
// already-approved gallery item, bypassing the pending-review flow.
// The image is already approved so no further admin sign-off is needed.
router.patch(
  "/offices/me/media/:mediaId/quick-card-image",
  requireRole("office"),
  async (req: Request, res: Response): Promise<void> => {
    const params = SetMyOfficePrimaryMediaParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [office] = await db
      .select()
      .from(officesTable)
      .where(eq(officesTable.userId, req.session.user!.id));
    if (!office) {
      res.status(401).json({ error: "Office profile not found" });
      return;
    }

    if (office.providerType !== "freelancer") {
      res.status(403).json({
        error: "This action is only available for freelancer accounts.",
        code: "freelancer_only",
      });
      return;
    }

    const [media] = await db
      .select({
        id: officeMediaTable.id,
        url: officeMediaTable.url,
        status: officeMediaTable.status,
      })
      .from(officeMediaTable)
      .where(
        and(
          eq(officeMediaTable.id, params.data.mediaId),
          eq(officeMediaTable.officeId, office.id),
        ),
      );
    if (!media) {
      res.status(404).json({ error: "Media not found" });
      return;
    }
    if (media.status !== "approved") {
      res.status(400).json({
        error: "Only approved gallery images can be set as the Quick Card image.",
        code: "media_not_approved",
      });
      return;
    }

    const [updated] = await db
      .update(officesTable)
      .set({ coverUrl: media.url })
      .where(eq(officesTable.id, office.id))
      .returning();

    res.json(await serializeOfficeProfile(updated));
  },
);

// Registers/replaces the office's single optional marketing video. Like
// gallery media, this is NOT subject to LOCKED_EDIT_STATUSES — there is no
// admin approval workflow for it (yet), so it takes effect immediately.
router.put(
  "/offices/me/marketing-video",
  requireRole("office"),
  async (req: Request, res: Response): Promise<void> => {
    // `duration` remains in the public contract as an advisory UX value, but
    // it must never decide whether the upload is accepted. Strip it before
    // validation so even a stale or false client value cannot override the
    // authoritative server-side probe below.
    const bodyForValidation =
      req.body && typeof req.body === "object"
        ? { ...req.body, duration: undefined }
        : req.body;
    const parsed = SetMyOfficeMarketingVideoBody.safeParse(bodyForValidation);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [office] = await db
      .select()
      .from(officesTable)
      .where(eq(officesTable.userId, req.session.user!.id));
    if (!office) {
      res.status(401).json({ error: "Office profile not found" });
      return;
    }

    const { objectPath } = parsed.data;
    const claimValidation = await validateAndConsumeUploadClaim(
      office,
      req.session.user!.id,
      objectPath,
      ["marketing_video"],
    );
    if (!claimValidation.ok) {
      res.status(claimValidation.status).json({
        error: claimValidation.error,
        code: claimValidation.code,
      });
      return;
    }

    if (claimValidation.contentType !== "video/mp4") {
      res.status(400).json({
        error:
          "صيغة الفيديو غير مسموحة. الصيغة المسموحة هي MP4 فقط.\nThis video format is not allowed. Only MP4 is supported.",
        code: "invalid_file_type",
      });
      return;
    }
    if (claimValidation.contentLength > MARKETING_VIDEO_MAX_BYTES) {
      res.status(400).json({
        error:
          "حجم الفيديو كبير جدًا. الحد الأقصى 80 ميغابايت.\nThe video is too large. Maximum size is 80MB.",
        code: "file_too_large",
      });
      return;
    }
    const verification = await verifyMarketingVideoFile(
      objectPath,
      objectStorageService,
      {
        maxBytes: MARKETING_VIDEO_MAX_BYTES,
        maxSeconds: MARKETING_VIDEO_MAX_SECONDS,
      },
    );
    if (!verification.ok) {
      if (verification.reason === "video_too_long") {
        res.status(400).json({
          error:
            "مدة الفيديو طويلة جدًا. الحد الأقصى 75 ثانية.\nThe video is too long. Maximum duration is 75 seconds.",
          code: "video_too_long",
        });
        return;
      }
      if (verification.reason === "invalid_video") {
        res.status(400).json({
          error:
            "ملف الفيديو غير صالح أو تالف أو ليس ملف MP4 مدعومًا.\nThe video is invalid, corrupt, or not a supported MP4 file.",
          code: "invalid_video",
        });
        return;
      }
      if (verification.reason === "duration_unavailable") {
        req.log.warn(
          { err: verification.cause, officeId: office.id },
          "Marketing video duration could not be verified",
        );
        res.status(400).json({
          error:
            "تعذر التحقق من مدة الفيديو بأمان. يرجى تجربة ملف MP4 صالح.\nThe video duration could not be safely determined. Please try a valid MP4 file.",
          code: "video_duration_unavailable",
        });
        return;
      }
      req.log.warn(
        { err: verification.cause, officeId: office.id },
        "Marketing video could not be read from storage for verification",
      );
      res.status(400).json({
        error:
          "تعذر قراءة ملف الفيديو من التخزين للتحقق منه.\nThe video could not be read from storage for verification.",
        code: "file_not_readable",
      });
      return;
    }

    const previousUrl = office.marketingVideoUrl;

    const [updated] = await db
      .update(officesTable)
      .set({
        marketingVideoUrl: objectPath,
        marketingVideoMimeType: claimValidation.contentType,
        marketingVideoSize: claimValidation.contentLength,
        marketingVideoDuration: verification.storedDurationSeconds,
        marketingVideoUpdatedAt: new Date(),
      })
      .where(eq(officesTable.id, office.id))
      .returning();

    // Best-effort cleanup of the file being replaced — never let a storage
    // hiccup here fail the (already-successful) request.
    if (previousUrl && previousUrl !== objectPath) {
      try {
        await objectStorageService.deleteObjectEntity(previousUrl);
      } catch (err) {
        req.log.warn(
          { err, officeId: office.id },
          "Failed to clean up replaced marketing video",
        );
      }
    }

    await recordAuditLog({
      actor: req.session.user,
      action: "office.marketing_video.upload",
      targetType: "office",
      targetId: office.id,
    });

    res.json(await serializeOfficeProfile(updated));
  },
);

router.delete(
  "/offices/me/marketing-video",
  requireRole("office"),
  async (req: Request, res: Response): Promise<void> => {
    const [office] = await db
      .select()
      .from(officesTable)
      .where(eq(officesTable.userId, req.session.user!.id));
    if (!office) {
      res.status(401).json({ error: "Office profile not found" });
      return;
    }

    if (!office.marketingVideoUrl) {
      res.status(404).json({ error: "No marketing video to remove" });
      return;
    }

    const previousUrl = office.marketingVideoUrl;

    const [updated] = await db
      .update(officesTable)
      .set({
        marketingVideoUrl: null,
        marketingVideoMimeType: null,
        marketingVideoSize: null,
        marketingVideoDuration: null,
        marketingVideoUpdatedAt: null,
      })
      .where(eq(officesTable.id, office.id))
      .returning();

    try {
      await objectStorageService.deleteObjectEntity(previousUrl);
    } catch (err) {
      req.log.warn(
        { err, officeId: office.id },
        "Failed to clean up removed marketing video",
      );
    }

    await recordAuditLog({
      actor: req.session.user,
      action: "office.marketing_video.remove",
      targetType: "office",
      targetId: office.id,
    });

    res.json(await serializeOfficeProfile(updated));
  },
);

router.get(
  "/offices/me/documents",
  requireRole("office"),
  async (req: Request, res: Response): Promise<void> => {
    const [office] = await db
      .select()
      .from(officesTable)
      .where(eq(officesTable.userId, req.session.user!.id));
    if (!office) {
      res.status(401).json({ error: "Office profile not found" });
      return;
    }

    const documents = await loadDocumentsByOfficeId(office.id);
    res.json(
      ListMyOfficeDocumentsResponse.parse(
        documents.map(serializeVerificationDocument),
      ),
    );
  },
);

router.post(
  "/offices/me/documents",
  requireRole("office"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = AddMyOfficeDocumentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [office] = await db
      .select()
      .from(officesTable)
      .where(eq(officesTable.userId, req.session.user!.id));
    if (!office) {
      res.status(401).json({ error: "Office profile not found" });
      return;
    }

    const claimValidation = await validateAndConsumeUploadClaim(
      office,
      req.session.user!.id,
      parsed.data.objectPath,
      ["document"],
    );
    if (!claimValidation.ok) {
      res.status(claimValidation.status).json({
        error: claimValidation.error,
        code: claimValidation.code,
      });
      return;
    }

    const [existing] = await db
      .select({ id: officeVerificationDocumentsTable.id })
      .from(officeVerificationDocumentsTable)
      .where(
        eq(officeVerificationDocumentsTable.objectPath, parsed.data.objectPath),
      );
    if (existing) {
      // objectPath is unique (enforced at the DB level too) so ownership
      // checks in the storage-serving route can never resolve to more than
      // one office; reject reuse of an already-registered upload here with
      // a clear error instead of surfacing a raw constraint violation.
      // This also makes a client-side retry-after-success safe: retrying
      // registration of the same objectPath cannot create a duplicate row.
      res.status(400).json({ error: "This uploaded file has already been registered as a document" });
      return;
    }

    // Don't register a document as saved until the object it points to is
    // confirmed readable in storage — admins must never review a document
    // that turns out to be a broken/missing file.
    if (!(await verifyObjectReadable(parsed.data.objectPath))) {
      res.status(400).json({
        error:
          "Uploaded file could not be confirmed readable in storage. Please try uploading it again.",
        code: "file_not_readable",
      });
      return;
    }

    const [document] = await db
      .insert(officeVerificationDocumentsTable)
      .values({
        officeId: office.id,
        documentType: parsed.data.documentType,
        objectPath: parsed.data.objectPath,
        status: "pending",
      })
      .returning();

    await recordAuditLog({
      actor: req.session.user,
      action: "office.document.upload",
      targetType: "office",
      targetId: office.id,
      metadata: { documentType: parsed.data.documentType },
    });

    res.status(201).json(
      AddMyOfficeDocumentResponse.parse(serializeVerificationDocument(document)),
    );
  },
);

router.delete(
  "/offices/me/documents/:documentId",
  requireRole("office"),
  async (req: Request, res: Response): Promise<void> => {
    const params = RemoveMyOfficeDocumentParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [office] = await db
      .select()
      .from(officesTable)
      .where(eq(officesTable.userId, req.session.user!.id));
    if (!office) {
      res.status(401).json({ error: "Office profile not found" });
      return;
    }

    const [deleted] = await db
      .delete(officeVerificationDocumentsTable)
      .where(
        and(
          eq(officeVerificationDocumentsTable.id, params.data.documentId),
          eq(officeVerificationDocumentsTable.officeId, office.id),
        ),
      )
      .returning();

    if (!deleted) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    res.sendStatus(204);
  },
);

router.post(
  "/offices/me/submit",
  requireRole("office"),
  async (req: Request, res: Response): Promise<void> => {
    const [office] = await db
      .select()
      .from(officesTable)
      .where(eq(officesTable.userId, req.session.user!.id));
    if (!office) {
      res.status(401).json({ error: "Office profile not found" });
      return;
    }

    if (!["draft", "changes_requested"].includes(office.status)) {
      res.status(400).json({
        error: `Cannot submit an application in status "${office.status}"`,
      });
      return;
    }

    const missing: string[] = [];
    if (!office.name) missing.push("name");
    if (!office.shortDescription) missing.push("shortDescription");
    if (!office.city) missing.push("city");
    if (!office.category) missing.push("category");
    if (!office.whatsapp) missing.push("whatsapp");
    if (
      (office.spokenLanguages ?? []).length === 0 &&
      (office.customLanguages ?? []).length === 0
    ) {
      missing.push("spokenLanguages");
    }

    const services = await db
      .select({ id: officeServicesTable.id })
      .from(officeServicesTable)
      .where(eq(officeServicesTable.officeId, office.id));
    if (services.length === 0) missing.push("services");

    const documents = await loadDocumentsByOfficeId(office.id);
    const hasIdentity = documents.some((d) => d.documentType === "identity");
    const hasTradeLicense = documents.some(
      (d) => d.documentType === "trade_license",
    );
    if (!hasIdentity) missing.push("identity document");
    if (!hasTradeLicense) missing.push("trade license document");

    if (missing.length > 0) {
      res.status(400).json({
        error: `Application incomplete, missing: ${missing.join(", ")}`,
        missingFields: missing,
      });
      return;
    }

    // ── Hybrid Supply Gate (acceptance_status + supply cap) ───────────────
    //
    // Combined gate enforces BOTH the admin-approved acceptance_status
    // (Supply Control) and the admin-set supply cap (Hybrid Cap).
    //
    // Precedence (see marketGate.ts checkFullGate for details):
    //   1. Unresolvable market        → no_data   → allowed
    //   2. acceptance_status = closed → blocked   (market_closed) unless override
    //   3. cap set AND at/over cap   → blocked   (cap_full)       no override
    //   4. limited + below cap       → limited   (selective review)
    //   5. open/recruit + near cap   → near_cap  (allowed, flagged)
    //   6. everything else           → allowed
    //
    // Safeguards:
    //   - "closed" and "cap_full" block NEW applications only; existing
    //     providers/applications cannot reach this code (status guard above).
    //   - Gate is per exact Country + Canonical City + Category combination.
    //   - Country/city unresolvable → "no_data" → always allowed.
    //   - Admin override (supplyGateOverrideBy) bypasses acceptance_status gate
    //     but NOT cap enforcement.
    const gate = await checkFullGate(office);

    if (gate.outcome === "blocked") {
      const auditAction =
        gate.blockReason === "cap_full"
          ? "supply_gate.blocked_cap"
          : "supply_gate.blocked";

      await recordAuditLog({
        actor:      req.session.user,
        action:     auditAction,
        targetType: "office",
        targetId:   office.id,
        metadata: {
          marketKey:        gate.marketKey,
          acceptanceStatus: gate.acceptanceStatus,
          blockReason:      gate.blockReason,
          ...(gate.capInfo ? {
            supplyCap:            gate.capInfo.supplyCap,
            currentSlotConsumers: gate.capInfo.currentSlotConsumers,
          } : {}),
        },
      });

      if (gate.blockReason === "cap_full" && gate.capInfo) {
        res.status(403).json(
          buildCapFullError(
            gate.marketKey ?? "unknown",
            gate.capInfo.supplyCap!,
            gate.capInfo.currentSlotConsumers,
          ),
        );
      } else {
        res.status(403).json(buildMarketClosedError(gate.marketKey ?? "unknown"));
      }
      return;
    }

    // Record the gate status on the application row.
    // For admin-overridden offices on a blocked market: record "blocked"
    // (true market state) so the override is visible in admin reporting.
    const gateStatusToRecord: string =
      gate.acceptanceStatus === "closed" && office.supplyGateOverrideBy
        ? "blocked"      // override used — store the market truth
        : gate.outcome;  // "allowed" | "near_cap" | "limited" | "no_data"

    const now = new Date();
    const [updated] = await db
      .update(officesTable)
      .set({
        status:              "under_review",
        submittedAt:         now,
        rejectionReason:     null,
        changeRequestReason: null,
        supplyGateStatus:    gateStatusToRecord,
        supplyGateMarketKey: gate.marketKey ?? null,
      })
      .where(eq(officesTable.id, office.id))
      .returning();

    // Audit: gate outcome event
    const gateAction =
      gate.acceptanceStatus === "closed" && office.supplyGateOverrideBy
        ? "supply_gate.override_used"
        : `supply_gate.${gate.outcome}`;

    await recordAuditLog({
      actor:      req.session.user,
      action:     "office.application.submit",
      targetType: "office",
      targetId:   office.id,
    });

    await recordAuditLog({
      actor:      req.session.user,
      action:     gateAction,
      targetType: "office",
      targetId:   office.id,
      metadata: {
        marketKey:        gate.marketKey,
        acceptanceStatus: gate.acceptanceStatus,
        blockReason:      gate.blockReason,
        ...(gate.capInfo ? {
          supplyCap:            gate.capInfo.supplyCap,
          currentSlotConsumers: gate.capInfo.currentSlotConsumers,
          remainingSlots:       gate.capInfo.remainingSlots,
          capStatus:            gate.capInfo.capStatus,
        } : {}),
        ...(office.supplyGateOverrideBy
          ? { overrideBy: office.supplyGateOverrideBy }
          : {}),
      },
    });

    res.json(await serializeOfficeProfile(updated));
  },
);

// Keep this after /offices/me so the literal "me" segment is not swallowed
// by the :officeId param route.
router.get(
  "/offices/:officeId",
  async (req: Request, res: Response): Promise<void> => {
    // Public profile content changes after moderation and owner visibility
    // toggles. Never let browser/proxy caches retain a pre-approval snapshot.
    res.setHeader("Cache-Control", "no-store");
    const params = GetOfficeParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    // The path segment is either a numeric legacy id (old shared links) or
    // the office's stable public slug (canonical/current links and QR
    // codes) — resolve by whichever it looks like.
    const raw = params.data.officeId;
    const numericId = /^\d+$/.test(raw) ? Number(raw) : null;
    const identityCondition =
      numericId !== null
        ? eq(officesTable.id, numericId)
        : eq(officesTable.slug, raw);

    // Fetch without a status filter so we can return a specific structured
    // error code for each failure state rather than a generic 404 for every
    // non-active office. A try/catch surfaces DB connection failures with
    // their own code so the frontend can distinguish retryable errors (server
    // waking up) from permanent ones (office not found / inactive).
    let officeRow: (typeof officesTable.$inferSelect) | undefined;
    try {
      const rows = await db
        .select()
        .from(officesTable)
        .where(identityCondition);
      officeRow = rows[0];
    } catch (dbErr) {
      req.log.error(
        { err: (dbErr as Error).message, slug: raw, outcome: "db_error" },
        "[public-office] database unavailable",
      );
      res
        .status(503)
        .json({ error: "Service temporarily unavailable", code: "db_unavailable" });
      return;
    }

    if (!officeRow) {
      req.log.info({ slug: raw, outcome: "not_found" }, "[public-office] office_not_found");
      res.status(404).json({ error: "Office not found", code: "office_not_found" });
      return;
    }

    if (officeRow.status === "draft" || officeRow.status === "under_review") {
      req.log.info(
        { slug: raw, status: officeRow.status, outcome: "pending" },
        "[public-office] office_pending",
      );
      res
        .status(404)
        .json({ error: "Office is pending review", code: "office_pending" });
      return;
    }

    if (officeRow.status !== "active") {
      req.log.info(
        { slug: raw, status: officeRow.status, outcome: "inactive" },
        "[public-office] office_inactive",
      );
      res
        .status(404)
        .json({ error: "Office is not active", code: "office_inactive" });
      return;
    }

    // Demo offices are internal seed/QA data — treat as not found for
    // any public request, even if their status is active.
    if (officeRow.isDemo) {
      req.log.info(
        { slug: raw, officeId: officeRow.id, outcome: "demo_hidden" },
        "[public-office] demo_office_hidden",
      );
      res.status(404).json({ error: "Office not found", code: "office_not_found" });
      return;
    }

    req.log.info(
      { slug: raw, officeId: officeRow.id, outcome: "found" },
      "[public-office] found",
    );
    // Use the PUBLIC serializer — this strips pendingChanges and
    // pendingChangesSubmittedAt so staged-but-unapproved revisions are
    // never visible to the public. The office owner's dashboard and admin
    // routes use serializeOfficeProfile which retains those fields.
    // HIGH-03: individual office profiles are cacheable for 2 minutes.
    // Phase 1 analytics: set visitor cookie BEFORE sending the response
    // (cookie must be in the response headers, not appended afterwards).
    const analyticsVisitorId = getOrCreateVisitorId(req, res);
    res.setHeader("Cache-Control", "public, max-age=120, stale-while-revalidate=60");
    res.json(await serializePublicOfficeProfile(officeRow));

    // Phase 1 analytics: fire office_profile_view (fire-and-forget, after response)
    try {
      const ctx = extractRequestContext(req);
      const query = req.query as Record<string, string>;
      const searchSessionId =
        ctx.searchSessionId ??
        (query["search_session_id"] as string | undefined) ??
        undefined;
      const source = resolveSource({
        utmSource: ctx.utmSource,
        utmMedium: ctx.utmMedium,
        utmCampaign: ctx.utmCampaign,
        referrerDomain: ctx.referrerDomain,
        qrCampaignId: ctx.qrCampaignId,
        searchSessionId: searchSessionId ?? null,
      });
      // Self-view: the office owner viewing their own profile must not
      // inflate discovery metrics. officeRow.userId is the owner's user ID.
      const isSelfView =
        ctx.authenticatedUserId !== null &&
        ctx.authenticatedUserId === officeRow.userId;

      // Internal actor: seed / QA / admin sessions must not contaminate metrics.
      const isInternalActor = req.session?.user?.isInternal ?? false;

      fireAnalyticsEvent({
        eventName: "office_profile_view",
        officeId: officeRow.id,
        visitorId: analyticsVisitorId ?? undefined,
        authenticatedUserId: ctx.authenticatedUserId ?? undefined,
        searchSessionId,
        countryCode: officeRow.country?.toUpperCase() ?? undefined,
        cityId: officeRow.city?.toLowerCase().replace(/\s+/g, "_") ?? undefined,
        categoryId: officeRow.category ?? undefined,
        source,
        qrCampaignId: ctx.qrCampaignId ?? undefined,
        utmSource: ctx.utmSource ?? undefined,
        utmMedium: ctx.utmMedium ?? undefined,
        utmCampaign: ctx.utmCampaign ?? undefined,
        referrerDomain: ctx.referrerDomain ?? undefined,
        interfaceLanguage: ctx.interfaceLanguage ?? undefined,
        deviceCategory: ctx.deviceCategory ?? undefined,
        osFamily: ctx.osFamily ?? undefined,
        browserFamily: ctx.browserFamily ?? undefined,
        isBot: ctx.isBot,
        botDetectionVersion: ctx.botDetectionVersion,
        exclusionReason: ctx.exclusionReason ?? undefined,
        isSelfView,
        isInternalActor,
      });
    } catch {
      // Never block the response path
    }
  },
);

export default router;

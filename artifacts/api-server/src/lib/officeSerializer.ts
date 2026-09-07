import {
  db,
  pool,
  officeServicesTable,
  officeMediaTable,
  officeVerificationDocumentsTable,
  officeAdminNotesTable,
  usersTable,
  serviceRequestsTable,
  serviceRequestReviewsTable,
  auditLogTable,
} from "@workspace/db";
import type { Office } from "@workspace/db";
import { and, eq, inArray, desc, sql } from "drizzle-orm";
import { verifyObjectReadable } from "./objectStorage";
import { recordAuditLog } from "./auditLog";
import { toPublicVariants, type ImageVariants } from "./imageProcessor";

export interface ServiceTag {
  name: string;
  nameAr: string | null;
}

/** Shape of pre-computed trust metrics passed into serializeOfficeSummary. */
export interface OfficeTrustMetrics {
  completedTransactions: number;
  clientsRecommendPercent: number;
}

/**
 * Batch-loads real trust metrics for a set of offices in ONE SQL query
 * (avoids N+1 when serializing a listing page).
 *
 * Returns a Map keyed by officeId.  Offices with no completed service
 * requests are absent from the map — callers should fall back to the
 * safe zero defaults defined in serializeOfficeSummary.
 *
 * Source of truth for each metric:
 *   completedTransactions   — COUNT(service_requests.id) WHERE status='completed'
 *   clientsRecommendPercent — % of linked reviews where wouldRecommend='yes'
 *                             (denominator = reviews, not transactions; 0 when
 *                              there are no reviews, never a fabricated value)
 */
export async function batchLoadTrustMetrics(
  officeIds: number[],
): Promise<Map<number, OfficeTrustMetrics>> {
  const result = new Map<number, OfficeTrustMetrics>();
  if (officeIds.length === 0) return result;

  const rows = await db
    .select({
      officeId: serviceRequestsTable.officeId,
      completedTransactions: sql<number>`count(${serviceRequestsTable.id})::int`,
      clientsRecommendPercent: sql<number>`
        COALESCE(
          ROUND(
            (SUM(CASE WHEN ${serviceRequestReviewsTable.wouldRecommend} = 'yes' THEN 1.0 ELSE 0.0 END)
            / NULLIF(COUNT(${serviceRequestReviewsTable.id}), 0)) * 100
          )::int,
          0
        )`,
    })
    .from(serviceRequestsTable)
    .leftJoin(
      serviceRequestReviewsTable,
      eq(serviceRequestReviewsTable.requestId, serviceRequestsTable.id),
    )
    .where(
      and(
        eq(serviceRequestsTable.status, "completed"),
        inArray(serviceRequestsTable.officeId, officeIds),
      ),
    )
    .groupBy(serviceRequestsTable.officeId);

  for (const row of rows) {
    result.set(row.officeId, {
      completedTransactions: row.completedTransactions,
      clientsRecommendPercent: row.clientsRecommendPercent,
    });
  }
  return result;
}

export function serializeOfficeSummary(
  office: Office,
  services: ServiceTag[] = [],
  distance: number | null = null,
  metrics?: OfficeTrustMetrics,
) {
  return {
    id: office.id,
    slug: office.slug,
    name: office.name,
    nameAr: office.nameAr ?? null,
    category: office.category,
    status: office.status,
    city: office.city,
    country: office.country ?? null,
    shortDescription: office.shortDescription ?? null,
    shortDescriptionAr: office.shortDescriptionAr ?? null,
    logoUrl: office.logoUrl ?? null,
    coverUrl: office.coverUrl ?? null,
    // Public variant paths for the active cover (thumbnail + medium).
    // Null for offices that uploaded a cover before image-optimisation launched.
    // The `original` path is always stripped here — it is never returned to clients.
    coverVariants: office.coverVariants
      ? toPublicVariants(office.coverVariants as ImageVariants)
      : null,
    isOnline: office.isOnline,
    isVerified: office.isVerified,
    // Real trust metrics from batchLoadTrustMetrics / batchLoadTrustMetrics.
    // Safe zero defaults when no completed service requests exist.
    // clientsRecommendPercent is 0 when there are no reviews — never fabricated.
    completedTransactions: metrics?.completedTransactions ?? 0,
    clientsRecommendPercent: metrics?.clientsRecommendPercent ?? 0,
    isDemo: office.isDemo,
    providerType: office.providerType,
    // Freelancer-only display preference; null means brand_image.
    // Included in the summary so quick cards can render the correct shape
    // without a second request. Always null for offices.
    freelancerImageStyle: office.freelancerImageStyle ?? null,
    serviceTags: services.slice(0, 3),
    distance: distance,
  };
}

/**
 * Batch-loads up to 3 service names (+ Arabic names) per office, for use
 * when serializing a list of OfficeSummary results (avoids N+1 queries).
 */
export async function loadServiceTagsByOfficeId(
  officeIds: number[],
): Promise<Map<number, ServiceTag[]>> {
  const map = new Map<number, ServiceTag[]>();
  if (officeIds.length === 0) return map;

  const rows = await db
    .select({
      officeId: officeServicesTable.officeId,
      name: officeServicesTable.name,
      nameAr: officeServicesTable.nameAr,
    })
    .from(officeServicesTable)
    .where(inArray(officeServicesTable.officeId, officeIds));

  for (const row of rows) {
    const existing = map.get(row.officeId) ?? [];
    if (existing.length < 3) {
      existing.push({ name: row.name, nameAr: row.nameAr ?? null });
    }
    map.set(row.officeId, existing);
  }
  return map;
}

// Tracks which offices we've already flagged for missing Arabic content
// during this process's lifetime, so a page that's viewed repeatedly
// doesn't flood the audit log with duplicate entries. This is a
// best-effort, in-memory dedupe only (resets on restart) — good enough for
// surfacing data-completeness gaps to admins without needing new schema.
const flaggedBilingualGapOfficeIds = new Set<number>();

/**
 * Flags (once per office per process lifetime) any missing Arabic content
 * on a *live* office profile, via the existing admin audit log, so admins
 * can proactively find and fix incomplete bilingual listings instead of
 * customers silently seeing an English fallback in Arabic mode.
 */
async function logBilingualGapsOnce(
  office: Office,
  services: { name: string; nameAr: string | null }[],
): Promise<void> {
  if (office.status !== "active") return;
  if (flaggedBilingualGapOfficeIds.has(office.id)) return;

  const missingFields: string[] = [];
  if (!office.nameAr?.trim()) missingFields.push("nameAr");
  if (!office.shortDescriptionAr?.trim()) missingFields.push("shortDescriptionAr");
  if (!office.descriptionAr?.trim()) missingFields.push("descriptionAr");
  if ((office.certifications ?? []).length > 0 && (office.certificationsAr ?? []).length === 0) {
    missingFields.push("certificationsAr");
  }
  const servicesMissingAr = services.filter((s) => !s.nameAr?.trim()).length;

  flaggedBilingualGapOfficeIds.add(office.id);
  if (missingFields.length === 0 && servicesMissingAr === 0) return;

  await recordAuditLog({
    action: "bilingual_content_gap",
    targetType: "office",
    targetId: office.id,
    metadata: {
      officeName: office.name,
      missingFields,
      servicesMissingArabicName: servicesMissingAr,
    },
  });
}

/**
 * Serializes the office profile for PUBLIC endpoints (the customer-facing
 * GET /api/offices/:slug route). Omits internal and location fields that
 * must never be exposed to the public:
 *  - `pendingChanges` / `pendingChangesSubmittedAt`: staged but not-yet-approved edits
 *  - `latitude` / `longitude`: precise provider coordinates (privacy)
 *  - `rejectionReason` / `changeRequestReason`: internal admin review notes
 *
 * All callers that need these fields (the office owner's dashboard,
 * admin routes) should use `serializeOfficeProfile` directly.
 */
export async function serializePublicOfficeProfile(office: Office) {
  const {
    pendingChanges: _pc,
    pendingChangesSubmittedAt: _pcs,
    latitude: _lat,
    longitude: _lon,
    rejectionReason: _rr,
    changeRequestReason: _crr,
    // Strip all pending-media fields — these must never be visible to the public.
    pendingQuickCardCoverUrl: _pqcc,
    pendingMediaSubmittedAt: _pmsa,
    pendingMediaRejectionReason: _pmrr,
    pendingGalleryItems: _pgi,
    pendingWorksItems: _pwi,
    pendingDecisionCardCovers: _pdcc,
    // approvedDecisionCardCover is included — it's the resolved hero image.
    ...profile
  } = await serializeOfficeProfile(office);
  return {
    ...profile,
    // Disabling Works is a visibility choice, not a destructive action. Keep
    // approved rows available to the owner/admin but do not expose them publicly.
    works: profile.worksEnabled ? profile.works : [],
  };
}

export async function serializeOfficeProfile(office: Office) {
  const services = await db
    .select({
      id: officeServicesTable.id,
      name: officeServicesTable.name,
      nameAr: officeServicesTable.nameAr,
    })
    .from(officeServicesTable)
    .where(eq(officeServicesTable.officeId, office.id));

  await logBilingualGapsOnce(office, services);

  // Fetch all media rows for this office so we can categorize them.
  // We include placement and status so callers can filter appropriately.
  // `variants` contains processed WebP variant paths (thumbnail/display/medium)
  // plus the private `original` path — see imageProcessor.ts for the shape.
  const allMedia = await db
    .select({
      id: officeMediaTable.id,
      url: officeMediaTable.url,
      type: officeMediaTable.type,
      placement: officeMediaTable.placement,
      status: officeMediaTable.status,
      rejectionReason: officeMediaTable.rejectionReason,
      variants: officeMediaTable.variants,
      sortOrder: officeMediaTable.sortOrder,
    })
    .from(officeMediaTable)
    .where(eq(officeMediaTable.officeId, office.id));

  // Returns the public variant object (strips the private `original` path).
  // Returns null for legacy items uploaded before the image-optimisation feature.
  function publicVariants(raw: unknown) {
    if (!raw) return null;
    return toPublicVariants(raw as ImageVariants);
  }

  // The gallery exposed to the office owner: all approved decision_gallery items.
  // Sorted by sort_order (stable owner-defined position) falling back to id
  // for rows created before migration 0021 set sort_order.
  // Pending/rejected gallery items are surfaced separately so the owner can see
  // what's awaiting review without the approved set mixing in.
  // NOTE: includes the primaryMediaId item so the dashboard can manage it.
  const gallery = allMedia
    .filter((m) => m.placement === "decision_gallery" && m.status === "approved")
    .sort((a, b) => (a.sortOrder ?? a.id) - (b.sortOrder ?? b.id))
    .map(({ id, url, type, placement, variants, sortOrder }) => ({
      id,
      url,
      type,
      placement,
      variants: publicVariants(variants),
      sortOrder: sortOrder ?? null,
    }));

  // Pending decision_gallery items (submitted but not yet reviewed).
  // Sorted by sort_order then id for consistent display.
  const pendingGalleryItems = allMedia
    .filter((m) => m.placement === "decision_gallery" && m.status === "pending_review")
    .sort((a, b) => (a.sortOrder ?? a.id) - (b.sortOrder ?? b.id))
    .map(({ id, url, type, placement, rejectionReason, variants, sortOrder }) => ({
      id,
      url,
      type,
      placement,
      rejectionReason: rejectionReason ?? null,
      variants: publicVariants(variants),
      sortOrder: sortOrder ?? null,
    }));

  // Works is deliberately independent from the existing Decision Card gallery:
  // historical decision_gallery rows are never repurposed as portfolio items.
  const works = allMedia
    .filter((m) => m.placement === "works" && m.status === "approved")
    .sort((a, b) => (a.sortOrder ?? a.id) - (b.sortOrder ?? b.id))
    .map(({ id, url, type, placement, variants, sortOrder }) => ({
      id, url, type, placement, variants: publicVariants(variants), sortOrder: sortOrder ?? null,
    }));
  const pendingWorksItems = allMedia
    .filter((m) => m.placement === "works" && m.status === "pending_review")
    .sort((a, b) => (a.sortOrder ?? a.id) - (b.sortOrder ?? b.id))
    .map(({ id, url, type, placement, rejectionReason, variants, sortOrder }) => ({
      id,
      url,
      type,
      placement,
      rejectionReason: rejectionReason ?? null,
      variants: publicVariants(variants),
      sortOrder: sortOrder ?? null,
    }));

  // Pending Decision Card covers.
  const pendingDecisionCardCovers = allMedia
    .filter((m) => m.placement === "decision_card_cover" && m.status === "pending_review")
    .map(({ id, url, type, placement, rejectionReason, variants }) => ({
      id,
      url,
      type,
      placement,
      rejectionReason: rejectionReason ?? null,
      variants: publicVariants(variants),
    }));

  // For freelancer accounts: the gallery image marked as primary (primaryMediaId)
  // doubles as the Decision Card hero if no dedicated decision_card_cover exists.
  const primaryGalleryItem =
    office.providerType === "freelancer" && office.primaryMediaId != null
      ? allMedia.find(
          (m) =>
            m.id === office.primaryMediaId &&
            m.placement === "decision_gallery" &&
            m.status === "approved",
        ) ?? null
      : null;

  // First approved Decision Card cover; fall back to the primary gallery item
  // for freelancers (so the existing frontend hero logic works unchanged).
  const realDCCoverRow = allMedia.find(
    (m) => m.placement === "decision_card_cover" && m.status === "approved",
  );
  const approvedDecisionCardCoverRow = realDCCoverRow ?? primaryGalleryItem ?? undefined;
  const approvedDecisionCardCover = approvedDecisionCardCoverRow
    ? {
        id: approvedDecisionCardCoverRow.id,
        url: approvedDecisionCardCoverRow.url,
        type: approvedDecisionCardCoverRow.type,
        variants: publicVariants(approvedDecisionCardCoverRow.variants),
      }
    : null;

  // The ID of the gallery item being repurposed as the DC hero (null when the
  // hero is a proper decision_card_cover row). The public profile uses this to
  // skip the item in the gallery carousel and avoid showing it twice.
  const heroGalleryItemId: number | null =
    !realDCCoverRow && primaryGalleryItem != null ? primaryGalleryItem.id : null;

  // Load real trust metrics for the profile (one office, single query).
  const profileMetricsMap = await batchLoadTrustMetrics([office.id]);
  const profileMetrics = profileMetricsMap.get(office.id);

  return {
    ...serializeOfficeSummary(office, [], null, profileMetrics),
    description: office.description ?? null,
    descriptionAr: office.descriptionAr ?? null,
    phone: office.phone ?? null,
    whatsapp: office.whatsapp ?? null,
    acceptsPhoneCalls: office.acceptsPhoneCalls,
    spokenLanguages: office.spokenLanguages ?? [],
    customLanguages: office.customLanguages ?? [],
    email: office.email,
    website: office.website ?? null,
    address: office.address ?? null,
    country: office.country ?? null,
    specialization: office.specialization ?? null,
    googleMapsUrl: office.googleMapsUrl ?? null,
    latitude: office.latitude ?? null,
    longitude: office.longitude ?? null,
    rejectionReason: office.rejectionReason ?? null,
    changeRequestReason: office.changeRequestReason ?? null,
    submittedAt: office.submittedAt ?? null,
    reviewedAt: office.reviewedAt ?? null,
    activatedAt: office.activatedAt ?? null,
    heroMediaUrl: office.heroMediaUrl ?? null,
    heroMediaType: office.heroMediaType ?? null,
    marketingVideoUrl: office.marketingVideoUrl ?? null,
    marketingVideoMimeType: office.marketingVideoMimeType ?? null,
    marketingVideoSize: office.marketingVideoSize ?? null,
    marketingVideoDuration: office.marketingVideoDuration ?? null,
    marketingVideoUpdatedAt: office.marketingVideoUpdatedAt ?? null,
    videoCallEnabled: office.videoCallEnabled,
    worksEnabled: office.worksEnabled,
    freelancerImageStyle: office.freelancerImageStyle ?? null,
    certifications: office.certifications ?? [],
    certificationsAr: office.certificationsAr ?? [],
    services,
    gallery,
    works,
    primaryMediaId: office.primaryMediaId ?? null,
    pendingChanges: office.pendingChanges
      ? (JSON.parse(office.pendingChanges) as Record<string, unknown>)
      : null,
    pendingChangesSubmittedAt: office.pendingChangesSubmittedAt ?? null,
    // Pending quick-card cover fields (three columns on offices table)
    pendingQuickCardCoverUrl: office.pendingQuickCardCoverUrl ?? null,
    pendingMediaSubmittedAt: office.pendingMediaSubmittedAt ?? null,
    pendingMediaRejectionReason: office.pendingMediaRejectionReason ?? null,
    // Per-placement pending/approved media
    pendingGalleryItems,
    pendingWorksItems,
    pendingDecisionCardCovers,
    approvedDecisionCardCover,
    // ID of the gallery item that is repurposed as the DC hero (null otherwise).
    // The public profile uses this to skip the item in the gallery carousel.
    heroGalleryItemId,
    // Subscription visibility overlay — true when office is hidden due to
    // non-payment or pending slot allocation (market full).
    isSubscriptionHidden: office.isSubscriptionHidden,
    // Supply slot status + reservation window from market_slot_allocations
    ...await fetchSlotInfo(office.id),
  };
}

/** Fetch slot_status and reservation_expires_at for the office profile. */
async function fetchSlotInfo(officeId: number): Promise<{
  slotStatus: string | null;
  reservationExpiresAt: string | null;
}> {
  const res = await pool.query<{
    slot_status: string;
    reservation_expires_at: Date | null;
  }>(
    `SELECT slot_status, reservation_expires_at
     FROM market_slot_allocations WHERE office_id = $1`,
    [officeId],
  );
  const row = res.rows[0];
  return {
    slotStatus:           row?.slot_status ?? null,
    reservationExpiresAt: row?.reservation_expires_at
      ? new Date(row.reservation_expires_at).toISOString()
      : null,
  };
}

export function serializeAdminOfficeSummary(office: Office) {
  return {
    ...serializeOfficeSummary(office),
    email: office.email,
    phone: office.phone ?? null,
    whatsapp: office.whatsapp ?? null,
    createdAt: office.createdAt,
    // Admin-only visibility into the marketing video (section 8): lets the
    // admin list show an indicator and preview/remove an inappropriate
    // video without needing the full office profile. Never included in
    // the public OfficeSummary.
    marketingVideoUrl: office.marketingVideoUrl ?? null,
    // Surfaced in the list so admins can see at a glance which offices have
    // staged edits waiting for review, without having to open each one.
    pendingChangesSubmittedAt: office.pendingChangesSubmittedAt ?? null,
  };
}

export function serializeAdminApplicationSummary(office: Office, pendingWorksCount = 0) {
  return {
    ...serializeAdminOfficeSummary(office),
    submittedAt: office.submittedAt ?? null,
    reviewedAt: office.reviewedAt ?? null,
    pendingWorksCount,
  };
}

export function serializeVerificationDocument(doc: {
  id: number;
  documentType: string;
  objectPath: string;
  status: string;
  reviewNote: string | null;
  createdAt: Date;
}) {
  return {
    id: doc.id,
    documentType: doc.documentType,
    objectPath: doc.objectPath,
    status: doc.status,
    reviewNote: doc.reviewNote ?? null,
    createdAt: doc.createdAt,
  };
}

export async function loadDocumentsByOfficeId(officeId: number) {
  return db
    .select()
    .from(officeVerificationDocumentsTable)
    .where(eq(officeVerificationDocumentsTable.officeId, officeId));
}

/** Loads admin notes for an office along with the display name of the admin
 * who wrote each one, so the UI can show "who said this" instead of a bare
 * numeric id. Falls back to null when the authoring account no longer exists
 * (e.g. an admin user was deleted) rather than failing the whole list. */
export async function loadAdminNotesByOfficeId(officeId: number) {
  const rows = await db
    .select({
      id: officeAdminNotesTable.id,
      note: officeAdminNotesTable.note,
      createdBy: officeAdminNotesTable.createdBy,
      createdAt: officeAdminNotesTable.createdAt,
      createdByName: usersTable.name,
    })
    .from(officeAdminNotesTable)
    .leftJoin(usersTable, eq(usersTable.id, officeAdminNotesTable.createdBy))
    .where(eq(officeAdminNotesTable.officeId, officeId))
    .orderBy(desc(officeAdminNotesTable.createdAt));

  return rows.map((row) => ({
    ...row,
    createdByName: row.createdByName ?? null,
  }));
}

function serializeAdminNote(note: {
  id: number;
  note: string;
  // nullable: set to null when the admin account that created the note has
  // since been deleted (ON DELETE SET NULL — audit-phase-1 migration).
  createdBy: number | null;
  createdByName?: string | null;
  createdAt: Date;
}) {
  return {
    id: note.id,
    note: note.note,
    createdBy: note.createdBy,
    createdByName: note.createdByName ?? null,
    createdAt: note.createdAt,
  };
}

export async function serializeAdminApplicationDetail(office: Office) {
  const profile = await serializeOfficeProfile(office);
  const documents = await loadDocumentsByOfficeId(office.id);
  const notes = await loadAdminNotesByOfficeId(office.id);
  const nameHistoryRows = await db
    .select({ metadata: auditLogTable.metadata, createdAt: auditLogTable.createdAt })
    .from(auditLogTable)
    .where(and(
      eq(auditLogTable.targetType, "office"),
      eq(auditLogTable.targetId, office.id),
      eq(auditLogTable.action, "office.pending_changes.approve"),
    ))
    .orderBy(desc(auditLogTable.createdAt));
  const nameChangeHistory = nameHistoryRows.flatMap((row) => {
    if (!row.metadata) return [];
    const metadata = JSON.parse(row.metadata) as Record<string, unknown>;
    if (metadata.identityChange !== "name") return [];
    return [{
      previousName: String(metadata.previousName ?? ""),
      newName: String(metadata.newName ?? ""),
      previousNameAr: typeof metadata.previousNameAr === "string" ? metadata.previousNameAr : null,
      newNameAr: typeof metadata.newNameAr === "string" ? metadata.newNameAr : null,
      requestedAt: String(metadata.requestedAt ?? row.createdAt.toISOString()),
      requesterId: typeof metadata.requesterId === "number" ? metadata.requesterId : null,
      approvingAdminId: typeof metadata.approvingAdminId === "number" ? metadata.approvingAdminId : null,
      approvedAt: String(metadata.approvedAt ?? row.createdAt.toISOString()),
    }];
  });
  // Only meaningful once the office is approved (about to be activated),
  // suspended (candidate for reactivation), or active. Active offices may
  // have been activated through an explicit admin override, so their true
  // unresolved requirements must remain visible after activation.
  // Computing it for other statuses would
  // always surface "application_not_approved" noise for drafts/under-review
  // applications where activation isn't the next step anyway.
  const activationBlockers =
    ["approved", "suspended", "active"].includes(office.status)
      ? await getActivationBlockers(
          office.status === "approved" ? office : { ...office, status: "approved" },
        )
      : [];
  return {
    ...profile,
    createdAt: office.createdAt,
    documents: documents.map(serializeVerificationDocument),
    adminNotes: notes.map(serializeAdminNote),
    activationBlockers,
    nameChangeHistory,
  };
}

/**
 * The rules an office must satisfy before an admin can activate it. Every
 * rule is enforced server-side — never trust a client-declared "ready" flag.
 */
export async function getActivationBlockers(
  office: Office,
  database: Pick<typeof db, "select"> = db,
): Promise<string[]> {
  const blockers: string[] = [];
  if (office.status !== "approved") {
    blockers.push("application_not_approved");
  }
  if (
    !office.name ||
    !office.shortDescription ||
    !office.city ||
    !office.category
  ) {
    blockers.push("incomplete_required_info");
  }
  if (!office.whatsapp || office.whatsapp.trim().length < 6) {
    blockers.push("invalid_whatsapp");
  }
  if (
    (office.spokenLanguages ?? []).length === 0 &&
    (office.customLanguages ?? []).length === 0
  ) {
    blockers.push("missing_spoken_language");
  }

  const services = await database
    .select({ id: officeServicesTable.id })
    .from(officeServicesTable)
    .where(eq(officeServicesTable.officeId, office.id));
  if (services.length === 0) {
    blockers.push("missing_service");
  }

  const documents = await database
    .select()
    .from(officeVerificationDocumentsTable)
    .where(eq(officeVerificationDocumentsTable.officeId, office.id));
  const identityApproved = documents.some(
    (d) => d.documentType === "identity" && d.status === "approved",
  );
  const tradeLicenseApproved = documents.some(
    (d) => d.documentType === "trade_license" && d.status === "approved",
  );
  if (!identityApproved) blockers.push("identity_document_not_approved");
  if (!tradeLicenseApproved) blockers.push("trade_license_not_approved");

  // Admin activation controls public visibility, so it is the final
  // server-enforced gate for the provider's verified contact channels.
  const [owner] = await database
    .select({
      emailVerifiedAt: usersTable.emailVerifiedAt,
      phoneVerifiedAt: usersTable.phoneVerifiedAt,
    })
    .from(usersTable)
    .where(eq(usersTable.id, office.userId));
  if (!owner?.emailVerifiedAt) blockers.push("email_not_verified");
  if (!owner?.phoneVerifiedAt) blockers.push("phone_not_verified");

  return blockers;
}

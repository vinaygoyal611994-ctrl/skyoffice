/**
 * Commercial Activation — Plans, Campaign management, and commercial state control.
 *
 * Design principles:
 *   • Commercial state lives in system_config ('commercial_state': disabled/scheduled/active).
 *   • When commercial_state = 'disabled', the subscription sweeper skips the
 *     'hide for non-payment' step entirely — offices are never hidden automatically.
 *   • Activation requires explicit Admin confirmation (activateCampaign); no scheduler
 *     or cron may trigger activation automatically.
 *   • Notifications are tracked per-office per-campaign with a UNIQUE constraint to
 *     prevent duplicate sends.
 *   • activateCampaign() calls startTrial() for each eligible free office atomically
 *     and sets commercial_state = 'active'.
 *   • Office data, reputation, QR codes, and history are NEVER deleted.
 *
 * Commercial states:
 *   disabled   — no billing countdown; offices operate normally; sweeper skips hiding
 *   scheduled  — activation date set; notifications may be in-flight; still no enforcement
 *   active     — full lifecycle enforcement enabled; sweeper hides on non-payment
 */

import { db, pool } from "@workspace/db";
import {
  plansTable,
  commercialActivationCampaignsTable,
  activationNotificationsTable,
  officesTable,
  officeSubscriptionsTable,
  systemConfigTable,
  type Plan,
  type PlanInsert,
  type CommercialActivationCampaign,
  type CampaignStatus,
} from "@workspace/db";
import { eq, and, isNull, or, sql } from "drizzle-orm";
import { logger } from "./logger";
import { emailProvider } from "./email";
import { startTrial, getOrCreateSubscription, getSystemConfigValue, setSystemConfigValue } from "./subscriptionLifecycle";

// ── Commercial state ──────────────────────────────────────────────────────────

export type CommercialState = "disabled" | "scheduled" | "active";

export async function getCommercialState(): Promise<CommercialState> {
  const val = await getSystemConfigValue("commercial_state", "disabled");
  if (val === "scheduled" || val === "active") return val;
  return "disabled";
}

export async function setCommercialState(
  state: CommercialState,
  adminId: number,
): Promise<void> {
  await setSystemConfigValue(
    "commercial_state",
    state,
    adminId,
    "Global commercial activation state: disabled | scheduled | active",
  );
}

// ── Plans CRUD ────────────────────────────────────────────────────────────────

export async function listPlans(
  activeOnly = false,
  providerType?: "office" | "freelancer" | null,
): Promise<Plan[]> {
  const conditions = [];
  if (activeOnly) conditions.push(eq(plansTable.isActive, true));
  if (providerType) conditions.push(eq(plansTable.providerType, providerType));

  const rows = await db
    .select()
    .from(plansTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(plansTable.sortOrder, plansTable.id);
  return rows;
}

export async function getPlan(id: number): Promise<Plan | null> {
  const [row] = await db.select().from(plansTable).where(eq(plansTable.id, id));
  return row ?? null;
}

export async function createPlan(
  data: Omit<PlanInsert, "id" | "createdAt" | "updatedAt">,
): Promise<Plan> {
  const [row] = await db.insert(plansTable).values(data).returning();
  return row!;
}

export async function updatePlan(
  id: number,
  data: Partial<Omit<PlanInsert, "id" | "createdAt" | "updatedAt" | "createdBy">>,
): Promise<Plan | null> {
  const [row] = await db
    .update(plansTable)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(plansTable.id, id))
    .returning();
  return row ?? null;
}

// ── Campaign CRUD ─────────────────────────────────────────────────────────────

export async function listCampaigns(): Promise<CommercialActivationCampaign[]> {
  return db
    .select()
    .from(commercialActivationCampaignsTable)
    .orderBy(sql`${commercialActivationCampaignsTable.createdAt} DESC`);
}

export async function getCampaign(
  id: number,
): Promise<CommercialActivationCampaign | null> {
  const [row] = await db
    .select()
    .from(commercialActivationCampaignsTable)
    .where(eq(commercialActivationCampaignsTable.id, id));
  return row ?? null;
}

export interface CampaignCreateParams {
  planId?:               number;
  targetCountry?:        string;
  targetCity?:           string;
  targetProviderType?:   string;
  scheduledAt?:          Date;
  notificationLeadDays?: number;
  notes?:                string;
  adminId:               number;
}

/**
 * Validates that a plan's provider_type matches the campaign's targetProviderType.
 * Throws CommercialActivationError with code PROVIDER_TYPE_MISMATCH if they differ.
 * A plan with NULL provider_type is universal and matches any target.
 */
async function assertPlanProviderTypeMatch(
  planId: number | null | undefined,
  targetProviderType: string | null | undefined,
): Promise<void> {
  if (!planId || !targetProviderType) return; // no constraint if either is unset
  const plan = await getPlan(planId);
  if (!plan) throw new CommercialActivationError(`Plan ${planId} not found`, "NOT_FOUND");
  if (plan.providerType !== null && plan.providerType !== targetProviderType) {
    throw new CommercialActivationError(
      `Plan provider_type '${plan.providerType}' does not match campaign target '${targetProviderType}'. An Office campaign must use an Office plan and a Freelancer campaign must use a Freelancer plan.`,
      "PROVIDER_TYPE_MISMATCH",
    );
  }
}

export async function createCampaign(
  params: CampaignCreateParams,
): Promise<CommercialActivationCampaign> {
  // Guard: plan provider_type must match target provider_type
  await assertPlanProviderTypeMatch(params.planId, params.targetProviderType);

  // Compute eligible/excluded counts upfront
  const { eligible, excluded } = await computeEligibleCounts({
    targetCountry:      params.targetCountry,
    targetCity:         params.targetCity,
    targetProviderType: params.targetProviderType,
  });

  const [row] = await db
    .insert(commercialActivationCampaignsTable)
    .values({
      planId:               params.planId ?? null,
      targetCountry:        params.targetCountry ?? null,
      targetCity:           params.targetCity ?? null,
      targetProviderType:   params.targetProviderType ?? null,
      scheduledAt:          params.scheduledAt ?? null,
      notificationLeadDays: params.notificationLeadDays ?? 7,
      notes:                params.notes ?? null,
      createdBy:            params.adminId,
      eligibleCount:        eligible,
      excludedCount:        excluded,
      status:               params.scheduledAt ? "scheduled" : "draft",
    })
    .returning();

  if (params.scheduledAt) {
    await setCommercialState("scheduled", params.adminId);
  }

  return row!;
}

export async function updateCampaign(
  id: number,
  data: Partial<{
    planId:               number | null;
    targetCountry:        string | null;
    targetCity:           string | null;
    targetProviderType:   string | null;
    scheduledAt:          Date | null;
    notificationLeadDays: number;
    notes:                string | null;
  }>,
  adminId: number,
): Promise<CommercialActivationCampaign | null> {
  const campaign = await getCampaign(id);
  if (!campaign || campaign.status === "active" || campaign.status === "cancelled") {
    return null;
  }

  // Guard: plan provider_type must match target provider_type (resolved against existing values)
  const resolvedPlanId          = "planId"             in data ? data.planId             : campaign.planId;
  const resolvedProviderType    = "targetProviderType" in data ? data.targetProviderType : campaign.targetProviderType;
  await assertPlanProviderTypeMatch(resolvedPlanId ?? undefined, resolvedProviderType ?? undefined);

  // Recompute eligible/excluded if targeting params changed
  const targetChanged =
    "targetCountry" in data || "targetCity" in data || "targetProviderType" in data;

  let countUpdate: { eligibleCount?: number; excludedCount?: number } = {};
  if (targetChanged) {
    const { eligible, excluded } = await computeEligibleCounts({
      targetCountry:      data.targetCountry ?? campaign.targetCountry ?? undefined,
      targetCity:         data.targetCity    ?? campaign.targetCity    ?? undefined,
      targetProviderType: data.targetProviderType ?? campaign.targetProviderType ?? undefined,
    });
    countUpdate = { eligibleCount: eligible, excludedCount: excluded };
  }

  const newStatus: CampaignStatus =
    (data.scheduledAt ?? campaign.scheduledAt) ? "scheduled" : "draft";

  const [row] = await db
    .update(commercialActivationCampaignsTable)
    .set({ ...data, ...countUpdate, status: newStatus, updatedAt: new Date() })
    .where(eq(commercialActivationCampaignsTable.id, id))
    .returning();

  // Sync commercial_state
  if (newStatus === "scheduled") {
    await setCommercialState("scheduled", adminId);
  }

  return row ?? null;
}

export async function cancelCampaign(
  id: number,
  adminId: number,
): Promise<CommercialActivationCampaign | null> {
  const campaign = await getCampaign(id);
  if (!campaign || campaign.status === "active") return null;

  const [row] = await db
    .update(commercialActivationCampaignsTable)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(eq(commercialActivationCampaignsTable.id, id))
    .returning();

  // Revert commercial_state to disabled if no other active/scheduled campaigns
  const [other] = await db
    .select({ id: commercialActivationCampaignsTable.id })
    .from(commercialActivationCampaignsTable)
    .where(
      and(
        sql`${commercialActivationCampaignsTable.status} IN ('scheduled','active')`,
        sql`${commercialActivationCampaignsTable.id} != ${id}`,
      ),
    );

  if (!other) {
    await setCommercialState("disabled", adminId);
  }

  return row ?? null;
}

// ── Eligibility queries ───────────────────────────────────────────────────────

interface TargetParams {
  targetCountry?:      string | null;
  targetCity?:         string | null;
  targetProviderType?: string | null;
}

/**
 * Returns offices eligible for commercial activation (active, non-demo, matching filters)
 * and count of excluded offices (demo or already on a paid/trial subscription).
 */
export async function computeEligibleCounts(
  params: TargetParams,
): Promise<{ eligible: number; excluded: number }> {
  const result = await pool.query<{ eligible: string; excluded: string }>(
    `
    SELECT
      COUNT(*) FILTER (
        WHERE o.is_demo = false
          AND o.status IN ('active', 'approved')
          AND (s.state IS NULL OR s.state = 'free')
          AND ($1::text IS NULL OR o.country  ILIKE $1)
          AND ($2::text IS NULL OR o.city     ILIKE $2)
          AND ($3::text IS NULL OR o.provider_type = $3)
      )::text AS eligible,
      COUNT(*) FILTER (
        WHERE o.is_demo = true
           OR o.status NOT IN ('active', 'approved')
           OR (s.state IS NOT NULL AND s.state NOT IN ('free', 'cancelled'))
      )::text AS excluded
    FROM offices o
    LEFT JOIN office_subscriptions s ON s.office_id = o.id
    WHERE o.status IN ('active','approved')
    `,
    [params.targetCountry ?? null, params.targetCity ?? null, params.targetProviderType ?? null],
  );

  return {
    eligible: parseInt(result.rows[0]?.eligible ?? "0", 10),
    excluded: parseInt(result.rows[0]?.excluded ?? "0", 10),
  };
}

interface EligibleOfficeRow {
  office_id:  number;
  email:      string;
  name:       string;
  name_ar:    string | null;
  country:    string | null;
  city:       string | null;
  provider_type: string | null;
  locale:     string;
}

async function fetchEligibleOffices(
  params: TargetParams,
): Promise<EligibleOfficeRow[]> {
  const result = await pool.query<EligibleOfficeRow>(
    `
    SELECT
      o.id      AS office_id,
      u.email,
      o.name,
      o.name_ar,
      o.country,
      o.city,
      o.provider_type,
      COALESCE(o.locale, 'ar') AS locale
    FROM offices o
    JOIN users u ON u.id = o.user_id
    LEFT JOIN office_subscriptions s ON s.office_id = o.id
    WHERE o.is_demo = false
      AND o.status IN ('active', 'approved')
      AND (s.state IS NULL OR s.state = 'free')
      AND ($1::text IS NULL OR o.country ILIKE $1)
      AND ($2::text IS NULL OR o.city    ILIKE $2)
      AND ($3::text IS NULL OR o.provider_type = $3)
    ORDER BY o.id
    `,
    [params.targetCountry ?? null, params.targetCity ?? null, params.targetProviderType ?? null],
  );
  return result.rows;
}

// ── Send pre-activation notifications ────────────────────────────────────────

export interface NotifyResult {
  officeId:  number;
  sent:      boolean;
  skipped:   boolean;  // already notified
  failed:    boolean;
  reason?:   string;
}

export async function sendCampaignNotifications(
  campaignId: number,
  adminId: number,
): Promise<{ results: NotifyResult[]; sentCount: number; failedCount: number; skippedCount: number }> {
  const campaign = await getCampaign(campaignId);
  if (!campaign) throw new CommercialActivationError("Campaign not found", "NOT_FOUND");
  if (campaign.status === "active" || campaign.status === "cancelled") {
    throw new CommercialActivationError(
      `Cannot notify for campaign in status '${campaign.status}'`,
      "INVALID_STATE",
    );
  }

  const plan = campaign.planId ? await getPlan(campaign.planId) : null;
  const offices = await fetchEligibleOffices({
    targetCountry:      campaign.targetCountry,
    targetCity:         campaign.targetCity,
    targetProviderType: campaign.targetProviderType,
  });

  const results: NotifyResult[] = [];
  let sentCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const office of offices) {
    // Dedup: try inserting a sentinel row first
    try {
      await db.insert(activationNotificationsTable).values({
        campaignId,
        officeId:  office.office_id,
        status:    "queued",
        locale:    office.locale ?? "ar",
      });
    } catch (e: any) {
      // 23505 = unique_violation — already notified
      if (e?.code === "23505" || String(e?.message).includes("23505") || String(e?.message).includes("unique")) {
        results.push({ officeId: office.office_id, sent: false, skipped: true, failed: false, reason: "Already notified (dedup)" });
        skippedCount++;
        continue;
      }
      // Other DB error — log and continue
      logger.error({ err: e, officeId: office.office_id }, "[commercial] DB error inserting notification sentinel");
      results.push({ officeId: office.office_id, sent: false, skipped: false, failed: true, reason: "DB error" });
      failedCount++;
      continue;
    }

    // Send the email
    try {
      await emailProvider.sendCommercialActivationNotice({
        to:           office.email,
        locale:       (office.locale === "en" ? "en" : "ar") as "ar" | "en",
        officeName:   office.name,
        officeNameAr: office.name_ar ?? office.name,
        scheduledAt:  campaign.scheduledAt ?? new Date(),
        planName:     plan?.name ?? "Office Standard",
        planNameAr:   plan?.nameAr ?? "المكتب الأساسي",
        monthlyPrice: plan?.monthlyPrice ?? 0,
        currency:     plan?.currency ?? "SAR",
        trialDays:    14,
      });

      // Mark as sent
      await db
        .update(activationNotificationsTable)
        .set({ status: "sent", sentAt: new Date() })
        .where(
          and(
            eq(activationNotificationsTable.campaignId, campaignId),
            eq(activationNotificationsTable.officeId, office.office_id),
          ),
        );

      results.push({ officeId: office.office_id, sent: true, skipped: false, failed: false });
      sentCount++;
    } catch (e: any) {
      logger.error({ err: e, officeId: office.office_id }, "[commercial] Failed to send activation notice");

      await db
        .update(activationNotificationsTable)
        .set({ status: "failed", failReason: String(e?.message ?? "Unknown error") })
        .where(
          and(
            eq(activationNotificationsTable.campaignId, campaignId),
            eq(activationNotificationsTable.officeId, office.office_id),
          ),
        );

      results.push({ officeId: office.office_id, sent: false, skipped: false, failed: true, reason: String(e?.message) });
      failedCount++;
    }
  }

  // Update campaign counts
  await db
    .update(commercialActivationCampaignsTable)
    .set({
      notifiedCount: sql`${commercialActivationCampaignsTable.notifiedCount} + ${sentCount}`,
      failedCount:   sql`${commercialActivationCampaignsTable.failedCount}   + ${failedCount}`,
      updatedAt:     new Date(),
    })
    .where(eq(commercialActivationCampaignsTable.id, campaignId));

  logger.info(
    { campaignId, sentCount, failedCount, skippedCount },
    "[commercial] Notification batch complete",
  );

  return { results, sentCount, failedCount, skippedCount };
}

// ── Final activation — requires explicit Admin confirmation ───────────────────

export interface ActivationResult {
  activatedOffices: number;
  errors:           number;
  skipped:          number;
}

/**
 * Activate the campaign. This is the FINAL CONFIRM step.
 *
 * No scheduler or automated process calls this — only an Admin-initiated HTTP POST.
 *
 * Effects:
 *   1. Transitions each eligible free office to startTrial()
 *   2. Sets campaign status → 'active', records activatedAt + confirmedBy
 *   3. Sets system_config commercial_state → 'active'
 *
 * Offices already on trial/paid/expiring are skipped (not double-activated).
 * Office data, reputation, QR codes, and history are never modified or deleted.
 */
export async function activateCampaign(
  campaignId: number,
  adminId: number,
): Promise<ActivationResult> {
  const campaign = await getCampaign(campaignId);
  if (!campaign) throw new CommercialActivationError("Campaign not found", "NOT_FOUND");
  if (campaign.status === "active") {
    throw new CommercialActivationError("Campaign is already active", "INVALID_STATE");
  }
  if (campaign.status === "cancelled") {
    throw new CommercialActivationError("Cannot activate a cancelled campaign", "INVALID_STATE");
  }

  const offices = await fetchEligibleOffices({
    targetCountry:      campaign.targetCountry,
    targetCity:         campaign.targetCity,
    targetProviderType: campaign.targetProviderType,
  });

  let activatedOffices = 0;
  let errors = 0;
  let skipped = 0;

  for (const office of offices) {
    try {
      const sub = await getOrCreateSubscription(office.office_id);

      // Skip offices that are already beyond 'free' state
      if (sub.state !== "free") {
        skipped++;
        continue;
      }

      await startTrial(office.office_id, adminId);
      activatedOffices++;
    } catch (e: any) {
      // INVALID_TRANSITION means already started — treat as skipped
      if (e?.code === "INVALID_TRANSITION") {
        skipped++;
      } else {
        logger.error({ err: e, officeId: office.office_id }, "[commercial] Failed to start trial on activation");
        errors++;
      }
    }
  }

  // Finalize campaign and set global commercial state
  await db
    .update(commercialActivationCampaignsTable)
    .set({
      status:           "active",
      activatedAt:      new Date(),
      confirmedBy:      adminId,
      activatedOffices,
      updatedAt:        new Date(),
    })
    .where(eq(commercialActivationCampaignsTable.id, campaignId));

  await setCommercialState("active", adminId);

  logger.info(
    { campaignId, activatedOffices, errors, skipped },
    "[commercial] Campaign activated",
  );

  return { activatedOffices, errors, skipped };
}

// ── Campaign notification summary ─────────────────────────────────────────────

export interface CampaignNotificationSummary {
  queued:  number;
  sent:    number;
  failed:  number;
  total:   number;
}

export async function getCampaignNotificationSummary(
  campaignId: number,
): Promise<CampaignNotificationSummary> {
  const result = await pool.query<{
    status: string;
    cnt:    string;
  }>(
    `SELECT status, COUNT(*)::text AS cnt
     FROM activation_notifications
     WHERE campaign_id = $1
     GROUP BY status`,
    [campaignId],
  );

  const counts: Record<string, number> = {};
  for (const row of result.rows) {
    counts[row.status] = parseInt(row.cnt, 10);
  }

  return {
    queued:  counts.queued  ?? 0,
    sent:    counts.sent    ?? 0,
    failed:  counts.failed  ?? 0,
    total:   Object.values(counts).reduce((a, b) => a + b, 0),
  };
}

// ── Error class ───────────────────────────────────────────────────────────────

export class CommercialActivationError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" | "INVALID_STATE" | "DUPLICATE" | "PROVIDER_TYPE_MISMATCH",
  ) {
    super(message);
    this.name = "CommercialActivationError";
  }
}

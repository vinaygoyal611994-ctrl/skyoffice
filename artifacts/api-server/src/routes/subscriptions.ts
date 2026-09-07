/**
 * Subscription Admin Routes
 *
 * All routes require role='admin'.  No payment gateway interaction here —
 * this is the lifecycle management and intelligence layer only.
 *
 * Routes:
 *   GET  /api/admin/subscriptions                   — paginated list
 *   GET  /api/admin/subscriptions/metrics           — growth metrics
 *   GET  /api/admin/subscriptions/:officeId         — office detail + history
 *   POST /api/admin/subscriptions/:officeId/trial   — start trial
 *   POST /api/admin/subscriptions/:officeId/activate — activate paid
 *   POST /api/admin/subscriptions/:officeId/expire  — manually expire
 *   POST /api/admin/subscriptions/:officeId/cancel  — cancel
 *   POST /api/admin/subscriptions/:officeId/reactivate — reactivate (expired/hidden/cancelled → paid)
 *   GET  /api/admin/system-config/subscription      — get all sub config values
 *   PUT  /api/admin/system-config/subscription/:key — set a config value
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { requireRole } from "../middlewares/authMiddleware";
import {
  getSubscription,
  getOrCreateSubscription,
  startTrial,
  activatePaid,
  expireSubscription,
  cancelSubscription,
  reactivate,
  computeGrowthMetrics,
  getSystemConfigValue,
  setSystemConfigValue,
  SubscriptionLifecycleError,
} from "../lib/subscriptionLifecycle";
import { computeCommercialReport } from "../lib/commercialMetrics";
import { runSubscriptionSweep } from "../lib/subscriptionSweeper";
import { recordAuditLog } from "../lib/auditLog";

const router: IRouter = Router();

// ── Param schemas ──────────────────────────────────────────────────────────────

const OfficeIdParam = z.object({
  officeId: z.coerce.number().int().positive(),
});

const PaginationQuery = z.object({
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  state: z.string().optional(),
});

const MetricsQuery = z.object({
  period: z.enum(["30d", "60d", "90d", "12m"]).default("30d"),
});

const StartTrialBody = z.object({
  trialDays: z.number().int().min(1).max(365).optional(),
  notes:     z.string().max(500).optional(),
});

const ActivatePaidBody = z.object({
  paidThroughDate: z.string().datetime({ message: "paidThroughDate must be an ISO-8601 datetime" }),
  notes:           z.string().max(500).optional(),
});

const CancelBody = z.object({
  reason: z.string().min(3).max(500).optional(),
});

const ConfigKeyParam = z.object({
  key: z.enum([
    "trial_duration_days",
    "subscription_grace_period_days",
    "subscription_expiry_warning_days",
  ]),
});

const SetConfigBody = z.object({
  value: z.string().min(1),
});

// ── GET /api/admin/subscriptions ──────────────────────────────────────────────

router.get(
  "/admin/subscriptions",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = PaginationQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const { page, limit, state } = parsed.data;

    const stateFilter = state ? `AND os.state = '${state.replace(/'/g, "''")}'` : "";
    const offset = (page - 1) * limit;

    const [rows, countRow] = await Promise.all([
      pool.query<{
        office_id:       number;
        state:           string;
        name:            string;
        name_ar:         string | null;
        email:           string;
        category:        string;
        city:            string;
        country:         string | null;
        is_demo:         boolean;
        trial_started_at: string | null;
        trial_ends_at:   string | null;
        paid_through_date: string | null;
        expires_at:      string | null;
        cancelled_at:    string | null;
        cancel_reason:   string | null;
        hidden_at:       string | null;
        created_at:      string;
        updated_at:      string;
        sub_id:          number;
      }>(
        `SELECT
           os.id          AS sub_id,
           os.office_id,
           os.state,
           os.trial_started_at,
           os.trial_ends_at,
           os.paid_through_date,
           os.expires_at,
           os.cancelled_at,
           os.cancel_reason,
           os.hidden_at,
           os.created_at,
           os.updated_at,
           o.name,
           o.name_ar,
           o.category,
           o.city,
           o.country,
           o.is_demo,
           u.email
         FROM office_subscriptions os
         JOIN offices o ON o.id = os.office_id
         JOIN users   u ON u.id = o.user_id
         WHERE 1=1 ${stateFilter}
           AND o.is_demo = false
         ORDER BY os.updated_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      pool.query<{ cnt: number }>(
        `SELECT COUNT(*)::integer AS cnt
         FROM office_subscriptions os
         JOIN offices o ON o.id = os.office_id
         WHERE 1=1 ${stateFilter}
           AND o.is_demo = false`,
      ),
    ]);

    res.json({
      items: rows.rows,
      total: countRow.rows[0]?.cnt ?? 0,
      page,
      limit,
    });
  },
);

// ── GET /api/admin/subscriptions/metrics ──────────────────────────────────────

router.get(
  "/admin/subscriptions/metrics",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = MetricsQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const periodDays = parsed.data.period === "12m" ? 365
      : parsed.data.period === "90d"  ? 90
      : parsed.data.period === "60d"  ? 60
      : 30;

    const now  = new Date();
    const periodStart = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000);
    const prevStart   = new Date(periodStart.getTime() - periodDays * 24 * 60 * 60 * 1000);

    const metrics = await computeGrowthMetrics(periodStart, now, prevStart, periodStart);

    // Also fetch eligible offices (ever had a subscription, excl. demo)
    const eligibleRes = await pool.query<{ cnt: number }>(
      `SELECT COUNT(DISTINCT os.office_id)::integer AS cnt
       FROM office_subscriptions os
       JOIN offices o ON o.id = os.office_id
       WHERE o.is_demo = false`,
    );

    res.json({
      ...metrics,
      eligibleOffices: eligibleRes.rows[0]?.cnt ?? 0,
      periodDays,
    });
  },
);

// ── GET /api/admin/subscriptions/commercial ───────────────────────────────────

const CommercialPeriodQuery = z.object({
  period: z.enum([
    "current_month",
    "previous_month",
    "last_30d",
    "prev_30d",
  ]).default("last_30d"),
});

/**
 * Compute calendar-month aligned boundaries or rolling-window boundaries.
 * Returns [periodStart, periodEnd, prevStart, prevEnd].
 */
function commercialBoundaries(period: string): [Date, Date, Date, Date] {
  const now = new Date();

  if (period === "current_month") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const end   = new Date(now);
    const pEnd   = new Date(start);
    const pStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    return [start, end, pStart, pEnd];
  }

  if (period === "previous_month") {
    const end   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const pEnd   = new Date(start);
    const pStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1));
    return [start, end, pStart, pEnd];
  }

  if (period === "prev_30d") {
    const periodEnd   = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const periodStart = new Date(periodEnd.getTime() - 30 * 24 * 60 * 60 * 1000);
    const prevEnd     = new Date(periodStart);
    const prevStart   = new Date(prevEnd.getTime() - 30 * 24 * 60 * 60 * 1000);
    return [periodStart, periodEnd, prevStart, prevEnd];
  }

  // default: last_30d
  const periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const prevStart   = new Date(periodStart.getTime() - 30 * 24 * 60 * 60 * 1000);
  return [periodStart, now, prevStart, periodStart];
}

router.get(
  "/admin/subscriptions/commercial",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = CommercialPeriodQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [periodStart, periodEnd, prevStart, prevEnd] =
      commercialBoundaries(parsed.data.period);

    const report = await computeCommercialReport(
      periodStart, periodEnd, prevStart, prevEnd,
    );

    res.json(report);
  },
);

// ── GET /api/admin/subscriptions/:officeId ────────────────────────────────────

router.get(
  "/admin/subscriptions/:officeId",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const params = OfficeIdParam.safeParse(req.params);
    if (!params.success) { res.status(400).json({ error: "Invalid officeId" }); return; }

    const { officeId } = params.data;

    const [sub, historyRows, notifRows] = await Promise.all([
      getSubscription(officeId),
      pool.query<{
        id: number; from_state: string | null; to_state: string;
        reason: string | null; changed_by: number | null;
        changed_by_name: string | null; metadata: unknown;
        created_at: string;
      }>(
        `SELECT h.id, h.from_state, h.to_state, h.reason, h.changed_by,
                u.name AS changed_by_name, h.metadata, h.created_at
         FROM subscription_history h
         LEFT JOIN users u ON u.id = h.changed_by
         WHERE h.office_id = $1
         ORDER BY h.created_at DESC
         LIMIT 100`,
        [officeId],
      ),
      pool.query<{ notification_type: string; sent_at: string; period_expires_at: string }>(
        `SELECT notification_type, sent_at, period_expires_at
         FROM subscription_notifications
         WHERE office_id = $1
         ORDER BY sent_at DESC
         LIMIT 50`,
        [officeId],
      ),
    ]);

    if (!sub) {
      // Return empty state for offices that haven't been initialized yet
      res.json({ subscription: null, history: [], notifications: [] });
      return;
    }

    res.json({
      subscription: sub,
      history:       historyRows.rows,
      notifications: notifRows.rows,
    });
  },
);

// ── POST /api/admin/subscriptions/:officeId/trial ─────────────────────────────

router.post(
  "/admin/subscriptions/:officeId/trial",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const params = OfficeIdParam.safeParse(req.params);
    if (!params.success) { res.status(400).json({ error: "Invalid officeId" }); return; }
    const body = StartTrialBody.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

    const { officeId } = params.data;

    try {
      const sub = await startTrial(officeId, req.session.user!.id, body.data.trialDays);
      await recordAuditLog({
        actor: req.session.user,
        action: "subscription.trial.started",
        targetType: "office",
        targetId: officeId,
        metadata: { trialEndsAt: sub.trialEndsAt?.toISOString() },
      });
      res.json(sub);
    } catch (err) {
      if (err instanceof SubscriptionLifecycleError) {
        res.status(409).json({ error: err.message, code: err.code });
        return;
      }
      throw err;
    }
  },
);

// ── POST /api/admin/subscriptions/:officeId/activate ─────────────────────────

router.post(
  "/admin/subscriptions/:officeId/activate",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const params = OfficeIdParam.safeParse(req.params);
    if (!params.success) { res.status(400).json({ error: "Invalid officeId" }); return; }
    const body = ActivatePaidBody.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

    const { officeId } = params.data;
    const paidThrough = new Date(body.data.paidThroughDate);

    try {
      const sub = await activatePaid(officeId, req.session.user!.id, paidThrough, body.data.notes);
      await recordAuditLog({
        actor: req.session.user,
        action: "subscription.paid.activated",
        targetType: "office",
        targetId: officeId,
        metadata: { paidThroughDate: paidThrough.toISOString() },
      });
      res.json(sub);
    } catch (err) {
      if (err instanceof SubscriptionLifecycleError) {
        res.status(409).json({ error: err.message, code: err.code });
        return;
      }
      throw err;
    }
  },
);

// ── POST /api/admin/subscriptions/:officeId/expire ───────────────────────────

router.post(
  "/admin/subscriptions/:officeId/expire",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const params = OfficeIdParam.safeParse(req.params);
    if (!params.success) { res.status(400).json({ error: "Invalid officeId" }); return; }

    const { officeId } = params.data;
    await expireSubscription(officeId, req.session.user!.id);
    await recordAuditLog({
      actor: req.session.user,
      action: "subscription.manually.expired",
      targetType: "office",
      targetId: officeId,
    });
    res.json({ success: true });
  },
);

// ── POST /api/admin/subscriptions/:officeId/cancel ───────────────────────────

router.post(
  "/admin/subscriptions/:officeId/cancel",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const params = OfficeIdParam.safeParse(req.params);
    if (!params.success) { res.status(400).json({ error: "Invalid officeId" }); return; }
    const body = CancelBody.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

    const { officeId } = params.data;
    await cancelSubscription(officeId, req.session.user!.id, body.data.reason);
    await recordAuditLog({
      actor: req.session.user,
      action: "subscription.cancelled",
      targetType: "office",
      targetId: officeId,
      metadata: { reason: body.data.reason },
    });
    res.json({ success: true });
  },
);

// ── POST /api/admin/subscriptions/:officeId/reactivate ───────────────────────

router.post(
  "/admin/subscriptions/:officeId/reactivate",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const params = OfficeIdParam.safeParse(req.params);
    if (!params.success) { res.status(400).json({ error: "Invalid officeId" }); return; }
    const body = ActivatePaidBody.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

    const { officeId } = params.data;
    const paidThrough = new Date(body.data.paidThroughDate);

    try {
      const sub = await reactivate(officeId, req.session.user!.id, paidThrough, body.data.notes);
      await recordAuditLog({
        actor: req.session.user,
        action: "subscription.reactivated",
        targetType: "office",
        targetId: officeId,
        metadata: { paidThroughDate: paidThrough.toISOString() },
      });
      res.json(sub);
    } catch (err) {
      if (err instanceof SubscriptionLifecycleError) {
        res.status(409).json({ error: err.message, code: err.code });
        return;
      }
      throw err;
    }
  },
);

// ── POST /api/admin/subscriptions/sweep ──────────────────────────────────────
// Trigger a manual sweep (useful for testing / forcing immediate transitions)

router.post(
  "/admin/subscriptions/sweep",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const result = await runSubscriptionSweep();
    res.json(result);
  },
);

// ── GET /api/admin/system-config/subscription ─────────────────────────────────

router.get(
  "/admin/system-config/subscription",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const keys = [
      "trial_duration_days",
      "subscription_grace_period_days",
      "subscription_expiry_warning_days",
    ];
    const values = await Promise.all(keys.map(async (k) => ({
      key: k,
      value: await getSystemConfigValue(k, ""),
    })));
    res.json({ items: values });
  },
);

// ── PUT /api/admin/system-config/subscription/:key ───────────────────────────

router.put(
  "/admin/system-config/subscription/:key",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const params = ConfigKeyParam.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Unknown config key" });
      return;
    }
    const body = SetConfigBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    const n = parseInt(body.data.value, 10);
    if (!Number.isFinite(n) || n < 1) {
      res.status(400).json({ error: "value must be a positive integer" });
      return;
    }

    await setSystemConfigValue(params.data.key, body.data.value, req.session.user!.id);
    await recordAuditLog({
      actor: req.session.user,
      action: "system_config.updated",
      targetType: "config",
      metadata: { key: params.data.key, value: body.data.value },
    });
    res.json({ key: params.data.key, value: body.data.value });
  },
);

export default router;

/**
 * Commercial Activation Routes
 *
 * All routes require role='admin'. No payment gateway integration.
 *
 * Plans:
 *   GET  /api/admin/commercial/plans               — list plans
 *   POST /api/admin/commercial/plans               — create plan
 *   GET  /api/admin/commercial/plans/:id           — get plan
 *   PUT  /api/admin/commercial/plans/:id           — update plan
 *
 * Commercial state:
 *   GET  /api/admin/commercial/state               — get commercial state
 *
 * Campaigns:
 *   GET  /api/admin/commercial/campaigns           — list campaigns
 *   POST /api/admin/commercial/campaigns           — create campaign
 *   GET  /api/admin/commercial/campaigns/:id       — campaign detail + notification summary
 *   PUT  /api/admin/commercial/campaigns/:id       — update draft/scheduled campaign
 *   POST /api/admin/commercial/campaigns/:id/notify    — send pre-activation notifications
 *   POST /api/admin/commercial/campaigns/:id/activate  — FINAL CONFIRM (explicit admin action)
 *   POST /api/admin/commercial/campaigns/:id/cancel    — cancel campaign
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { requireRole } from "../middlewares/authMiddleware";
import {
  getCommercialState,
  listPlans,
  getPlan,
  createPlan,
  updatePlan,
  listCampaigns,
  getCampaign,
  createCampaign,
  updateCampaign,
  cancelCampaign,
  sendCampaignNotifications,
  activateCampaign,
  getCampaignNotificationSummary,
  computeEligibleCounts,
  CommercialActivationError,
} from "../lib/commercialActivation";
import { recordAuditLog } from "../lib/auditLog";

const router: IRouter = Router();

// ── Plans ──────────────────────────────────────────────────────────────────────

const CreatePlanBody = z.object({
  name:            z.string().min(1).max(120),
  nameAr:          z.string().min(1).max(120),
  description:     z.string().max(500).optional(),
  descriptionAr:   z.string().max(500).optional(),
  monthlyPrice:    z.number().int().min(0),
  currency:        z.string().length(3).default("SAR"),
  billingInterval: z.enum(["monthly", "yearly"]).default("monthly"),
  isActive:        z.boolean().default(true),
  countryCode:     z.string().max(10).nullable().optional(),
  providerType:    z.enum(["office", "freelancer"]).nullable().optional(),
  sortOrder:       z.number().int().min(0).default(0),
});

router.get(
  "/admin/commercial/plans",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const activeOnly   = req.query.active === "true";
    const providerType = req.query.providerType as "office" | "freelancer" | undefined;
    res.json(await listPlans(activeOnly, providerType || null));
  },
);

router.post(
  "/admin/commercial/plans",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const body = CreatePlanBody.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

    const plan = await createPlan({ ...body.data, createdBy: req.session.user!.id });
    await recordAuditLog({
      actor: req.session.user,
      action: "plan.created",
      targetType: "plan",
      targetId: plan.id,
      metadata: { name: plan.name },
    });
    res.status(201).json(plan);
  },
);

router.get(
  "/admin/commercial/plans/:id",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (!id) { res.status(400).json({ error: "Invalid plan id" }); return; }
    const plan = await getPlan(id);
    if (!plan) { res.status(404).json({ error: "Plan not found" }); return; }
    res.json(plan);
  },
);

router.put(
  "/admin/commercial/plans/:id",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (!id) { res.status(400).json({ error: "Invalid plan id" }); return; }

    const body = CreatePlanBody.partial().safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

    const plan = await updatePlan(id, body.data);
    if (!plan) { res.status(404).json({ error: "Plan not found" }); return; }

    await recordAuditLog({
      actor: req.session.user,
      action: "plan.updated",
      targetType: "plan",
      targetId: plan.id,
      metadata: body.data,
    });
    res.json(plan);
  },
);

// ── Commercial State ───────────────────────────────────────────────────────────

router.get(
  "/admin/commercial/state",
  requireRole("admin"),
  async (_req: Request, res: Response): Promise<void> => {
    res.json({ state: await getCommercialState() });
  },
);

// ── Campaigns ──────────────────────────────────────────────────────────────────

const CreateCampaignBody = z.object({
  planId:               z.number().int().positive().optional(),
  targetCountry:        z.string().max(100).nullable().optional(),
  targetCity:           z.string().max(100).nullable().optional(),
  targetProviderType:   z.enum(["office", "freelancer"]).nullable().optional(),
  scheduledAt:          z.string().datetime().nullable().optional(),
  notificationLeadDays: z.number().int().min(1).max(90).default(7),
  notes:                z.string().max(1000).nullable().optional(),
});

router.get(
  "/admin/commercial/campaigns",
  requireRole("admin"),
  async (_req: Request, res: Response): Promise<void> => {
    res.json(await listCampaigns());
  },
);

router.post(
  "/admin/commercial/campaigns",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const body = CreateCampaignBody.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

    const campaign = await createCampaign({
      planId:               body.data.planId,
      targetCountry:        body.data.targetCountry ?? undefined,
      targetCity:           body.data.targetCity ?? undefined,
      targetProviderType:   body.data.targetProviderType ?? undefined,
      scheduledAt:          body.data.scheduledAt ? new Date(body.data.scheduledAt) : undefined,
      notificationLeadDays: body.data.notificationLeadDays,
      notes:                body.data.notes ?? undefined,
      adminId:              req.session.user!.id,
    });

    await recordAuditLog({
      actor: req.session.user,
      action: "commercial_campaign.created",
      targetType: "campaign",
      targetId: campaign.id,
      metadata: { status: campaign.status, scheduledAt: body.data.scheduledAt },
    });
    res.status(201).json(campaign);
  },
);

router.get(
  "/admin/commercial/campaigns/:id",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (!id) { res.status(400).json({ error: "Invalid campaign id" }); return; }

    const [campaign, notifications] = await Promise.all([
      getCampaign(id),
      getCampaignNotificationSummary(id),
    ]);
    if (!campaign) { res.status(404).json({ error: "Campaign not found" }); return; }
    res.json({ campaign, notifications });
  },
);

router.put(
  "/admin/commercial/campaigns/:id",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (!id) { res.status(400).json({ error: "Invalid campaign id" }); return; }

    const body = CreateCampaignBody.partial().safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

    const campaign = await updateCampaign(
      id,
      {
        ...body.data,
        scheduledAt: body.data.scheduledAt ? new Date(body.data.scheduledAt) : undefined,
      },
      req.session.user!.id,
    );
    if (!campaign) { res.status(404).json({ error: "Campaign not found or cannot be updated" }); return; }

    await recordAuditLog({
      actor: req.session.user,
      action: "commercial_campaign.updated",
      targetType: "campaign",
      targetId: campaign.id,
      metadata: body.data,
    });
    res.json(campaign);
  },
);

router.post(
  "/admin/commercial/campaigns/:id/notify",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (!id) { res.status(400).json({ error: "Invalid campaign id" }); return; }

    try {
      const result = await sendCampaignNotifications(id, req.session.user!.id);
      await recordAuditLog({
        actor: req.session.user,
        action: "commercial_campaign.notifications_sent",
        targetType: "campaign",
        targetId: id,
        metadata: { sent: result.sentCount, failed: result.failedCount, skipped: result.skippedCount },
      });
      res.json(result);
    } catch (e) {
      if (e instanceof CommercialActivationError) {
        res.status(e.code === "NOT_FOUND" ? 404 : 409).json({ error: e.message });
        return;
      }
      throw e;
    }
  },
);

router.post(
  "/admin/commercial/campaigns/:id/activate",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (!id) { res.status(400).json({ error: "Invalid campaign id" }); return; }

    // Extra safety: require explicit confirmation flag in request body
    const body = z.object({ confirmed: z.literal(true) }).safeParse(req.body);
    if (!body.success) {
      res.status(400).json({
        error: "Activation requires explicit confirmation. Send { confirmed: true } in request body.",
      });
      return;
    }

    try {
      const result = await activateCampaign(id, req.session.user!.id);
      await recordAuditLog({
        actor: req.session.user,
        action: "commercial_campaign.activated",
        targetType: "campaign",
        targetId: id,
        metadata: result as unknown as Record<string, unknown>,
      });
      res.json({ message: "Campaign activated", ...result });
    } catch (e) {
      if (e instanceof CommercialActivationError) {
        res.status(e.code === "NOT_FOUND" ? 404 : 409).json({ error: e.message });
        return;
      }
      throw e;
    }
  },
);

router.post(
  "/admin/commercial/campaigns/:id/cancel",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (!id) { res.status(400).json({ error: "Invalid campaign id" }); return; }

    const campaign = await cancelCampaign(id, req.session.user!.id);
    if (!campaign) { res.status(404).json({ error: "Campaign not found or already active" }); return; }

    await recordAuditLog({
      actor: req.session.user,
      action: "commercial_campaign.cancelled",
      targetType: "campaign",
      targetId: id,
    });
    res.json(campaign);
  },
);

// ── Eligible count (preview) ───────────────────────────────────────────────────

router.get(
  "/admin/commercial/eligible",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const counts = await computeEligibleCounts({
      targetCountry:      req.query.country  as string | undefined,
      targetCity:         req.query.city     as string | undefined,
      targetProviderType: req.query.providerType as string | undefined,
    });
    res.json(counts);
  },
);

export default router;

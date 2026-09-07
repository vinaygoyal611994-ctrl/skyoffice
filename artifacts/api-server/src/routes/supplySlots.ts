/**
 * Supply Slots Admin Routes
 *
 *   GET  /api/admin/supply-slots/market/:key     — slot summary (cap/active/remaining/waiting)
 *   GET  /api/admin/supply-slots/waitlist/:key   — ordered waitlist for a market
 *   GET  /api/admin/supply-slots/audit/:officeId — full slot audit log for an office
 *   POST /api/admin/supply-slots/allocate/:officeId — admin override (force-allocate a slot)
 */

import { Router, type Request, type Response } from "express";
import { requireRole } from "../middlewares/authMiddleware";
import { recordAuditLog } from "../lib/auditLog";
import {
  getMarketSlotSummary,
  getWaitlistForMarket,
  getSlotAuditLog,
  getReservedSlotsForMarket,
  forceAllocateSlot,
} from "../lib/supplySlotManager";
import { runReservationSweep } from "../lib/slotReservationSweeper";
import { getOutboxSummary, getOutboxForMarket } from "../lib/slotNotificationOutbox";
import { z } from "zod";

const router = Router();

// ── GET /api/admin/supply-slots/market/:key ───────────────────────────────────

router.get(
  "/admin/supply-slots/market/:key",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const marketKey = decodeURIComponent(String(req.params.key));
    if (!marketKey || marketKey.split("|").length !== 3) {
      res.status(400).json({ error: "Invalid market key — expected format: country|city|category" });
      return;
    }
    const summary = await getMarketSlotSummary(marketKey);
    res.json(summary);
  },
);

// ── GET /api/admin/supply-slots/waitlist/:key ─────────────────────────────────

router.get(
  "/admin/supply-slots/waitlist/:key",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const marketKey = decodeURIComponent(String(req.params.key));
    if (!marketKey || marketKey.split("|").length !== 3) {
      res.status(400).json({ error: "Invalid market key" });
      return;
    }
    const waitlist = await getWaitlistForMarket(marketKey);
    res.json({ marketKey, waitlist });
  },
);

// ── GET /api/admin/supply-slots/reserved/:key ─────────────────────────────────
// Returns active 3-hour reservations for a market — for admin monitoring.
// Only shows non-expired reservations (reservation_expires_at > NOW()).

router.get(
  "/admin/supply-slots/reserved/:key",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const marketKey = decodeURIComponent(String(req.params.key));
    if (!marketKey || marketKey.split("|").length !== 3) {
      res.status(400).json({ error: "Invalid market key — expected format: country|city|category" });
      return;
    }
    const reservations = await getReservedSlotsForMarket(marketKey);
    res.json({ marketKey, reservations });
  },
);

// ── GET /api/admin/supply-slots/audit/:officeId ───────────────────────────────

router.get(
  "/admin/supply-slots/audit/:officeId",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const officeId = parseInt(String(req.params.officeId), 10);
    if (!Number.isFinite(officeId)) {
      res.status(400).json({ error: "Invalid officeId" });
      return;
    }
    const log = await getSlotAuditLog(officeId);
    res.json({ officeId, log });
  },
);

// ── POST /api/admin/supply-slots/allocate/:officeId ───────────────────────────
// Admin override: FORCE-allocate a slot, bypassing the supply cap entirely.
// This is an explicit administrative action that overrides market capacity rules.
// The override is permanently recorded in slot_audit_log (action='admin_override').
// Use when an admin decides an office must be visible regardless of the current cap.
// To revert: call releaseSlot + processWaitlist as normal.
// Requires a reason for the audit trail.

const OverrideBody = z.object({
  reason: z.string().min(5, "reason must be at least 5 characters"),
});

router.post(
  "/admin/supply-slots/allocate/:officeId",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const officeId = parseInt(String(req.params.officeId), 10);
    if (!Number.isFinite(officeId)) {
      res.status(400).json({ error: "Invalid officeId" });
      return;
    }

    const body = OverrideBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    // Uses forceAllocateSlot — bypasses cap check. Normal allocateSlot respects
    // the cap and may return 'waiting' in a full market, which is not an override.
    const result = await forceAllocateSlot(
      officeId,
      body.data.reason,
      req.session.user!.id,
    );

    await recordAuditLog({
      actor:      req.session.user,
      action:     "supply_slot.admin_override",
      targetType: "office",
      targetId:   officeId,
      metadata:   {
        slotStatus:   result.slotStatus,
        marketKey:    result.marketKey,
        priorityTier: result.priorityTier,
        reason:       body.data.reason,
      } as Record<string, unknown>,
    });

    res.json({
      officeId,
      slotStatus:   result.slotStatus,
      marketKey:    result.marketKey,
      priorityTier: result.priorityTier,
    });
  },
);

// ── POST /api/admin/supply-slots/sweep ───────────────────────────────────────
// Manual trigger for the reservation expiry sweeper — for testing and ops.
// Runs synchronously and returns the full sweep result.
// In production the sweeper also runs automatically every 15 minutes.
// Note: notifications are no longer sent synchronously. Each new reservation
// creates an outbox row atomically; the outbox worker delivers the email within
// ~2 minutes. See GET /api/admin/supply-slots/notification-outbox for status.

router.post(
  "/admin/supply-slots/sweep",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const sweepResult = await runReservationSweep();

    await recordAuditLog({
      actor:      req.session.user,
      action:     "supply_slot.manual_sweep",
      targetType: "system",
      targetId:   0,
      metadata:   {
        expiredCount:   sweepResult.expiredCount,
        reservedCount:  sweepResult.reservedCount,
        allocatedCount: sweepResult.allocatedCount,
        errors:         sweepResult.errors,
        marketKeys:     sweepResult.marketKeys,
        durationMs:     sweepResult.durationMs,
      } as Record<string, unknown>,
    });

    res.json(sweepResult);
  },
);

// ── GET /api/admin/supply-slots/notification-outbox/:key ─────────────────────
// Returns outbox rows scoped to a single market (country|city|category).
// Only includes rows from the last 12 hours so the response stays concise.

router.get(
  "/admin/supply-slots/notification-outbox/:key",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const marketKey = decodeURIComponent(String(req.params.key));
    if (!marketKey || marketKey.split("|").length !== 3) {
      res.status(400).json({ error: "Invalid market key — expected format: country|city|category" });
      return;
    }
    const outbox = await getOutboxForMarket(marketKey);
    res.json({ marketKey, outbox });
  },
);

// ── GET /api/admin/supply-slots/notification-outbox ───────────────────────────
// Returns the current state of the persistent notification outbox:
//   • Aggregate counts by status (pending / sent / failed / skipped)
//   • Up to 10 recent permanently-failed rows for investigation
//
// Use this to verify providers are being notified after slot reservations.
// "failed" entries (all retries exhausted) need manual attention —
// the provider was not notified and will not be retried automatically.

router.get(
  "/admin/supply-slots/notification-outbox",
  requireRole("admin"),
  async (_req: Request, res: Response): Promise<void> => {
    const summary = await getOutboxSummary();

    // Surface a health signal so the admin dashboard can show a warning.
    const healthSignal =
      summary.failed === 0  ? "healthy" :
      summary.failed <= 3   ? "warning" :
                              "critical";

    res.json({ ...summary, healthSignal });
  },
);

export default router;

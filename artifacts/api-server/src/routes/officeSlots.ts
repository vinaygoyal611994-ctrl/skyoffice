/**
 * Office-facing slot status route.
 *
 * GET /api/supply-slots/status — returns the authenticated office's
 * current market slot position: status, reservation expiry, minutes
 * remaining, market key, and priority tier.
 *
 * This is the endpoint consumed by the provider Subscription.tsx
 * dashboard section to render the correct UI state (waitlist, countdown,
 * pay button, renewal button, etc.).
 *
 * The admin-facing slot routes (market summaries, waitlists, audit logs,
 * force-allocate, sweep trigger) live in routes/supplySlots.ts and are
 * protected by requireRole("admin").
 */

import { Router, type Request, type Response } from "express";
import { requireRole } from "../middlewares/authMiddleware";
import { getOfficeIdForUser } from "../lib/auth";
import { pool } from "@workspace/db";

const router = Router();

// ── GET /api/supply-slots/status ──────────────────────────────────────────────
//
// Contract (fields required by Subscription.tsx):
//
//   slotStatus            — 'waiting' | 'reserved' | 'allocated' |
//                           'released' | 'not_required' | null
//   reservationExpiresAt  — ISO 8601 timestamp or null
//   minutesRemaining      — integer minutes remaining or null (0 if expired)
//   marketKey             — 'SA|riyadh|coworking' or null
//   priorityTier          — 1 | 2 | 3 or null
//   paymentLockedUntil    — ISO 8601 timestamp or null (debug/UI use)

router.get(
  "/supply-slots/status",
  requireRole("office"),
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.session.user!.id;
    const officeId = await getOfficeIdForUser(userId);

    if (!officeId) {
      // No office associated with this account — return null status
      res.json({
        slotStatus:           null,
        reservationExpiresAt: null,
        minutesRemaining:     null,
        marketKey:            null,
        priorityTier:         null,
        paymentLockedUntil:   null,
      });
      return;
    }

    const result = await pool.query<{
      slot_status:            string;
      market_key:             string;
      priority_tier:          number;
      reservation_expires_at: Date | null;
      payment_locked_until:   Date | null;
    }>(
      `SELECT slot_status, market_key, priority_tier,
              reservation_expires_at, payment_locked_until
       FROM market_slot_allocations
       WHERE office_id = $1`,
      [officeId],
    );

    const row = result.rows[0];

    if (!row) {
      res.json({
        slotStatus:           null,
        reservationExpiresAt: null,
        minutesRemaining:     null,
        marketKey:            null,
        priorityTier:         null,
        paymentLockedUntil:   null,
      });
      return;
    }

    const now = new Date();
    const expiresAt = row.reservation_expires_at;
    let minutesRemaining: number | null = null;

    if (expiresAt) {
      const ms = expiresAt.getTime() - now.getTime();
      minutesRemaining = Math.max(0, Math.floor(ms / 60_000));
    }

    // Treat 'unassigned' market key (used for not_required offices) as null
    const marketKey = row.market_key === "unassigned" ? null : row.market_key;

    res.json({
      slotStatus:           row.slot_status,
      reservationExpiresAt: expiresAt?.toISOString() ?? null,
      minutesRemaining,
      marketKey,
      priorityTier:         row.priority_tier,
      paymentLockedUntil:   row.payment_locked_until?.toISOString() ?? null,
    });
  },
);

export default router;

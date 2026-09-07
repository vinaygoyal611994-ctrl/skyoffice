import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  officesTable,
  usersTable,
  favouritesTable,
  auditLogTable,
  contactEventsTable,
  videoCallRequestsTable,
  marketSupplyControlTable,
  marketSupplyCapHistoryTable,
} from "@workspace/db";
import { pool } from "@workspace/db";
import { and, count, eq, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { classifyMarket } from "../lib/marketClassifier";
import { fetchAllMarketSignals, runMarketRecompute } from "../lib/marketRecompute";
import {
  checkMarketGateForOffice,
  resolveMarket,
  computeCapStatus,
} from "../lib/marketGate";
import { computeCapRecommendation } from "../lib/marketClassifier";
import {
  ListAdminOfficesQueryParams,
  ListAdminOfficesResponse,
  SetOfficeVerificationParams,
  SetOfficeVerificationBody,
  SetOfficeVerificationResponse,
  DeleteAdminOfficeParams,
  ListAdminCustomersResponse,
  ListAuditLogQueryParams,
  ListAuditLogResponse,
  ListAdminApplicationsQueryParams,
  ListAdminApplicationsResponse,
  GetAdminApplicationParams,
  GetAdminApplicationResponse,
  ApproveAdminApplicationParams,
  ApproveAdminApplicationResponse,
  RejectAdminApplicationParams,
  RejectAdminApplicationBody,
  RejectAdminApplicationResponse,
  RequestChangesAdminApplicationParams,
  RequestChangesAdminApplicationBody,
  RequestChangesAdminApplicationResponse,
  ActivateAdminApplicationParams,
  ActivateAdminApplicationResponse,
  ActivateAdminApplicationOverrideBody,
  SuspendAdminApplicationParams,
  SuspendAdminApplicationResponse,
  ReviewAdminApplicationDocumentParams,
  ReviewAdminApplicationDocumentBody,
  ReviewAdminApplicationDocumentResponse,
  ReactivateAdminApplicationParams,
  ReactivateAdminApplicationResponse,
  ApproveAdminApplicationPendingChangesParams,
  ApproveAdminApplicationPendingChangesResponse,
  RejectAdminApplicationPendingChangesParams,
  RejectAdminApplicationPendingChangesBody,
  RejectAdminApplicationPendingChangesResponse,
  ListAdminApplicationNotesParams,
  ListAdminApplicationNotesResponse,
  AddAdminApplicationNoteParams,
  AddAdminApplicationNoteBody,
  AddAdminApplicationNoteResponse,
  SetAdminCustomerStatusParams,
  SetAdminCustomerStatusBody,
  SetAdminCustomerStatusResponse,
  ListAdminContactEventsQueryParams,
  ListAdminContactEventsResponse,
  ListAdminVideoCallRequestsQueryParams,
  ListAdminVideoCallRequestsResponse,
  RemoveAdminOfficeMarketingVideoParams,
  RemoveAdminOfficeMarketingVideoResponse,
  UpdateMyOfficeBody,
} from "@workspace/api-zod";
import { ObjectStorageService } from "../lib/objectStorage";
import {
  deleteImageVariants,
  type ImageVariants,
} from "../lib/imageProcessor";

const objectStorageService = new ObjectStorageService();
import {
  officeVerificationDocumentsTable,
  officeAdminNotesTable,
  officeMediaTable,
} from "@workspace/db";
import {
  serializeAdminOfficeSummary,
  serializeAdminApplicationSummary,
  serializeAdminApplicationDetail,
  serializeVerificationDocument,
  getActivationBlockers,
  loadAdminNotesByOfficeId,
} from "../lib/officeSerializer";
import { requireRole } from "../middlewares/authMiddleware";
import { recordAuditLog } from "../lib/auditLog";
import { emailProvider } from "../lib/email";
import type { MediaPlacement } from "../lib/email";
import {
  allocateNewApproval,
  processWaitlist,
  countAllocatedSlotsForMarket,
  releaseSlot,
} from "../lib/supplySlotManager";

const router: IRouter = Router();

router.get(
  "/admin/offices",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = ListAdminOfficesQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { category, isVerified, isDemo, providerType } = parsed.data;
    const conditions = [];
    if (category) conditions.push(eq(officesTable.category, category));
    if (isVerified !== undefined)
      conditions.push(eq(officesTable.isVerified, isVerified));
    if (isDemo !== undefined) conditions.push(eq(officesTable.isDemo, isDemo));
    if (providerType !== undefined)
      conditions.push(eq(officesTable.providerType, providerType));

    const offices = await db
      .select()
      .from(officesTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(officesTable.createdAt));

    res.json(
      ListAdminOfficesResponse.parse(offices.map(serializeAdminOfficeSummary)),
    );
  },
);

router.patch(
  "/admin/offices/:officeId/verification",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const params = SetOfficeVerificationParams.safeParse(req.params);
    const body = SetOfficeVerificationBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res
        .status(400)
        .json({ error: params.error?.message ?? body.error?.message });
      return;
    }

    const [office] = await db
      .update(officesTable)
      .set({ isVerified: body.data.isVerified })
      .where(eq(officesTable.id, params.data.officeId))
      .returning();

    if (!office) {
      res.status(404).json({ error: "Office not found" });
      return;
    }

    await recordAuditLog({
      actor: req.session.user,
      action: body.data.isVerified ? "office.verify" : "office.unverify",
      targetType: "office",
      targetId: office.id,
    });

    res.json(SetOfficeVerificationResponse.parse(serializeAdminOfficeSummary(office)));
  },
);

router.delete(
  "/admin/offices/:officeId",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const params = DeleteAdminOfficeParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    // Check existence before the transaction so we can return 404 cleanly
    // without relying on .returning() inside a transaction boundary.
    const [office] = await db
      .select()
      .from(officesTable)
      .where(eq(officesTable.id, params.data.officeId));

    if (!office) {
      res.status(404).json({ error: "Office not found" });
      return;
    }

    // H-3 (audit): wrap both deletes in one transaction so a mid-delete
    // failure cannot leave the users row orphaned with no matching office.
    await db.transaction(async (tx) => {
      await tx.delete(officesTable).where(eq(officesTable.id, office.id));
      await tx.delete(usersTable).where(eq(usersTable.id, office.userId));
    });

    await recordAuditLog({
      actor: req.session.user,
      action: "office.delete",
      targetType: "office",
      targetId: office.id,
      metadata: { isDemo: office.isDemo },
    });

    res.sendStatus(204);
  },
);

// Moderation removal (item 8) — no approval workflow exists for marketing
// videos yet, so this is a direct, immediate takedown, mirroring how admin
// office deletion works elsewhere in this file.
router.delete(
  "/admin/offices/:officeId/marketing-video",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const params = RemoveAdminOfficeMarketingVideoParams.safeParse(
      req.params,
    );
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [office] = await db
      .select()
      .from(officesTable)
      .where(eq(officesTable.id, params.data.officeId));
    if (!office) {
      res.status(404).json({ error: "Office not found" });
      return;
    }
    if (!office.marketingVideoUrl) {
      res.status(404).json({ error: "Office has no marketing video" });
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
        "Failed to clean up admin-removed marketing video",
      );
    }

    await recordAuditLog({
      actor: req.session.user,
      action: "office.marketing_video.remove_by_admin",
      targetType: "office",
      targetId: office.id,
    });

    res.json(
      RemoveAdminOfficeMarketingVideoResponse.parse(
        serializeAdminOfficeSummary(updated),
      ),
    );
  },
);

router.get(
  "/admin/applications",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = ListAdminApplicationsQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const { status } = parsed.data;
    const offices = await db
      .select()
      .from(officesTable)
      .where(status ? eq(officesTable.status, status) : undefined)
      .orderBy(desc(officesTable.createdAt));

    const pendingWorksRows = await db
      .select({
        officeId: officeMediaTable.officeId,
        pendingWorksCount: count(),
      })
      .from(officeMediaTable)
      .where(and(
        eq(officeMediaTable.placement, "works"),
        eq(officeMediaTable.status, "pending_review"),
      ))
      .groupBy(officeMediaTable.officeId);
    const pendingWorksByOffice = new Map(
      pendingWorksRows.map((row) => [row.officeId, Number(row.pendingWorksCount)]),
    );

    res.json(
      ListAdminApplicationsResponse.parse(
        offices.map((office) =>
          serializeAdminApplicationSummary(office, pendingWorksByOffice.get(office.id) ?? 0)),
      ),
    );
  },
);

router.get(
  "/admin/applications/:officeId",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const params = GetAdminApplicationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [office] = await db
      .select()
      .from(officesTable)
      .where(eq(officesTable.id, params.data.officeId));

    if (!office) {
      res.status(404).json({ error: "Application not found" });
      return;
    }

    res.json(await serializeAdminApplicationDetail(office));
  },
);

router.post(
  "/admin/applications/:officeId/approve",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const params = ApproveAdminApplicationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [office] = await db
      .select()
      .from(officesTable)
      .where(eq(officesTable.id, params.data.officeId));
    if (!office) {
      res.status(404).json({ error: "Application not found" });
      return;
    }

    if (office.status !== "under_review") {
      res.status(400).json({
        error: `Cannot approve an application in status "${office.status}"`,
      });
      return;
    }

    // ── Transactional supply-cap enforcement ───────────────────────────────
    // Uses SELECT … FOR UPDATE on the market_supply_control row to serialise
    // concurrent approvals for the same market, preventing the scenario where
    // two admins simultaneously approve applications into the final open slot.
    //
    // Uses supply_gate_market_key (set at submit time) for exact canonical city
    // matching.  Pre-migration offices (market_key = NULL) are not counted and
    // are unaffected by cap enforcement (grandfathered).
    //
    // Slot consumers: status IN ('approved','active') AND is_demo = false.
    // under_review does NOT consume a slot here; the transaction ensures only
    // the first concurrent approval succeeds when the final slot is contested.

    const marketKey = office.supplyGateMarketKey ?? null;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      if (marketKey) {
        // Parse "SA|riyadh|marketing" → parts[0]=country, parts[1]=city, parts[2]=category
        const parts = marketKey.split("|");
        if (parts.length === 3) {
          const [countryCode, cityId, categoryId] = parts;

          // Lock the market control row — serialises concurrent approvals
          const lockRes = await client.query<{ supply_cap: number | null }>(
            `SELECT supply_cap
             FROM market_supply_control
             WHERE country_code = $1 AND city_id = $2 AND category_id = $3
             FOR UPDATE`,
            [countryCode, cityId, categoryId],
          );

          const supplyCap = lockRes.rows[0]?.supply_cap ?? null;

          if (supplyCap !== null) {
            // Count allocated slots within the lock (prevents TOCTOU race).
            // Uses market_slot_allocations — hidden offices do NOT consume slots.
            const countRes = await client.query<{ cnt: number }>(
              `SELECT COUNT(*)::integer AS cnt
               FROM market_slot_allocations
               WHERE market_key = $1 AND slot_status = 'allocated'`,
              [marketKey],
            );
            const currentCount = countRes.rows[0]?.cnt ?? 0;

            if (currentCount >= supplyCap) {
              await client.query("ROLLBACK");
              res.status(409).json({
                error:                "cap_full",
                message:
                  `Supply cap of ${supplyCap} reached for market ${marketKey}. ` +
                  `Current slot consumers: ${currentCount}. ` +
                  `Increase the cap or wait for natural attrition before approving.`,
                currentSlotConsumers: currentCount,
                supplyCap,
                marketKey,
              });
              return;
            }
          }
        }
      }

      // Approve within the same transaction
      await client.query(
        `UPDATE offices
         SET status               = 'approved',
             reviewed_at          = $1,
             reviewed_by          = $2,
             rejection_reason     = NULL,
             change_request_reason = NULL
         WHERE id = $3`,
        [new Date(), req.session.user!.id, office.id],
      );

      // Allocate a supply slot for the approved office (inside the same transaction)
      if (marketKey) {
        await allocateNewApproval(office.id, marketKey, req.session.user!.id, client);
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    // Re-fetch with Drizzle for typed serialisation
    const [updated] = await db
      .select()
      .from(officesTable)
      .where(eq(officesTable.id, office.id));

    await recordAuditLog({
      actor:      req.session.user,
      action:     "office.application.approve",
      targetType: "office",
      targetId:   office.id,
      metadata:   marketKey ? { marketKey } : undefined,
    });

    res.json(await serializeAdminApplicationDetail(updated));
  },
);

router.post(
  "/admin/applications/:officeId/reject",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const params = RejectAdminApplicationParams.safeParse(req.params);
    const body = RejectAdminApplicationBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res
        .status(400)
        .json({ error: params.error?.message ?? body.error?.message });
      return;
    }

    const [office] = await db
      .select()
      .from(officesTable)
      .where(eq(officesTable.id, params.data.officeId));
    if (!office) {
      res.status(404).json({ error: "Application not found" });
      return;
    }

    if (!["under_review", "approved"].includes(office.status)) {
      res.status(400).json({
        error: `Cannot reject an application in status "${office.status}"`,
      });
      return;
    }

    const [updated] = await db
      .update(officesTable)
      .set({
        status: "rejected",
        reviewedAt: new Date(),
        reviewedBy: req.session.user!.id,
        rejectionReason: body.data.reason,
      })
      .where(eq(officesTable.id, office.id))
      .returning();

    await recordAuditLog({
      actor: req.session.user,
      action: "office.application.reject",
      targetType: "office",
      targetId: office.id,
      metadata: { reason: body.data.reason },
    });

    // Release any market slot the office held (waiting, reserved, or allocated).
    // Waiting slots do not consume capacity so no waitlist processing is needed.
    // Allocated/reserved slots DO consume capacity — release frees a slot for the next provider.
    {
      const slotRes = await pool.query<{ slot_status: string; market_key: string }>(
        `SELECT slot_status, market_key FROM market_slot_allocations WHERE office_id = $1`,
        [office.id],
      );
      const prevSlotStatus = slotRes.rows[0]?.slot_status ?? null;
      if (prevSlotStatus && !["released", "not_required"].includes(prevSlotStatus)) {
        const marketKey = await releaseSlot(office.id, "office_rejected", req.session.user!.id);
        if (marketKey && ["allocated", "reserved"].includes(prevSlotStatus)) {
          processWaitlist(marketKey).catch((err) =>
            console.error("[slot] processWaitlist failed after rejection:", err),
          );
        }
      }
    }

    res.json(await serializeAdminApplicationDetail(updated));
  },
);

router.post(
  "/admin/applications/:officeId/request-changes",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const params = RequestChangesAdminApplicationParams.safeParse(req.params);
    const body = RequestChangesAdminApplicationBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res
        .status(400)
        .json({ error: params.error?.message ?? body.error?.message });
      return;
    }

    const [office] = await db
      .select()
      .from(officesTable)
      .where(eq(officesTable.id, params.data.officeId));
    if (!office) {
      res.status(404).json({ error: "Application not found" });
      return;
    }

    if (office.status !== "under_review") {
      res.status(400).json({
        error: `Cannot request changes on an application in status "${office.status}"`,
      });
      return;
    }

    const [updated] = await db
      .update(officesTable)
      .set({
        status: "changes_requested",
        reviewedAt: new Date(),
        reviewedBy: req.session.user!.id,
        changeRequestReason: body.data.reason,
      })
      .where(eq(officesTable.id, office.id))
      .returning();

    await recordAuditLog({
      actor: req.session.user,
      action: "office.application.request_changes",
      targetType: "office",
      targetId: office.id,
      metadata: { reason: body.data.reason },
    });

    res.json(await serializeAdminApplicationDetail(updated));
  },
);

// ── Supply Gate Override ──────────────────────────────────────────────────────
// Allows an admin to explicitly permit a specific provider to submit an
// application that would otherwise be blocked by a closed market status.
//
// Invariants:
//   - Does NOT change market_supply_control.acceptance_status.
//   - Only affects the single named office.
//   - Every override is audited with admin ID, reason, market key, and timestamp.
//   - If the office is in draft/changes_requested (the provider was blocked at
//     submit), the override moves it directly to under_review so the provider
//     does not need to retry.
//   - If the office is already in a later status, only the override columns are
//     set (allowing a future resubmit if changes_requested is issued).

const SupplyGateOverrideBody = z.object({
  reason: z.string().min(10, "Override reason must be at least 10 characters"),
});

router.post(
  "/admin/applications/:officeId/supply-gate-override",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const params = ApproveAdminApplicationParams.safeParse(req.params);
    const body   = SupplyGateOverrideBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: params.error?.message ?? body.error?.message });
      return;
    }
    const officeId = params.data.officeId;

    const [office] = await db
      .select()
      .from(officesTable)
      .where(eq(officesTable.id, officeId));
    if (!office) {
      res.status(404).json({ error: "Application not found" });
      return;
    }

    // Determine the gate state for this office (for audit metadata)
    const gate = await checkMarketGateForOffice(office);

    const now = new Date();

    // If the office is stuck in draft/changes_requested because the provider
    // was blocked at submit, move it directly to under_review.
    const shouldSubmit = ["draft", "changes_requested"].includes(office.status);

    const [updated] = await db
      .update(officesTable)
      .set({
        ...(shouldSubmit
          ? {
              status:              "under_review",
              submittedAt:         office.submittedAt ?? now,
              rejectionReason:     null,
              changeRequestReason: null,
              supplyGateStatus:    "blocked",  // record true market state
              supplyGateMarketKey: gate.marketKey ?? null,
            }
          : {}),
        supplyGateOverrideBy:     req.session.user!.id,
        supplyGateOverrideAt:     now,
        supplyGateOverrideReason: body.data.reason,
      })
      .where(eq(officesTable.id, officeId))
      .returning();

    await recordAuditLog({
      actor:      req.session.user,
      action:     "admin.supply_gate.override",
      targetType: "office",
      targetId:   officeId,
      metadata: {
        reason:           body.data.reason,
        marketKey:        gate.marketKey,
        acceptanceStatus: gate.acceptanceStatus,
        gateOutcome:      gate.outcome,
        movedToUnderReview: shouldSubmit,
      },
    });

    res.json({
      officeId,
      overrideBy:     req.session.user!.id,
      overrideAt:     now.toISOString(),
      reason:         body.data.reason,
      marketKey:      gate.marketKey,
      movedToUnderReview: shouldSubmit,
      status:         updated.status,
    });
  },
);

router.post(
  "/admin/applications/:officeId/activate",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const params = ActivateAdminApplicationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const [office] = await tx
        .select()
        .from(officesTable)
        .where(eq(officesTable.id, params.data.officeId));
      if (!office) return { kind: "not_found" as const };

      const blockers = await getActivationBlockers(office, tx as any);
      if (blockers.length > 0) {
        return { kind: "blocked" as const, blockers };
      }

      const [updated] = await tx
        .update(officesTable)
        .set({
          status: "active",
          activatedAt: new Date(),
          isVerified: true,
        })
        .where(
          and(
            eq(officesTable.id, office.id),
            eq(officesTable.status, "approved"),
          ),
        )
        .returning();

      if (!updated) return { kind: "concurrent_change" as const };

      await recordAuditLog(
        {
          actor: req.session.user,
          action: "office.application.activate",
          targetType: "office",
          targetId: office.id,
        },
        tx as any,
      );

      return { kind: "updated" as const, updated };
    }, { isolationLevel: "serializable" });

    if (result.kind === "not_found") {
      res.status(404).json({ error: "Application not found" });
      return;
    }
    if (result.kind === "blocked") {
      res.status(400).json({
        error: `Activation blocked: ${result.blockers.join(", ")}`,
        blockers: result.blockers,
      });
      return;
    }
    if (result.kind === "concurrent_change") {
      res.status(409).json({
        error: "Application status changed during activation; review it again",
      });
      return;
    }

    res.json(await serializeAdminApplicationDetail(result.updated));
  },
);

router.post(
  "/admin/applications/:officeId/activate-override",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const params = ActivateAdminApplicationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const body = ActivateAdminApplicationOverrideBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const [office] = await tx
        .select()
        .from(officesTable)
        .where(eq(officesTable.id, params.data.officeId));

      if (!office) return { kind: "not_found" as const };
      if (office.status !== "approved") {
        return {
          kind: "invalid_status" as const,
          status: office.status,
        };
      }

      // Recompute inside the same transaction as the activation update and
      // audit write. The audit record therefore describes the exact blockers
      // that were present for the office being activated.
      const blockers = await getActivationBlockers(office, tx as any);
      if (blockers.length === 0) {
        return { kind: "no_blockers" as const };
      }
      const expectedBlockers = [...body.data.expectedBlockers].sort();
      const currentBlockers = [...blockers].sort();
      if (
        expectedBlockers.length !== currentBlockers.length ||
        expectedBlockers.some((blocker, index) => blocker !== currentBlockers[index])
      ) {
        return {
          kind: "blockers_changed" as const,
          blockers,
        };
      }

      const now = new Date();
      const [updated] = await tx
        .update(officesTable)
        .set({
          status: "active",
          activatedAt: now,
          isVerified: true,
        })
        .where(
          and(
            eq(officesTable.id, office.id),
            eq(officesTable.status, "approved"),
          ),
        )
        .returning();

      if (!updated) {
        return { kind: "concurrent_change" as const };
      }

      await recordAuditLog(
        {
          actor: req.session.user,
          action: "office.application.activate_override",
          targetType: "office",
          targetId: office.id,
          metadata: {
            activationMethod: "admin_override",
            overrideAt: now.toISOString(),
            blockers,
            officeStatusBefore: office.status,
          },
        },
        tx as any,
      );

      return { kind: "updated" as const, updated };
    }, { isolationLevel: "serializable" });

    if (result.kind === "not_found") {
      res.status(404).json({ error: "Application not found" });
      return;
    }
    if (result.kind === "invalid_status") {
      res.status(400).json({
        error: `Cannot activate an application in status "${result.status}"`,
      });
      return;
    }
    if (result.kind === "no_blockers") {
      res.status(400).json({
        error: "No activation blockers remain; use normal activation instead",
      });
      return;
    }
    if (result.kind === "concurrent_change") {
      res.status(409).json({
        error: "Application status changed while confirming the override; review it again",
      });
      return;
    }
    if (result.kind === "blockers_changed") {
      res.status(409).json({
        error: "Activation blockers changed while confirming the override; review them again",
        blockers: result.blockers,
      });
      return;
    }

    res.json(await serializeAdminApplicationDetail(result.updated));
  },
);

router.post(
  "/admin/applications/:officeId/suspend",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const params = SuspendAdminApplicationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [office] = await db
      .select()
      .from(officesTable)
      .where(eq(officesTable.id, params.data.officeId));
    if (!office) {
      res.status(404).json({ error: "Application not found" });
      return;
    }

    if (office.status !== "active") {
      res.status(400).json({
        error: `Cannot suspend an application in status "${office.status}"`,
      });
      return;
    }

    const [updated] = await db
      .update(officesTable)
      .set({ status: "suspended", isSubscriptionHidden: true })
      .where(eq(officesTable.id, office.id))
      .returning();

    await recordAuditLog({
      actor: req.session.user,
      action: "office.application.suspend",
      targetType: "office",
      targetId: office.id,
    });

    // Release the office's market slot so waiting providers can access the capacity.
    // Both 'allocated' and 'reserved' consume capacity — either frees a slot.
    // Offices in 'waiting' do not consume capacity; just release them without re-triggering.
    {
      const slotRes = await pool.query<{ slot_status: string; market_key: string }>(
        `SELECT slot_status, market_key FROM market_slot_allocations WHERE office_id = $1`,
        [office.id],
      );
      const prevSlotStatus = slotRes.rows[0]?.slot_status ?? null;
      if (prevSlotStatus && !["released", "not_required"].includes(prevSlotStatus)) {
        const marketKey = await releaseSlot(office.id, "office_suspended", req.session.user!.id);
        if (marketKey && ["allocated", "reserved"].includes(prevSlotStatus)) {
          processWaitlist(marketKey).catch((err) =>
            console.error("[slot] processWaitlist failed after suspension:", err),
          );
        }
      }
    }

    res.json(await serializeAdminApplicationDetail(updated));
  },
);

router.post(
  "/admin/applications/:officeId/reactivate",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const params = ReactivateAdminApplicationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [office] = await db
      .select()
      .from(officesTable)
      .where(eq(officesTable.id, params.data.officeId));
    if (!office) {
      res.status(404).json({ error: "Application not found" });
      return;
    }

    if (office.status !== "suspended") {
      res.status(400).json({
        error: `Cannot reactivate an application in status "${office.status}"`,
      });
      return;
    }

    // Re-run the same activation checks a fresh activation would require —
    // a suspension may have outlasted a document approval being revoked, or
    // the office may have lost its main image in the interim.
    const blockers = await getActivationBlockers({
      ...office,
      status: "approved",
    });
    if (blockers.length > 0) {
      res.status(400).json({
        error: `Reactivation blocked: ${blockers.join(", ")}`,
        blockers,
      });
      return;
    }

    const [updated] = await db
      .update(officesTable)
      .set({ status: "active" })
      .where(eq(officesTable.id, office.id))
      .returning();

    await recordAuditLog({
      actor: req.session.user,
      action: "office.application.reactivate",
      targetType: "office",
      targetId: office.id,
    });

    res.json(await serializeAdminApplicationDetail(updated));
  },
);

router.post(
  "/admin/applications/:officeId/pending-changes/approve",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const params =
      ApproveAdminApplicationPendingChangesParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const result = await db.transaction(async (tx) => {
      const [office] = await tx
        .select()
        .from(officesTable)
        .where(eq(officesTable.id, params.data.officeId))
        .for("update");
      if (!office) return { kind: "missing" as const };
      if (!office.pendingChanges) return { kind: "stale" as const };

      const rawChanges = JSON.parse(office.pendingChanges) as Record<string, unknown>;
      const validatedChanges = UpdateMyOfficeBody.safeParse(rawChanges);
      if (!validatedChanges.success) return { kind: "invalid_changes" as const };
      const { coverUrl: _stalecover, ...changes } = validatedChanges.data;
      const requestedAt = office.pendingChangesSubmittedAt ?? new Date();
      const [updatedOffice] = await tx
        .update(officesTable)
        .set({
          ...changes,
          pendingChanges: null,
          pendingChangesSubmittedAt: null,
        })
        .where(eq(officesTable.id, office.id))
        .returning();
      await recordAuditLog({
        actor: req.session.user,
        action: "office.pending_changes.approve",
        targetType: "office",
        targetId: office.id,
        metadata: {
          ...((typeof changes.name === "string" && changes.name !== office.name) ||
          (Object.prototype.hasOwnProperty.call(changes, "nameAr") && changes.nameAr !== office.nameAr)
            ? {
                identityChange: "name",
                previousName: office.name,
                newName: typeof changes.name === "string" ? changes.name : office.name,
                requestedAt: requestedAt.toISOString(),
                requesterId: office.userId,
                approvingAdminId: req.session.user!.id,
                approvedAt: new Date().toISOString(),
                previousNameAr: office.nameAr,
                newNameAr: Object.prototype.hasOwnProperty.call(changes, "nameAr") ? (changes.nameAr || null) : office.nameAr,
              }
            : {}),
          ...(typeof changes.category === "string" && changes.category !== office.category
            ? {
                categoryChange: true,
                previousCategory: office.category,
                newCategory: changes.category,
              }
            : {}),
        },
      }, tx as any);
      return { kind: "ok" as const, office: updatedOffice };
    });
    if (result.kind === "missing") {
      res.status(404).json({ error: "Application not found" });
      return;
    }
    if (result.kind === "stale") {
      res.status(409).json({ error: "Pending revision was already reviewed or changed" });
      return;
    }
    if (result.kind === "invalid_changes") {
      res.status(400).json({ error: "Pending revision contains unsupported fields" });
      return;
    }
    res.json(await serializeAdminApplicationDetail(result.office));
  },
);

router.post(
  "/admin/applications/:officeId/pending-changes/reject",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const params =
      RejectAdminApplicationPendingChangesParams.safeParse(req.params);
    const body = RejectAdminApplicationPendingChangesBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res
        .status(400)
        .json({ error: params.error?.message ?? body.error?.message });
      return;
    }

    const [office] = await db
      .select()
      .from(officesTable)
      .where(eq(officesTable.id, params.data.officeId));
    if (!office) {
      res.status(404).json({ error: "Application not found" });
      return;
    }

    if (!office.pendingChanges) {
      res.status(400).json({ error: "No pending revision to reject" });
      return;
    }

    const [updated] = await db
      .update(officesTable)
      .set({ pendingChanges: null, pendingChangesSubmittedAt: null })
      .where(eq(officesTable.id, office.id))
      .returning();

    await recordAuditLog({
      actor: req.session.user,
      action: "office.pending_changes.reject",
      targetType: "office",
      targetId: office.id,
      metadata: { reason: body.data.reason },
    });

    res.json(await serializeAdminApplicationDetail(updated));
  },
);

router.get(
  "/admin/applications/:officeId/notes",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const params = ListAdminApplicationNotesParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const notes = await loadAdminNotesByOfficeId(params.data.officeId);
    res.json(
      ListAdminApplicationNotesResponse.parse(
        notes.map((n) => ({
          id: n.id,
          note: n.note,
          createdBy: n.createdBy,
          createdByName: n.createdByName,
          createdAt: n.createdAt,
        })),
      ),
    );
  },
);

router.post(
  "/admin/applications/:officeId/notes",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const params = AddAdminApplicationNoteParams.safeParse(req.params);
    const body = AddAdminApplicationNoteBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res
        .status(400)
        .json({ error: params.error?.message ?? body.error?.message });
      return;
    }

    const [office] = await db
      .select({ id: officesTable.id })
      .from(officesTable)
      .where(eq(officesTable.id, params.data.officeId));
    if (!office) {
      res.status(404).json({ error: "Application not found" });
      return;
    }

    const [note] = await db
      .insert(officeAdminNotesTable)
      .values({
        officeId: office.id,
        note: body.data.note,
        createdBy: req.session.user!.id,
      })
      .returning();

    const [author] = await db
      .select({ name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, req.session.user!.id));

    await recordAuditLog({
      actor: req.session.user,
      action: "office.admin_note.add",
      targetType: "office",
      targetId: office.id,
    });

    res.status(201).json(
      AddAdminApplicationNoteResponse.parse({
        id: note.id,
        note: note.note,
        createdBy: note.createdBy,
        createdByName: author?.name ?? null,
        createdAt: note.createdAt,
      }),
    );
  },
);

router.post(
  "/admin/applications/:officeId/documents/:documentId",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const params = ReviewAdminApplicationDocumentParams.safeParse(req.params);
    const body = ReviewAdminApplicationDocumentBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res
        .status(400)
        .json({ error: params.error?.message ?? body.error?.message });
      return;
    }

    // Item 9: a rejection with no reason leaves the office with no idea
    // what to fix — require a non-empty note whenever rejecting.
    if (
      body.data.status === "rejected" &&
      (!body.data.reviewNote || body.data.reviewNote.trim().length === 0)
    ) {
      res
        .status(400)
        .json({ error: "A reason is required when rejecting a document" });
      return;
    }

    const [document] = await db
      .update(officeVerificationDocumentsTable)
      .set({
        status: body.data.status,
        reviewNote: body.data.reviewNote ?? null,
        reviewedBy: req.session.user!.id,
      })
      .where(
        and(
          eq(officeVerificationDocumentsTable.id, params.data.documentId),
          eq(officeVerificationDocumentsTable.officeId, params.data.officeId),
        ),
      )
      .returning();

    if (!document) {
      res.status(404).json({ error: "Document not found" });
      return;
    }

    await recordAuditLog({
      actor: req.session.user,
      action: "office.document.review",
      targetType: "office_verification_document",
      targetId: document.id,
      metadata: { status: body.data.status },
    });

    res.json(
      ReviewAdminApplicationDocumentResponse.parse(
        serializeVerificationDocument(document),
      ),
    );
  },
);

// ── Admin: Quick-Card-Cover approval endpoints ──────────────────────────────

router.post(
  "/admin/applications/:officeId/media/quick-card-cover/approve",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const officeId = Number(req.params.officeId);
    if (!Number.isFinite(officeId)) {
      res.status(400).json({ error: "Invalid officeId" });
      return;
    }

    const [office] = await db
      .select()
      .from(officesTable)
      .where(eq(officesTable.id, officeId));
    if (!office) {
      res.status(404).json({ error: "Office not found" });
      return;
    }
    if (!office.pendingQuickCardCoverUrl) {
      res.status(400).json({ error: "No pending quick-card cover to approve" });
      return;
    }

    const [updated] = await db
      .update(officesTable)
      .set({
        coverUrl: office.pendingQuickCardCoverUrl,
        coverVariants: office.pendingQuickCardCoverVariants ?? null,
        pendingQuickCardCoverUrl: null,
        pendingQuickCardCoverVariants: null,
        pendingMediaSubmittedAt: null,
        pendingMediaRejectionReason: null,
      })
      .where(eq(officesTable.id, office.id))
      .returning();

    await recordAuditLog({
      actor: req.session.user,
      action: "office.quick_card_cover.approve",
      targetType: "office",
      targetId: office.id,
    });

    // Notify the office owner — fire-and-forget; a delivery failure must
    // never block the admin action or surface a 500 to the caller.
    const [officeUser] = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, office.userId));
    if (officeUser?.email) {
      emailProvider
        .sendMediaApprovedEmail({
          to: officeUser.email,
          locale: "ar",
          placement: "quick_card_cover",
          officeName: office.name,
        })
        .catch((err) => {
          req.log.warn(
            { err, officeId: office.id },
            "[email] quick-card-cover approved notification failed",
          );
        });
    }

    res.json(await serializeAdminApplicationDetail(updated));
  },
);

router.post(
  "/admin/applications/:officeId/media/quick-card-cover/reject",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const officeId = Number(req.params.officeId);
    if (!Number.isFinite(officeId)) {
      res.status(400).json({ error: "Invalid officeId" });
      return;
    }
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";

    const [office] = await db
      .select()
      .from(officesTable)
      .where(eq(officesTable.id, officeId));
    if (!office) {
      res.status(404).json({ error: "Office not found" });
      return;
    }
    if (!office.pendingQuickCardCoverUrl) {
      res.status(400).json({ error: "No pending quick-card cover to reject" });
      return;
    }

    // Capture variants before clearing them so we can clean up GCS objects.
    const pendingVariants = office.pendingQuickCardCoverVariants as ImageVariants | null;

    const [updated] = await db
      .update(officesTable)
      .set({
        pendingQuickCardCoverUrl: null,
        pendingQuickCardCoverVariants: null,
        pendingMediaSubmittedAt: null,
        pendingMediaRejectionReason: reason || null,
      })
      .where(eq(officesTable.id, office.id))
      .returning();

    // Best-effort GCS cleanup — do after DB write so a storage error never
    // rolls back the rejection. Includes the raw original + all WebP variants.
    if (pendingVariants) {
      deleteImageVariants(pendingVariants, objectStorageService, req.log).catch(
        (err) => {
          req.log.warn(
            { err, officeId: office.id },
            "admin: failed to delete rejected quick-card-cover variants",
          );
        },
      );
    }

    await recordAuditLog({
      actor: req.session.user,
      action: "office.quick_card_cover.reject",
      targetType: "office",
      targetId: office.id,
      metadata: { reason },
    });

    // Notify the office owner — fire-and-forget.
    const [officeUser] = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, office.userId));
    if (officeUser?.email) {
      emailProvider
        .sendMediaRejectedEmail({
          to: officeUser.email,
          locale: "ar",
          placement: "quick_card_cover",
          officeName: office.name,
          reason: reason || undefined,
        })
        .catch((err) => {
          req.log.warn(
            { err, officeId: office.id },
            "[email] quick-card-cover rejected notification failed",
          );
        });
    }

    res.json(await serializeAdminApplicationDetail(updated));
  },
);

// ── Admin: Gallery / Decision-Card-Cover item approval endpoints ─────────────

router.post(
  "/admin/applications/:officeId/media/:mediaId/approve",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const officeId = Number(req.params.officeId);
    const mediaId = Number(req.params.mediaId);
    if (!Number.isFinite(officeId) || !Number.isFinite(mediaId)) {
      res.status(400).json({ error: "Invalid officeId or mediaId" });
      return;
    }

    const [office] = await db
      .select()
      .from(officesTable)
      .where(eq(officesTable.id, officeId));
    if (!office) {
      res.status(404).json({ error: "Office not found" });
      return;
    }

    const [mediaRow] = await db
      .select()
      .from(officeMediaTable)
      .where(
        and(
          eq(officeMediaTable.id, mediaId),
          eq(officeMediaTable.officeId, officeId),
        ),
      );
    if (!mediaRow) {
      res.status(404).json({ error: "Media item not found" });
      return;
    }

    // If approving a decision_card_cover, demote any other currently-approved
    // decision_card_cover for this office to 'rejected' so only one is live.
    if (mediaRow.placement === "decision_card_cover") {
      await db
        .update(officeMediaTable)
        .set({ status: "rejected" })
        .where(
          and(
            eq(officeMediaTable.officeId, officeId),
            eq(officeMediaTable.placement, "decision_card_cover"),
            eq(officeMediaTable.status, "approved"),
          ),
        );
    }

    const [approved] = mediaRow.placement === "works"
      ? await db.transaction(async (tx) => {
          await tx.execute(sql`SELECT pg_advisory_xact_lock(${officeId}, 119)`);
          const [updated] = await tx
            .update(officeMediaTable)
            .set({ status: "approved", rejectionReason: null })
            .where(eq(officeMediaTable.id, mediaId))
            .returning();
          const worksRows = await tx
            .select({ id: officeMediaTable.id, sortOrder: officeMediaTable.sortOrder })
            .from(officeMediaTable)
            .where(and(
              eq(officeMediaTable.officeId, officeId),
              eq(officeMediaTable.placement, "works"),
              sql`${officeMediaTable.status} != 'rejected'`,
            ));
          await Promise.all(worksRows
            .sort((a, b) => (a.sortOrder ?? a.id) - (b.sortOrder ?? b.id))
            .map((item, index) => tx.update(officeMediaTable).set({ sortOrder: index + 1 })
              .where(eq(officeMediaTable.id, item.id))));
          return [updated];
        })
      : await db
          .update(officeMediaTable)
          .set({ status: "approved", rejectionReason: null })
          .where(eq(officeMediaTable.id, mediaId))
          .returning();
    // Keep the independently ordered Works surface contiguous as pending items
    // become public (rejected rows are intentionally excluded).

    await recordAuditLog({
      actor: req.session.user,
      action: "office.media.approve",
      targetType: "office",
      targetId: officeId,
      metadata: { mediaId, placement: mediaRow.placement },
    });

    // Notify the office owner — fire-and-forget.
    const [officeUser] = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, office.userId));
    if (officeUser?.email) {
      const placement: MediaPlacement =
        mediaRow.placement === "decision_card_cover"
          ? "decision_card_cover"
          : mediaRow.placement === "works"
            ? "works"
            : "gallery";
      emailProvider
        .sendMediaApprovedEmail({
          to: officeUser.email,
          locale: "ar",
          placement,
          officeName: office.name,
        })
        .catch((err) => {
          req.log.warn(
            { err, officeId, mediaId },
            "[email] media approved notification failed",
          );
        });
    }

    res.json(await serializeAdminApplicationDetail(office));
    void approved; // suppress unused var
  },
);

router.post(
  "/admin/applications/:officeId/media/:mediaId/reject",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const officeId = Number(req.params.officeId);
    const mediaId = Number(req.params.mediaId);
    if (!Number.isFinite(officeId) || !Number.isFinite(mediaId)) {
      res.status(400).json({ error: "Invalid officeId or mediaId" });
      return;
    }
    const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";

    const [office] = await db
      .select()
      .from(officesTable)
      .where(eq(officesTable.id, officeId));
    if (!office) {
      res.status(404).json({ error: "Office not found" });
      return;
    }

    const [mediaRow] = await db
      .select()
      .from(officeMediaTable)
      .where(
        and(
          eq(officeMediaTable.id, mediaId),
          eq(officeMediaTable.officeId, officeId),
        ),
      );
    if (!mediaRow) {
      res.status(404).json({ error: "Media item not found" });
      return;
    }

    if (mediaRow.placement === "works") {
      await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${officeId}, 119)`);
        await tx.update(officeMediaTable)
          .set({ status: "rejected", rejectionReason: reason || null })
          .where(eq(officeMediaTable.id, mediaId));
        const remainingWorks = await tx
          .select({ id: officeMediaTable.id, sortOrder: officeMediaTable.sortOrder })
          .from(officeMediaTable)
          .where(and(
            eq(officeMediaTable.officeId, officeId),
            eq(officeMediaTable.placement, "works"),
            sql`${officeMediaTable.status} != 'rejected'`,
          ));
        await Promise.all(remainingWorks
          .sort((a, b) => (a.sortOrder ?? a.id) - (b.sortOrder ?? b.id))
          .map((item, index) => tx.update(officeMediaTable).set({ sortOrder: index + 1 })
            .where(eq(officeMediaTable.id, item.id))));
      });
    } else {
      await db.update(officeMediaTable)
        .set({ status: "rejected", rejectionReason: reason || null })
        .where(eq(officeMediaTable.id, mediaId));
    }

    await recordAuditLog({
      actor: req.session.user,
      action: "office.media.reject",
      targetType: "office",
      targetId: officeId,
      metadata: { mediaId, placement: mediaRow.placement, reason },
    });

    // Notify the office owner — fire-and-forget.
    const [officeUser] = await db
      .select({ email: usersTable.email })
      .from(usersTable)
      .where(eq(usersTable.id, office.userId));
    if (officeUser?.email) {
      const placement: MediaPlacement =
        mediaRow.placement === "decision_card_cover"
          ? "decision_card_cover"
          : mediaRow.placement === "works"
            ? "works"
            : "gallery";
      emailProvider
        .sendMediaRejectedEmail({
          to: officeUser.email,
          locale: "ar",
          placement,
          officeName: office.name,
          reason: reason || undefined,
        })
        .catch((err) => {
          req.log.warn(
            { err, officeId, mediaId },
            "[email] media rejected notification failed",
          );
        });
    }

    res.json(await serializeAdminApplicationDetail(office));
  },
);

router.get(
  "/admin/customers",
  requireRole("admin"),
  async (_req: Request, res: Response): Promise<void> => {
    const customers = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.role, "customer"));

    const result = await Promise.all(
      customers.map(async (customer) => {
        const [favouritesCount] = await db
          .select({ count: count() })
          .from(favouritesTable)
          .where(eq(favouritesTable.customerUserId, customer.id));

        return {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          phone: customer.phone ?? null,
          status: customer.status,
          statusReason: customer.statusReason ?? null,
          createdAt: customer.createdAt,
          favouritesCount: favouritesCount?.count ?? 0,
        };
      }),
    );

    res.json(ListAdminCustomersResponse.parse(result));
  },
);

router.patch(
  "/admin/customers/:userId/status",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const params = SetAdminCustomerStatusParams.safeParse(req.params);
    const body = SetAdminCustomerStatusBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res
        .status(400)
        .json({ error: params.error?.message ?? body.error?.message });
      return;
    }

    const [customer] = await db
      .select()
      .from(usersTable)
      .where(
        and(
          eq(usersTable.id, params.data.userId),
          eq(usersTable.role, "customer"),
        ),
      );
    if (!customer) {
      res.status(404).json({ error: "Customer not found" });
      return;
    }

    const [updated] = await db
      .update(usersTable)
      .set({
        status: body.data.status,
        statusReason: body.data.reason ?? null,
        statusChangedAt: new Date(),
        statusChangedBy: req.session.user!.id,
      })
      .where(eq(usersTable.id, customer.id))
      .returning();

    await recordAuditLog({
      actor: req.session.user,
      action: "customer.status.change",
      targetType: "user",
      targetId: customer.id,
      metadata: { status: body.data.status, reason: body.data.reason ?? null },
    });

    const [favouritesCount] = await db
      .select({ count: count() })
      .from(favouritesTable)
      .where(eq(favouritesTable.customerUserId, customer.id));

    res.json(
      SetAdminCustomerStatusResponse.parse({
        id: updated.id,
        name: updated.name,
        email: updated.email,
        phone: updated.phone ?? null,
        status: updated.status,
        statusReason: updated.statusReason ?? null,
        createdAt: updated.createdAt,
        favouritesCount: favouritesCount?.count ?? 0,
      }),
    );
  },
);

router.get(
  "/admin/contact-events",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = ListAdminContactEventsQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const limit = Math.min(parsed.data.limit ?? 50, 200);

    const rows = await db
      .select({
        id: contactEventsTable.id,
        officeId: contactEventsTable.officeId,
        actionType: contactEventsTable.actionType,
        sourcePage: contactEventsTable.sourcePage,
        language: contactEventsTable.language,
        createdAt: contactEventsTable.createdAt,
        customerName: usersTable.name,
        officeName: officesTable.name,
      })
      .from(contactEventsTable)
      .innerJoin(usersTable, eq(usersTable.id, contactEventsTable.customerUserId))
      .innerJoin(officesTable, eq(officesTable.id, contactEventsTable.officeId))
      .orderBy(desc(contactEventsTable.createdAt))
      .limit(limit);

    res.json(ListAdminContactEventsResponse.parse(rows));
  },
);

router.get(
  "/admin/video-call-requests",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = ListAdminVideoCallRequestsQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const limit = Math.min(parsed.data.limit ?? 50, 200);

    const rows = await db
      .select({
        id: videoCallRequestsTable.id,
        officeId: videoCallRequestsTable.officeId,
        preferredDate: videoCallRequestsTable.preferredDate,
        preferredTime: videoCallRequestsTable.preferredTime,
        timezone: videoCallRequestsTable.timezone,
        contactNumber: videoCallRequestsTable.contactNumber,
        note: videoCallRequestsTable.note,
        status: videoCallRequestsTable.status,
        createdAt: videoCallRequestsTable.createdAt,
        updatedAt: videoCallRequestsTable.updatedAt,
        customerName: usersTable.name,
        officeName: officesTable.name,
      })
      .from(videoCallRequestsTable)
      .innerJoin(
        usersTable,
        eq(usersTable.id, videoCallRequestsTable.customerUserId),
      )
      .innerJoin(officesTable, eq(officesTable.id, videoCallRequestsTable.officeId))
      .orderBy(desc(videoCallRequestsTable.createdAt))
      .limit(limit);

    res.json(ListAdminVideoCallRequestsResponse.parse(rows));
  },
);

router.get(
  "/admin/audit-log",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = ListAuditLogQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const limit = Math.min(parsed.data.limit ?? 50, 200);

    const entries = await db
      .select()
      .from(auditLogTable)
      .orderBy(desc(auditLogTable.createdAt))
      .limit(limit);

    res.json(ListAuditLogResponse.parse(entries));
  },
);

// ── GET /api/admin/overview-stats ─────────────────────────────────────────────
// Returns server-side totals used by the Operations Center KPI cards.
// No cap — counts the full tables. Never returns misleading "200" for total
// interactions when there are more than 200 rows.
router.get(
  "/admin/overview-stats",
  requireRole("admin"),
  async (_req: Request, res: Response): Promise<void> => {
    const result = await pool.query<{
      total_interactions: string;
      contacts_today: string;
      video_calls_today: string;
    }>(`
      SELECT
        (SELECT COUNT(*) FROM contact_events) +
        (SELECT COUNT(*) FROM video_call_requests)              AS total_interactions,
        (SELECT COUNT(*) FROM contact_events
         WHERE created_at::date = CURRENT_DATE)                 AS contacts_today,
        (SELECT COUNT(*) FROM video_call_requests
         WHERE created_at::date = CURRENT_DATE)                 AS video_calls_today
    `);
    const row = result.rows[0];
    res.json({
      totalInteractions: parseInt(row.total_interactions, 10),
      contactsToday:     parseInt(row.contacts_today,     10),
      videoCallsToday:   parseInt(row.video_calls_today,  10),
    });
  },
);

// ── GET /api/admin/contact-analytics ─────────────────────────────────────────
// Server-side filtered, paginated event log combining contact_events and
// video_call_requests. Also returns per-type aggregate counts (including
// QR visits from analytics_events — the correct source for qr_visit events).
//
// Query params:
//   officeId   (optional int)
//   dateFrom   (optional ISO date, e.g. "2024-01-01")
//   dateTo     (optional ISO date, inclusive)
//   actionType (optional string — filters event log, not counts)
//   page       (default 1)
//   limit      (default 25, max 100)
router.get(
  "/admin/contact-analytics",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const rawOfficeId  = req.query.officeId ? Number(req.query.officeId) : null;
    const rawDateFrom  = typeof req.query.dateFrom   === "string" && req.query.dateFrom   ? req.query.dateFrom   : null;
    const rawDateTo    = typeof req.query.dateTo     === "string" && req.query.dateTo     ? req.query.dateTo     : null;
    const rawType      = typeof req.query.actionType === "string" && req.query.actionType ? req.query.actionType : null;
    const pageNum      = Math.max(1, parseInt(String(req.query.page  ?? "1"),  10) || 1);
    const pageLimit    = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "25"), 10) || 25));
    const pageOffset   = (pageNum - 1) * pageLimit;

    if (rawOfficeId !== null && !Number.isFinite(rawOfficeId)) {
      res.status(400).json({ error: "Invalid officeId" });
      return;
    }

    // ── Aggregate counts (no action-type filter — KPI cards always show full
    //    per-type totals regardless of the event-log filter) ──────────────────
    const cntParams: unknown[] = [];
    let cntPi = 0;
    const cntP = (v: unknown) => { cntParams.push(v); return `$${++cntPi}`; };

    const ceCntClauses: string[] = [];
    if (rawOfficeId !== null) ceCntClauses.push(`ce.office_id = ${cntP(rawOfficeId)}`);
    if (rawDateFrom)           ceCntClauses.push(`ce.created_at >= ${cntP(rawDateFrom)}::date`);
    if (rawDateTo)             ceCntClauses.push(`ce.created_at < (${cntP(rawDateTo)}::date + interval '1 day')`);
    const ceCntWhere = ceCntClauses.length ? " WHERE " + ceCntClauses.join(" AND ") : "";
    const ceCntParams = [...cntParams];
    const ceCntPi = cntPi;

    const vcrCntClauses: string[] = [];
    let vcrCntPi = 0; const vcrCntParams: unknown[] = [];
    const vcrCntP = (v: unknown) => { vcrCntParams.push(v); return `$${++vcrCntPi}`; };
    if (rawOfficeId !== null) vcrCntClauses.push(`vcr.office_id = ${vcrCntP(rawOfficeId)}`);
    if (rawDateFrom)           vcrCntClauses.push(`vcr.created_at >= ${vcrCntP(rawDateFrom)}::date`);
    if (rawDateTo)             vcrCntClauses.push(`vcr.created_at < (${vcrCntP(rawDateTo)}::date + interval '1 day')`);
    const vcrCntWhere = vcrCntClauses.length ? " WHERE " + vcrCntClauses.join(" AND ") : "";

    const aeClauses: string[] = [
      "ae.event_type = 'qr_visit'",
      "ae.is_bot = false",
      "ae.is_internal_actor = false",
    ];
    let aePi = 0; const aeParams: unknown[] = [];
    const aeP = (v: unknown) => { aeParams.push(v); return `$${++aePi}`; };
    if (rawOfficeId !== null) aeClauses.push(`ae.office_id = ${aeP(rawOfficeId)}`);
    if (rawDateFrom)           aeClauses.push(`ae.occurred_at >= ${aeP(rawDateFrom)}::date`);
    if (rawDateTo)             aeClauses.push(`ae.occurred_at < (${aeP(rawDateTo)}::date + interval '1 day')`);
    const aeWhere = " WHERE " + aeClauses.join(" AND ");

    const [ceCountsRes, vcrCountRes, qrCountRes] = await Promise.all([
      pool.query<{ action_type: string; cnt: string }>(
        `SELECT ce.action_type, COUNT(*) AS cnt
         FROM contact_events ce${ceCntWhere}
         GROUP BY ce.action_type`,
        ceCntParams,
      ),
      pool.query<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt FROM video_call_requests vcr${vcrCntWhere}`,
        vcrCntParams,
      ),
      pool.query<{ cnt: string }>(
        `SELECT COUNT(*) AS cnt FROM analytics_events ae${aeWhere}`,
        aeParams,
      ),
    ]);

    const countMap: Record<string, number> = {};
    for (const r of ceCountsRes.rows) countMap[r.action_type] = parseInt(r.cnt, 10);
    countMap["video_call_request"] = parseInt(vcrCountRes.rows[0]?.cnt ?? "0", 10);
    countMap["qr_visit"]           = parseInt(qrCountRes.rows[0]?.cnt  ?? "0", 10);

    // ── Event log: UNION ALL of contact_events + video_call_requests ──────────
    // QR visits are page-view events — they do not appear in the contact log.
    type EventRow = {
      id: number;
      customerName: string;
      officeName: string;
      officeId: number;
      actionType: string;
      createdAt: string;
    };
    let items: EventRow[] = [];
    let total = 0;

    if (rawType !== "qr_visit") {
      const includeCe  = !rawType || rawType !== "video_call_request";
      const includeVcr = !rawType || rawType === "video_call_request";

      const uParams: unknown[] = [];
      let uPi = 0;
      const uP = (v: unknown) => { uParams.push(v); return `$${++uPi}`; };

      const parts: string[] = [];

      if (includeCe) {
        const cc: string[] = [];
        if (rawOfficeId !== null)                             cc.push(`ce.office_id = ${uP(rawOfficeId)}`);
        if (rawDateFrom)                                       cc.push(`ce.created_at >= ${uP(rawDateFrom)}::date`);
        if (rawDateTo)                                         cc.push(`ce.created_at < (${uP(rawDateTo)}::date + interval '1 day')`);
        if (rawType && rawType !== "video_call_request")       cc.push(`ce.action_type = ${uP(rawType)}`);
        const ceW = cc.length ? " WHERE " + cc.join(" AND ") : "";
        parts.push(
          `SELECT ce.id, u.name AS customer_name, o.name AS office_name,` +
          `       ce.office_id, ce.action_type, ce.created_at` +
          ` FROM contact_events ce` +
          ` JOIN users u ON u.id = ce.customer_user_id` +
          ` JOIN offices o ON o.id = ce.office_id${ceW}`,
        );
      }

      if (includeVcr) {
        const vc: string[] = [];
        if (rawOfficeId !== null) vc.push(`vcr.office_id = ${uP(rawOfficeId)}`);
        if (rawDateFrom)           vc.push(`vcr.created_at >= ${uP(rawDateFrom)}::date`);
        if (rawDateTo)             vc.push(`vcr.created_at < (${uP(rawDateTo)}::date + interval '1 day')`);
        const vcrW = vc.length ? " WHERE " + vc.join(" AND ") : "";
        parts.push(
          `SELECT vcr.id, u.name AS customer_name, o.name AS office_name,` +
          `       vcr.office_id, 'video_call_request' AS action_type, vcr.created_at` +
          ` FROM video_call_requests vcr` +
          ` JOIN users u ON u.id = vcr.customer_user_id` +
          ` JOIN offices o ON o.id = vcr.office_id${vcrW}`,
        );
      }

      if (parts.length > 0) {
        const unionSql = parts.join(" UNION ALL ");

        // Count first (before adding LIMIT/OFFSET params)
        const countParams = [...uParams];
        const countRes = await pool.query<{ cnt: string }>(
          `SELECT COUNT(*) AS cnt FROM (${unionSql}) combined`,
          countParams,
        );
        total = parseInt(countRes.rows[0]?.cnt ?? "0", 10);

        // Paged items
        const limitParam  = uP(pageLimit);
        const offsetParam = uP(pageOffset);
        const itemsRes = await pool.query<{
          id: number;
          customer_name: string | null;
          office_name: string | null;
          office_id: number;
          action_type: string;
          created_at: string;
        }>(
          `SELECT * FROM (${unionSql}) combined` +
          ` ORDER BY created_at DESC LIMIT ${limitParam} OFFSET ${offsetParam}`,
          uParams,
        );

        items = itemsRes.rows.map((r) => ({
          id:           r.id,
          customerName: r.customer_name ?? "—",
          officeName:   r.office_name   ?? "—",
          officeId:     r.office_id,
          actionType:   r.action_type,
          createdAt:    String(r.created_at),
        }));
      }
    }

    res.json({
      counts: {
        whatsapp_click:     countMap["whatsapp_click"]     ?? 0,
        share_click:        countMap["share_click"]        ?? 0,
        location_click:     countMap["location_click"]     ?? 0,
        video_call_request: countMap["video_call_request"] ?? 0,
        qr_visit:           countMap["qr_visit"]           ?? 0,
      },
      items,
      total,
      page:       pageNum,
      limit:      pageLimit,
      totalPages: Math.max(1, Math.ceil(total / pageLimit)),
    });
  },
);

// ── GET /api/admin/activity-log ───────────────────────────────────────────────
// Server-side filtered and paginated audit log. Replaces the old /admin/audit-log
// endpoint for the Activity Log section (old endpoint kept for backwards compat).
//
// Query params:
//   search   (optional text — ILIKE on action field)
//   category (optional prefix — e.g. "office.application")
//   page     (default 1)
//   limit    (default 25, max 100)
router.get(
  "/admin/activity-log",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const pageLimit = Math.min(100, Math.max(1, parseInt(String(req.query.limit ?? "25"), 10) || 25));
    const pageNum   = Math.max(1,              parseInt(String(req.query.page  ?? "1"),  10) || 1);
    const pageOffset = (pageNum - 1) * pageLimit;
    const search    = typeof req.query.search   === "string" ? req.query.search.trim()   : "";
    const category  = typeof req.query.category === "string" ? req.query.category.trim() : "";

    const params: unknown[] = [];
    let pi = 0;
    const p = (v: unknown) => { params.push(v); return `$${++pi}`; };

    const clauses: string[] = [];
    if (search)                      clauses.push(`action ILIKE ${p(`%${search}%`)}`);
    if (category && category !== "all") clauses.push(`action LIKE ${p(`${category}%`)}`);

    const where = clauses.length ? " WHERE " + clauses.join(" AND ") : "";

    // Count without LIMIT params
    const countParams = [...params];
    const countRes = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM audit_log${where}`,
      countParams,
    );
    const total = parseInt(countRes.rows[0]?.cnt ?? "0", 10);

    // Items
    const limitParam  = p(pageLimit);
    const offsetParam = p(pageOffset);
    const itemsRes = await pool.query<{
      id: number;
      actor_id: number | null;
      actor_role: string | null;
      action: string;
      target_type: string | null;
      target_id: number | null;
      metadata: string | null;
      created_at: string;
    }>(
      `SELECT id, actor_id, actor_role, action, target_type, target_id, metadata, created_at
       FROM audit_log${where}
       ORDER BY created_at DESC
       LIMIT ${limitParam} OFFSET ${offsetParam}`,
      params,
    );

    res.json({
      items: itemsRes.rows.map((r) => ({
        id:         r.id,
        actorId:    r.actor_id,
        actorRole:  r.actor_role,
        action:     r.action,
        targetType: r.target_type,
        targetId:   r.target_id,
        metadata:   r.metadata,
        createdAt:  String(r.created_at),
      })),
      total,
      page:       pageNum,
      limit:      pageLimit,
      totalPages: Math.max(1, Math.ceil(total / pageLimit)),
    });
  },
);

// ── Market Supply Control endpoints ──────────────────────────────────────────
// All routes require admin role.
// Data safeguard: these routes only write to market_supply_control — they
// never touch offices, subscriptions, or any provider-facing data.


// ── Supply Cap Management ─────────────────────────────────────────────────────
//
// Three routes manage the admin-controlled supply cap for each market:
//
//   PUT  /admin/market-supply/controls/:id/cap
//     Set or update the supply cap for a specific market.
//     Writes one row to market_supply_cap_history.
//     Invariant: supply_cap in market_supply_control is ONLY changed here
//     and via the cap-decision route below.  runMarketRecompute NEVER touches it.
//
//   POST /admin/market-supply/controls/:id/cap-decision
//     Approve or reject the intelligence cap recommendation.
//     On approval: supply_cap = recommended_supply_cap.
//     On rejection: supply_cap is unchanged; history row records the reject.
//
//   GET  /admin/market-supply/controls/:id/cap-history
//     Returns immutable audit history of cap changes for this market.

const CapSetBody = z.object({
  /** New supply cap (positive integer) or null to make the market uncapped. */
  supplyCap: z.number().int().positive().nullable(),
  /** Mandatory reason for audit trail (min 5 chars). */
  reason:    z.string().min(5, "reason must be at least 5 characters"),
  /** Optional: admin may manually set cap_status to 'paused'. */
  pause:     z.boolean().optional(),
});

const CapDecisionBody = z.object({
  decision: z.enum(["approved", "rejected"]),
  reason:   z.string().optional(),
});

// ── PUT: set / change supply cap ──────────────────────────────────────────────
router.put(
  "/admin/market-supply/controls/:id/cap",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id as string, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const body = CapSetBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    const [existing] = await db
      .select()
      .from(marketSupplyControlTable)
      .where(eq(marketSupplyControlTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Market control record not found" });
      return;
    }

    const newCap       = body.data.supplyCap;
    const previousCap  = existing.supplyCap ?? null;
    const marketKey    = `${existing.countryCode}|${existing.cityId}|${existing.categoryId}`;

    // Count current allocated slots for audit context and cap_status derivation.
    // Uses market_slot_allocations — hidden offices do NOT consume slots.
    const currentSlotConsumers = await countAllocatedSlotsForMarket(marketKey);

    const actionType: string =
      newCap === null       ? "removed"
      : previousCap === null ? "set_initial"
      :                        "admin_adjustment";

    const capSource: string | null =
      newCap === null       ? null
      : previousCap === null ? "manual_initial"
      :                        "admin_adjustment";

    const capStatus: string = body.data.pause
      ? "paused"
      : newCap === null
        ? "available"
        : computeCapStatus(newCap, currentSlotConsumers);

    const now = new Date();

    await db
      .update(marketSupplyControlTable)
      .set({
        supplyCap:      newCap,
        capStatus,
        capSource,
        capUpdatedAt:   now,
        capUpdatedBy:   req.session.user!.id,
        updatedAt:      now,
      })
      .where(eq(marketSupplyControlTable.id, id));

    // Immutable audit row
    await db.insert(marketSupplyCapHistoryTable).values({
      countryCode:              existing.countryCode,
      cityId:                   existing.cityId,
      categoryId:               existing.categoryId,
      previousCap,
      newCap,
      actionType,
      changedBy:                req.session.user!.id,
      reason:                   body.data.reason,
      recommendedCap:           existing.recommendedSupplyCap ?? null,
      recommendationConfidence: existing.capRecommendationConfidence ?? null,
      currentActiveSupply:      currentSlotConsumers,
    });

    await recordAuditLog({
      actor:      req.session.user,
      action:     `admin.supply_cap.${actionType}`,
      targetType: "market",
      targetId:   id,
      metadata: {
        marketKey,
        previousCap,
        newCap,
        currentSlotConsumers,
        reason: body.data.reason,
      },
    });

    // Return updated row
    const [updated] = await db
      .select()
      .from(marketSupplyControlTable)
      .where(eq(marketSupplyControlTable.id, id));

    res.json({
      ...updated,
      currentSlotConsumers,
      remainingSlots: newCap !== null ? Math.max(0, newCap - currentSlotConsumers) : null,
    });

    // If capacity was increased (or cap removed → uncapped), promote waiting offices.
    const capacityIncreased =
      (newCap === null && previousCap !== null) ||               // cap removed → uncapped
      (newCap !== null && (previousCap === null || newCap > previousCap)); // cap raised

    if (capacityIncreased) {
      processWaitlist(marketKey).catch((err) =>
        console.error("[slot] processWaitlist failed after cap increase:", err),
      );
    }
  },
);

// ── POST: approve / reject intelligence cap recommendation ────────────────────
router.post(
  "/admin/market-supply/controls/:id/cap-decision",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id as string, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const body = CapDecisionBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    const [existing] = await db
      .select()
      .from(marketSupplyControlTable)
      .where(eq(marketSupplyControlTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Market control record not found" });
      return;
    }

    if (!existing.recommendedSupplyCap) {
      res.status(400).json({
        error: "No intelligence recommendation exists for this market. Run compute first.",
      });
      return;
    }

    const previousCap = existing.supplyCap ?? null;
    const { decision } = body.data;
    const marketKey   = `${existing.countryCode}|${existing.cityId}|${existing.categoryId}`;

    // Count current allocated slots for audit context.
    // Uses market_slot_allocations (canonical consumer count) — hidden/released
    // offices are correctly excluded, unlike the old offices-table count.
    const currentSlotConsumers = await countAllocatedSlotsForMarket(marketKey);

    const now = new Date();

    if (decision === "approved") {
      // Apply recommendation → update supply_cap
      const newCap    = existing.recommendedSupplyCap;
      const capStatus = computeCapStatus(newCap, currentSlotConsumers);

      await db
        .update(marketSupplyControlTable)
        .set({
          supplyCap:    newCap,
          capStatus,
          capSource:    "approved_intelligence_recommendation",
          capUpdatedAt: now,
          capUpdatedBy: req.session.user!.id,
          updatedAt:    now,
        })
        .where(eq(marketSupplyControlTable.id, id));

      // Immutable audit row
      await db.insert(marketSupplyCapHistoryTable).values({
        countryCode:              existing.countryCode,
        cityId:                   existing.cityId,
        categoryId:               existing.categoryId,
        previousCap,
        newCap,
        actionType:               "approved_recommendation",
        changedBy:                req.session.user!.id,
        reason:                   body.data.reason ?? null,
        recommendedCap:           existing.recommendedSupplyCap,
        recommendationConfidence: existing.capRecommendationConfidence ?? null,
        currentActiveSupply:      currentSlotConsumers,
      });
    } else {
      // Rejected — cap unchanged; only write history
      await db.insert(marketSupplyCapHistoryTable).values({
        countryCode:              existing.countryCode,
        cityId:                   existing.cityId,
        categoryId:               existing.categoryId,
        previousCap,
        newCap:                   previousCap, // unchanged — null is valid (removed/uncapped)
        actionType:               "rejected_recommendation",
        changedBy:                req.session.user!.id,
        reason:                   body.data.reason ?? null,
        recommendedCap:           existing.recommendedSupplyCap,
        recommendationConfidence: existing.capRecommendationConfidence ?? null,
        currentActiveSupply:      currentSlotConsumers,
      });
    }

    await recordAuditLog({
      actor:      req.session.user,
      action:     `admin.supply_cap.recommendation.${decision}`,
      targetType: "market",
      targetId:   id,
      metadata: {
        marketKey,
        previousCap,
        recommendedCap:   existing.recommendedSupplyCap,
        newCap:           decision === "approved" ? existing.recommendedSupplyCap : previousCap,
        confidence:       existing.capRecommendationConfidence,
        currentSlotConsumers,
        reason:           body.data.reason,
      },
    });

    const [updated] = await db
      .select()
      .from(marketSupplyControlTable)
      .where(eq(marketSupplyControlTable.id, id));

    const approvedCap = decision === "approved" ? existing.recommendedSupplyCap : previousCap;

    res.json({
      decision,
      marketKey,
      previousCap,
      newCap:    approvedCap,
      ...updated,
      currentSlotConsumers,
      remainingSlots: updated.supplyCap !== null
        ? Math.max(0, updated.supplyCap - currentSlotConsumers)
        : null,
    });

    // If recommendation was approved and cap increased, promote waiting offices
    if (decision === "approved") {
      const capIncreased =
        approvedCap === null ||                           // cap removed → uncapped
        previousCap === null ||                           // first cap set
        (approvedCap !== null && approvedCap > (previousCap ?? 0));
      if (capIncreased) {
        processWaitlist(marketKey).catch((err) =>
          console.error("[slot] processWaitlist failed after recommendation approval:", err),
        );
      }
    }
  },
);

// ── GET: cap history for a market ─────────────────────────────────────────────
router.get(
  "/admin/market-supply/controls/:id/cap-history",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(req.params.id as string, 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const [existing] = await db
      .select()
      .from(marketSupplyControlTable)
      .where(eq(marketSupplyControlTable.id, id));
    if (!existing) {
      res.status(404).json({ error: "Market control record not found" });
      return;
    }

    const rows = await pool.query<{
      id:                        number;
      previous_cap:              number | null;
      new_cap:                   number | null;
      action_type:               string;
      changed_by:                number | null;
      changed_by_name:           string | null;
      reason:                    string | null;
      recommended_cap:           number | null;
      recommendation_confidence: number | null;
      current_active_supply:     number | null;
      created_at:                string;
    }>(
      `SELECT
         h.id, h.previous_cap, h.new_cap, h.action_type,
         h.changed_by, u.name AS changed_by_name,
         h.reason, h.recommended_cap, h.recommendation_confidence,
         h.current_active_supply, h.created_at
       FROM market_supply_cap_history h
       LEFT JOIN users u ON u.id = h.changed_by
       WHERE h.country_code = $1 AND h.city_id = $2 AND h.category_id = $3
       ORDER BY h.created_at DESC
       LIMIT 100`,
      [existing.countryCode, existing.cityId, existing.categoryId],
    );

    res.json({ items: rows.rows, marketKey: `${existing.countryCode}|${existing.cityId}|${existing.categoryId}` });
  },
);

// GET /api/admin/market-supply/signals
// Computes live market signals + classification. Read-only (no DB writes).
router.get(
  "/admin/market-supply/signals",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const markets = await fetchAllMarketSignals();
      const results = markets.map(({ countryCode, cityId, categoryId, signals, lastSignalDate }) => {
        const classification = classifyMarket(signals);
        return {
          countryCode,
          cityId,
          categoryId,
          ...classification,
          signals,
          lastSignalDate,
        };
      });
      res.json({ items: results, computedAt: new Date().toISOString() });
    } catch (err) {
      req.log?.error?.({ err }, "market-supply/signals failed");
      res.status(500).json({ error: "Signal computation failed" });
    }
  },
);

// GET /api/admin/market-supply/controls
// Returns persisted control records from market_supply_control.
router.get(
  "/admin/market-supply/controls",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const rows = await db.select().from(marketSupplyControlTable)
      .orderBy(desc(marketSupplyControlTable.updatedAt));
    res.json({ items: rows });
  },
);

// POST /api/admin/market-supply/controls/compute
// Computes signals for all markets, classifies each, then upserts into
// market_supply_control.  This is the only route that writes computed results.
// The actual compute logic lives in lib/marketRecompute.ts so the scheduler
// can call it directly without going through HTTP.
router.post(
  "/admin/market-supply/controls/compute",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await runMarketRecompute("admin", req.session.user ?? null);
      res.json(result);
    } catch (err) {
      req.log?.error?.({ err }, "market-supply/controls/compute failed");
      res.status(500).json({ error: "Compute failed" });
    }
  },
);

// POST /api/admin/market-supply/controls/:id/decision
// Admin approves, rejects, or sets to monitoring a pending recommendation.
// On 'approved', copies pendingRecommendation into acceptanceStatus.
router.post(
  "/admin/market-supply/controls/:id/decision",
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }

    const { decision, note } = req.body as { decision?: string; note?: string };
    if (!["approved", "rejected", "monitoring"].includes(decision ?? "")) {
      res.status(400).json({ error: "decision must be 'approved', 'rejected', or 'monitoring'" });
      return;
    }

    const [existing] = await db
      .select()
      .from(marketSupplyControlTable)
      .where(eq(marketSupplyControlTable.id, id));

    if (!existing) {
      res.status(404).json({ error: "Market control record not found" });
      return;
    }

    // Map from pendingRecommendation to acceptanceStatus when admin approves.
    //
    // pendingRecommendation now stores the classifier's recommendedAcceptance
    // ("recruit" | "open" | "limited" | "closed" | "monitor").
    //
    // "monitor" is a signal to the admin that no automatic gate change is safe —
    // approving a "monitor" recommendation keeps the current acceptance status
    // unchanged (or demotes "open"→"limited" as a conservative fallback).
    //
    // Legacy rows (pre-calibration) stored the marketStatus string; the fallback
    // map below handles those gracefully.
    const ACCEPTANCE_PASSTHROUGH = new Set(["recruit", "open", "limited", "closed"]);
    const LEGACY_STATUS_MAP: Record<string, string> = {
      need_more_supply:  "recruit",
      balanced:          "open",
      near_saturation:   "limited",
      oversupplied:      "closed",
      // Fixed: these two were "open" — that was dangerous
      weak_demand:       "limited",
      insufficient_data: "limited",
    };

    let newAcceptance = existing.acceptanceStatus ?? "open";
    if (decision === "approved" && existing.pendingRecommendation) {
      const rec = existing.pendingRecommendation;
      if (ACCEPTANCE_PASSTHROUGH.has(rec)) {
        newAcceptance = rec;
      } else if (rec === "monitor") {
        // "monitor" means: do not expand — demote to limited if currently open,
        // otherwise keep the existing gate (limited/closed/recruit stay as-is)
        newAcceptance =
          existing.acceptanceStatus === "open" || existing.acceptanceStatus == null
            ? "limited"
            : existing.acceptanceStatus;
      } else {
        // Legacy marketStatus string in old DB rows
        newAcceptance = LEGACY_STATUS_MAP[rec] ?? existing.acceptanceStatus ?? "open";
      }
    }

    const now = new Date();
    const [updated] = await db
      .update(marketSupplyControlTable)
      .set({
        adminReviewDecision: decision as "approved" | "rejected" | "monitoring",
        adminReviewedBy:     req.session.user!.id,
        adminReviewNote:     note ?? null,
        lastReviewedAt:      now,
        acceptanceStatus:    newAcceptance as "recruit" | "open" | "limited" | "closed",
        updatedAt:           now,
      })
      .where(eq(marketSupplyControlTable.id, id))
      .returning();

    await recordAuditLog({
      actor: req.session.user,
      action: `admin.market_supply.decision.${decision}`,
      targetType: "market_supply_control",
      targetId: id,
      metadata: { note, newAcceptanceStatus: newAcceptance },
    });

    res.json(updated);
  },
);

export default router;

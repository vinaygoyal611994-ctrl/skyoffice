import { Readable } from "node:stream";
import { Router, type IRouter, type Request, type Response } from "express";
import { db, pool, officesTable, usersTable, auditLogTable } from "@workspace/db";
import {
  serviceRequestsTable,
  serviceRequestReviewsTable,
  serviceRequestAttachmentsTable,
  serviceRequestAttachmentReservationsTable,
} from "@workspace/db";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import {
  RegisterServiceRequestAttachmentBody,
  RequestServiceRequestAttachmentUploadUrlBody,
  SubmitServiceRequestBody,
  SendOfferBody,
  SubmitServiceReviewBody,
  ServiceRequestAttachmentIdParams,
  ServiceRequestIdParams,
  ServiceMetricsSlugParams,
} from "@workspace/api-zod";
import { requireRole } from "../middlewares/authMiddleware";
import { getOfficeIdForUser } from "../lib/auth";
import { enqueueServiceRequestNotifications } from "../lib/serviceRequestNotificationOutbox";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import {
  hasValidServiceRequestAttachmentSignature,
  isServiceRequestAttachmentContentType,
  safeAttachmentFileName,
  SERVICE_REQUEST_ATTACHMENT_MAX_FILES,
  SERVICE_REQUEST_ATTACHMENT_MAX_FILE_SIZE,
  SERVICE_REQUEST_ATTACHMENT_MAX_TOTAL_SIZE,
  SERVICE_REQUEST_ATTACHMENT_RESERVATION_TTL_MS,
} from "../lib/serviceRequestAttachments";
import type { SrNotificationType } from "@workspace/db";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * The deployed API always has a PostgreSQL pool. Offline route tests exercise
 * the same state-machine behavior with a deliberately small Drizzle mock, so
 * they do not provide one.
 */
function hasTransactionPool(): boolean {
  return Boolean(
    pool &&
      typeof (pool as unknown as { connect?: unknown }).connect === "function",
  );
}

function serializeRequest(
  row: typeof serviceRequestsTable.$inferSelect & {
    customerName?: string;
    officeName?: string;
    officeNameAr?: string | null;
    officeSlug?: string;
    hasReview?: boolean;
  },
) {
  return {
    id: row.id,
    customerId: row.customerId,
    officeId: row.officeId,
    serviceName: row.serviceName,
    description: row.description,
    price: row.price,
    executionDuration: row.executionDuration,
    status: row.status,
    officeCompletedAt: row.officeCompletedAt?.toISOString() ?? null,
    customerConfirmedAt: row.customerConfirmedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    customerName: row.customerName,
    officeName: row.officeName,
    officeNameAr: row.officeNameAr ?? null,
    officeSlug: row.officeSlug,
    hasReview: row.hasReview ?? false,
  };
}

function serializeAttachment(
  row: typeof serviceRequestAttachmentsTable.$inferSelect,
) {
  return {
    id: row.id,
    requestId: row.requestId,
    uploaderRole: row.uploaderRole,
    fileName: row.fileName,
    contentType: row.contentType,
    fileSize: row.fileSize,
    createdAt: row.createdAt.toISOString(),
    // This API route checks both attachment membership and request
    // participation before returning bytes. The bucket path is intentionally
    // not included in API responses.
    downloadUrl: `/api/service-requests/${row.requestId}/attachments/${row.id}/download`,
  };
}

async function getAuthorizedAttachmentRequest(
  requestId: number,
  user: NonNullable<Request["session"]["user"]>,
): Promise<typeof serviceRequestsTable.$inferSelect | null> {
  const [request] = await db
    .select()
    .from(serviceRequestsTable)
    .where(eq(serviceRequestsTable.id, requestId));
  if (!request) return null;

  if (user.role === "admin") return request;
  if (user.role === "customer") {
    return request.customerId === user.id ? request : null;
  }
  if (user.role === "office") {
    const officeId = await getOfficeIdForUser(user.id);
    return officeId === request.officeId ? request : null;
  }
  return null;
}

function attachmentUploadRoleFor(
  request: typeof serviceRequestsTable.$inferSelect,
  user: NonNullable<Request["session"]["user"]>,
): "customer" | "office" | null {
  if (user.role === "office" && request.status === "submitted") return "office";
  if (user.role === "customer" && request.status === "agreed") return "customer";
  return null;
}

class AttachmentLimitError extends Error {}
class AttachmentReservationError extends Error {}

/**
 * Write an audit log entry. Failures are swallowed — audit logging must never
 * break the primary operation.
 */
async function audit(params: {
  actorId: number | null;
  actorRole: "office" | "customer" | "admin" | null;
  action: string;
  targetType: string;
  targetId: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.insert(auditLogTable).values({
      actorId: params.actorId,
      actorRole: params.actorRole,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
    });
  } catch {
    // Audit failures must never surface to the caller.
  }
}

/**
 * Convert a raw postgres snake_case row to a serializer-compatible shape.
 * Only the fields that serializeRequest() accesses are mapped.
 */
function rowToSerializable(row: Record<string, unknown>): typeof serviceRequestsTable.$inferSelect {
  return {
    id:                   row.id as number,
    customerId:           (row.customer_id ?? row.customerId) as number,
    officeId:             (row.office_id ?? row.officeId) as number,
    serviceName:          (row.service_name ?? row.serviceName) as string,
    description:          row.description as string,
    price:                (row.price as string | null) ?? null,
    executionDuration:    (row.execution_duration ?? row.executionDuration) as string | null ?? null,
    status:               row.status as typeof serviceRequestsTable.$inferSelect["status"],
    officeCompletedAt:    (row.office_completed_at ?? row.officeCompletedAt) as Date | null ?? null,
    customerConfirmedAt:  (row.customer_confirmed_at ?? row.customerConfirmedAt) as Date | null ?? null,
    firstResponseAt:      (row.first_response_at ?? row.firstResponseAt) as Date | null ?? null,
    createdAt:            (row.created_at ?? row.createdAt) as Date,
    updatedAt:            (row.updated_at ?? row.updatedAt) as Date,
  };
}

/**
 * Execute a status-change UPDATE + outbox INSERT atomically in a single
 * pool-level transaction. Returns the updated row, or null on CAS miss.
 *
 * A raw pool client is used (not Drizzle's db.transaction) so the outbox
 * insert participates in the same database transaction as the status update,
 * guaranteeing that a committed lifecycle change has a durable notification
 * record. Delivery is handled separately with at-least-once retry semantics.
 */
async function updateStatusWithNotification(opts: {
  requestId: number;
  currentStatus: string;
  newStatus: string;
  extraSet?: Record<string, unknown>;
  notifications: Array<{
    recipientUserId: number;
    recipientRole: "customer" | "office";
    notificationType: SrNotificationType;
  }>;
}): Promise<Record<string, unknown> | null> {
  const { requestId, currentStatus, newStatus, extraSet = {}, notifications } = opts;

  // Keep the test seam narrow: production still commits the transition and
  // durable outbox rows in the transaction path below.
  if (!hasTransactionPool()) {
    const fields: Record<string, unknown> = {
      status: newStatus,
      updatedAt: new Date(),
    };
    const columnMap: Record<string, string> = {
      price: "price",
      execution_duration: "executionDuration",
      first_response_at: "firstResponseAt",
      office_completed_at: "officeCompletedAt",
      customer_confirmed_at: "customerConfirmedAt",
    };
    for (const [column, value] of Object.entries(extraSet)) {
      const field = columnMap[column];
      if (field) fields[field] = value;
    }

    const [updated] = await db
      .update(serviceRequestsTable)
      .set(fields)
      .where(
        and(
          eq(serviceRequestsTable.id, requestId),
          eq(
            serviceRequestsTable.status,
            currentStatus as typeof serviceRequestsTable.$inferSelect["status"],
          ),
        ),
      )
      .returning();
    return (updated as Record<string, unknown> | undefined) ?? null;
  }

  // Build SET clause for extra fields.
  const setEntries = Object.entries(extraSet);
  let setClause = `status = $3, updated_at = NOW()`;
  const params: unknown[] = [requestId, currentStatus, newStatus];
  let paramIdx = 4;
  for (const [col, val] of setEntries) {
    setClause += `, ${col} = $${paramIdx++}`;
    params.push(val);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const updateRes = await client.query<Record<string, unknown>>(
      `UPDATE service_requests
       SET ${setClause}
       WHERE id = $1 AND status = $2
       RETURNING *`,
      params,
    );

    if (updateRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return null; // CAS miss
    }

    if (notifications.length > 0) {
      await enqueueServiceRequestNotifications(requestId, notifications, client);
    }

    await client.query("COMMIT");
    return updateRes.rows[0];
  } catch (err) {
    try { await client.query("ROLLBACK"); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

// ── POST /service-requests — customer submits a new request ──────────────────

router.post(
  "/service-requests",
  requireRole("customer"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = SubmitServiceRequestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const customerId = req.session.user!.id;
    const { officeId, serviceName, description } = parsed.data;

    // Verify the target office exists and is active. Fetch userId too for the
    // self-dealing check (a customer cannot submit to their own office account).
    const [office] = await db
      .select({ id: officesTable.id, userId: officesTable.userId })
      .from(officesTable)
      .where(
        and(eq(officesTable.id, officeId), eq(officesTable.status, "active")),
      );
    if (!office) {
      res.status(404).json({ error: "Office not found" });
      return;
    }

    // Self-dealing prevention: reject if the customer account belongs to the
    // same user as the office account.
    if (office.userId === customerId) {
      res
        .status(403)
        .json({ error: "You cannot submit a service request to your own office" });
      return;
    }

    let request: typeof serviceRequestsTable.$inferSelect;
    if (!hasTransactionPool()) {
      const [created] = await db
        .insert(serviceRequestsTable)
        .values({ customerId, officeId, serviceName, description })
        .returning();
      if (!created) throw new Error("Service request insert returned no row");
      request = created;
    } else {
      // Insert the request + notification outbox row atomically (Blocker 9).
      const client = await pool.connect();
      try {
        await client.query("BEGIN");

        const insertRes = await client.query<Record<string, unknown>>(
          `INSERT INTO service_requests (customer_id, office_id, service_name, description)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [customerId, officeId, serviceName, description],
        );
        request = rowToSerializable(insertRes.rows[0]);

        await enqueueServiceRequestNotifications(
          request.id,
          [{ recipientUserId: office.userId, recipientRole: "office", notificationType: "sr_submitted" }],
          client,
        );

        await client.query("COMMIT");
      } catch (err) {
        try { await client.query("ROLLBACK"); } catch { /* ignore */ }
        throw err;
      } finally {
        client.release();
      }
    }

    await audit({
      actorId: customerId,
      actorRole: "customer",
      action: "service_request_created",
      targetType: "service_request",
      targetId: request.id,
      metadata: { officeId, serviceName },
    });

    res.status(201).json(serializeRequest(request));
  },
);

// ── GET /service-requests/mine — customer lists their own requests ────────────

router.get(
  "/service-requests/mine",
  requireRole("customer"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = req.session.user!.id;

    const rows = await db
      .select({
        id: serviceRequestsTable.id,
        customerId: serviceRequestsTable.customerId,
        officeId: serviceRequestsTable.officeId,
        serviceName: serviceRequestsTable.serviceName,
        description: serviceRequestsTable.description,
        price: serviceRequestsTable.price,
        executionDuration: serviceRequestsTable.executionDuration,
        status: serviceRequestsTable.status,
        officeCompletedAt: serviceRequestsTable.officeCompletedAt,
        customerConfirmedAt: serviceRequestsTable.customerConfirmedAt,
        firstResponseAt: serviceRequestsTable.firstResponseAt,
        createdAt: serviceRequestsTable.createdAt,
        updatedAt: serviceRequestsTable.updatedAt,
        officeName: officesTable.name,
        officeNameAr: officesTable.nameAr,
        officeSlug: officesTable.slug,
        hasReview:
          sql<boolean>`(SELECT COUNT(*) > 0 FROM service_request_reviews WHERE request_id = ${serviceRequestsTable.id})`,
      })
      .from(serviceRequestsTable)
      .innerJoin(
        officesTable,
        eq(officesTable.id, serviceRequestsTable.officeId),
      )
      .where(eq(serviceRequestsTable.customerId, customerId))
      .orderBy(desc(serviceRequestsTable.createdAt))
      .limit(50);

    res.json(rows.map((r) => serializeRequest(r)));
  },
);

// ── GET /service-requests/office — office lists incoming requests ─────────────

router.get(
  "/service-requests/office",
  requireRole("office"),
  async (req: Request, res: Response): Promise<void> => {
    const officeId = await getOfficeIdForUser(req.session.user!.id);
    if (!officeId) {
      res.status(403).json({ error: "No office profile for this account" });
      return;
    }

    const rows = await db
      .select({
        id: serviceRequestsTable.id,
        customerId: serviceRequestsTable.customerId,
        officeId: serviceRequestsTable.officeId,
        serviceName: serviceRequestsTable.serviceName,
        description: serviceRequestsTable.description,
        price: serviceRequestsTable.price,
        executionDuration: serviceRequestsTable.executionDuration,
        status: serviceRequestsTable.status,
        officeCompletedAt: serviceRequestsTable.officeCompletedAt,
        customerConfirmedAt: serviceRequestsTable.customerConfirmedAt,
        firstResponseAt: serviceRequestsTable.firstResponseAt,
        createdAt: serviceRequestsTable.createdAt,
        updatedAt: serviceRequestsTable.updatedAt,
        customerName: usersTable.name,
      })
      .from(serviceRequestsTable)
      .innerJoin(
        usersTable,
        eq(usersTable.id, serviceRequestsTable.customerId),
      )
      .where(eq(serviceRequestsTable.officeId, officeId))
      .orderBy(desc(serviceRequestsTable.createdAt))
      .limit(50);

    res.json(rows.map((r) => serializeRequest(r)));
  },
);

// ── PATCH /service-requests/:id/offer — office sends price + duration ─────────
// Side-effect: records first_response_at exactly once (set-once, never overwritten).

router.patch(
  "/service-requests/:id/offer",
  requireRole("office"),
  async (req: Request, res: Response): Promise<void> => {
    const params = ServiceRequestIdParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = SendOfferBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    const officeId = await getOfficeIdForUser(req.session.user!.id);
    if (!officeId) {
      res.status(403).json({ error: "No office profile for this account" });
      return;
    }

    const [existing] = await db
      .select()
      .from(serviceRequestsTable)
      .where(
        and(
          eq(serviceRequestsTable.id, params.data.id),
          eq(serviceRequestsTable.officeId, officeId),
        ),
      );
    if (!existing) {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    if (existing.status !== "submitted") {
      res.status(409).json({ error: "Can only send an offer on a submitted request" });
      return;
    }

    // Record first_response_at only once — never overwrite an existing value.
    const firstResponseAt = existing.firstResponseAt ?? new Date();

    const rawUpdated = await updateStatusWithNotification({
      requestId:     existing.id,
      currentStatus: "submitted",
      newStatus:     "offer_sent",
      extraSet: {
        price:              body.data.price,
        execution_duration: body.data.executionDuration,
        first_response_at:  firstResponseAt,
      },
      notifications: [
        {
          recipientUserId:  existing.customerId,
          recipientRole:    "customer",
          notificationType: "sr_offer_sent",
        },
      ],
    });

    if (!rawUpdated) {
      res.status(409).json({ error: "Concurrent modification — request status changed" });
      return;
    }
    const updated = rowToSerializable(rawUpdated);

    await audit({
      actorId: req.session.user!.id,
      actorRole: "office",
      action: "service_request_offer_sent",
      targetType: "service_request",
      targetId: updated.id,
      metadata: {
        from: "submitted",
        to: "offer_sent",
        price: body.data.price,
        firstResponseAt: firstResponseAt.toISOString(),
        isFirstResponse: existing.firstResponseAt == null,
      },
    });

    res.json(serializeRequest(updated));
  },
);

// ── PATCH /service-requests/:id/reject — office rejects the request ───────────

router.patch(
  "/service-requests/:id/reject",
  requireRole("office"),
  async (req: Request, res: Response): Promise<void> => {
    const params = ServiceRequestIdParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const officeId = await getOfficeIdForUser(req.session.user!.id);
    if (!officeId) {
      res.status(403).json({ error: "No office profile for this account" });
      return;
    }

    const [existing] = await db
      .select()
      .from(serviceRequestsTable)
      .where(
        and(
          eq(serviceRequestsTable.id, params.data.id),
          eq(serviceRequestsTable.officeId, officeId),
        ),
      );
    if (!existing) {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    if (existing.status !== "submitted") {
      res.status(409).json({ error: "Can only reject a submitted request" });
      return;
    }

    const rawUpdated = await updateStatusWithNotification({
      requestId:     existing.id,
      currentStatus: "submitted",
      newStatus:     "rejected",
      notifications: [
        {
          recipientUserId:  existing.customerId,
          recipientRole:    "customer",
          notificationType: "sr_rejected",
        },
      ],
    });

    if (!rawUpdated) {
      res.status(409).json({ error: "Concurrent modification — request status changed" });
      return;
    }
    const updated = rowToSerializable(rawUpdated);

    await audit({
      actorId: req.session.user!.id,
      actorRole: "office",
      action: "service_request_status_changed",
      targetType: "service_request",
      targetId: updated.id,
      metadata: { from: "submitted", to: "rejected" },
    });

    res.json(serializeRequest(updated));
  },
);

// ── PATCH /service-requests/:id/accept-offer — customer accepts the offer ─────

router.patch(
  "/service-requests/:id/accept-offer",
  requireRole("customer"),
  async (req: Request, res: Response): Promise<void> => {
    const params = ServiceRequestIdParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const customerId = req.session.user!.id;
    const [existing] = await db
      .select()
      .from(serviceRequestsTable)
      .where(
        and(
          eq(serviceRequestsTable.id, params.data.id),
          eq(serviceRequestsTable.customerId, customerId),
        ),
      );
    if (!existing) {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    if (existing.status !== "offer_sent") {
      res.status(409).json({ error: "No offer to accept on this request" });
      return;
    }

    const [officeRow] = hasTransactionPool()
      ? await db
          .select({ userId: officesTable.userId })
          .from(officesTable)
          .where(eq(officesTable.id, existing.officeId))
      : [];

    const rawUpdated = await updateStatusWithNotification({
      requestId:     existing.id,
      currentStatus: "offer_sent",
      newStatus:     "agreed",
      notifications: officeRow ? [
        {
          recipientUserId:  officeRow.userId,
          recipientRole:    "office",
          notificationType: "sr_offer_accepted",
        },
      ] : [],
    });

    if (!rawUpdated) {
      res.status(409).json({ error: "Concurrent modification — request status changed" });
      return;
    }
    const updated = rowToSerializable(rawUpdated);

    await audit({
      actorId: customerId,
      actorRole: "customer",
      action: "service_request_status_changed",
      targetType: "service_request",
      targetId: updated.id,
      metadata: { from: "offer_sent", to: "agreed" },
    });

    res.json(serializeRequest(updated));
  },
);

// ── PATCH /service-requests/:id/reject-offer — customer rejects the offer ─────

router.patch(
  "/service-requests/:id/reject-offer",
  requireRole("customer"),
  async (req: Request, res: Response): Promise<void> => {
    const params = ServiceRequestIdParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const customerId = req.session.user!.id;
    const [existing] = await db
      .select()
      .from(serviceRequestsTable)
      .where(
        and(
          eq(serviceRequestsTable.id, params.data.id),
          eq(serviceRequestsTable.customerId, customerId),
        ),
      );
    if (!existing) {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    if (existing.status !== "offer_sent") {
      res.status(409).json({ error: "No offer to reject on this request" });
      return;
    }

    const [officeRowReject] = hasTransactionPool()
      ? await db
          .select({ userId: officesTable.userId })
          .from(officesTable)
          .where(eq(officesTable.id, existing.officeId))
      : [];

    const rawUpdated = await updateStatusWithNotification({
      requestId:     existing.id,
      currentStatus: "offer_sent",
      newStatus:     "rejected",
      notifications: officeRowReject ? [
        {
          recipientUserId:  officeRowReject.userId,
          recipientRole:    "office",
          notificationType: "sr_offer_rejected",
        },
      ] : [],
    });

    if (!rawUpdated) {
      res.status(409).json({ error: "Concurrent modification — request status changed" });
      return;
    }
    const updated = rowToSerializable(rawUpdated);

    await audit({
      actorId: customerId,
      actorRole: "customer",
      action: "service_request_status_changed",
      targetType: "service_request",
      targetId: updated.id,
      metadata: { from: "offer_sent", to: "rejected" },
    });

    res.json(serializeRequest(updated));
  },
);

// ── PATCH /service-requests/:id/complete — office marks service done ──────────

router.patch(
  "/service-requests/:id/complete",
  requireRole("office"),
  async (req: Request, res: Response): Promise<void> => {
    const params = ServiceRequestIdParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const officeId = await getOfficeIdForUser(req.session.user!.id);
    if (!officeId) {
      res.status(403).json({ error: "No office profile for this account" });
      return;
    }

    const [existing] = await db
      .select()
      .from(serviceRequestsTable)
      .where(
        and(
          eq(serviceRequestsTable.id, params.data.id),
          eq(serviceRequestsTable.officeId, officeId),
        ),
      );
    if (!existing) {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    if (existing.status !== "agreed") {
      res.status(409).json({
        error: "Can only mark a request complete after the customer has accepted the offer",
      });
      return;
    }

    const rawUpdated = await updateStatusWithNotification({
      requestId:     existing.id,
      currentStatus: "agreed",
      newStatus:     "awaiting_customer_confirmation",
      extraSet: {
        office_completed_at: new Date(),
      },
      notifications: [
        {
          recipientUserId:  existing.customerId,
          recipientRole:    "customer",
          notificationType: "sr_completed_awaiting_confirm",
        },
      ],
    });

    if (!rawUpdated) {
      res.status(409).json({ error: "Concurrent modification — request status changed" });
      return;
    }
    const updated = rowToSerializable(rawUpdated);

    await audit({
      actorId: req.session.user!.id,
      actorRole: "office",
      action: "service_request_status_changed",
      targetType: "service_request",
      targetId: updated.id,
      metadata: { from: "agreed", to: "awaiting_customer_confirmation" },
    });

    res.json(serializeRequest(updated));
  },
);

// ── PATCH /service-requests/:id/confirm-completion — customer confirms done ───

router.patch(
  "/service-requests/:id/confirm-completion",
  requireRole("customer"),
  async (req: Request, res: Response): Promise<void> => {
    const params = ServiceRequestIdParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const customerId = req.session.user!.id;
    const [existing] = await db
      .select()
      .from(serviceRequestsTable)
      .where(
        and(
          eq(serviceRequestsTable.id, params.data.id),
          eq(serviceRequestsTable.customerId, customerId),
        ),
      );
    if (!existing) {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    if (existing.status !== "awaiting_customer_confirmation") {
      res.status(409).json({ error: "Request is not awaiting confirmation" });
      return;
    }

    const [officeRowConfirm] = hasTransactionPool()
      ? await db
          .select({ userId: officesTable.userId })
          .from(officesTable)
          .where(eq(officesTable.id, existing.officeId))
      : [];

    const rawUpdated = await updateStatusWithNotification({
      requestId:     existing.id,
      currentStatus: "awaiting_customer_confirmation",
      newStatus:     "completed",
      extraSet: {
        customer_confirmed_at: new Date(),
      },
      notifications: officeRowConfirm ? [
        {
          recipientUserId:  officeRowConfirm.userId,
          recipientRole:    "office",
          notificationType: "sr_confirmed_completed",
        },
      ] : [],
    });

    if (!rawUpdated) {
      res.status(409).json({ error: "Concurrent modification — request status changed" });
      return;
    }
    const updated = rowToSerializable(rawUpdated);

    await audit({
      actorId: customerId,
      actorRole: "customer",
      action: "service_request_customer_confirmed",
      targetType: "service_request",
      targetId: updated.id,
      metadata: { from: "awaiting_customer_confirmation", to: "completed" },
    });

    res.json(serializeRequest(updated));
  },
);

// ── PATCH /service-requests/:id/not-completed — customer flags not done ───────

router.patch(
  "/service-requests/:id/not-completed",
  requireRole("customer"),
  async (req: Request, res: Response): Promise<void> => {
    const params = ServiceRequestIdParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const customerId = req.session.user!.id;
    const [existing] = await db
      .select()
      .from(serviceRequestsTable)
      .where(
        and(
          eq(serviceRequestsTable.id, params.data.id),
          eq(serviceRequestsTable.customerId, customerId),
        ),
      );
    if (!existing) {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    if (existing.status !== "awaiting_customer_confirmation") {
      res.status(409).json({ error: "Request is not awaiting confirmation" });
      return;
    }

    const [officeRowNotDone] = hasTransactionPool()
      ? await db
          .select({ userId: officesTable.userId })
          .from(officesTable)
          .where(eq(officesTable.id, existing.officeId))
      : [];

    const rawUpdated = await updateStatusWithNotification({
      requestId:     existing.id,
      currentStatus: "awaiting_customer_confirmation",
      newStatus:     "not_completed",
      notifications: officeRowNotDone ? [
        {
          recipientUserId:  officeRowNotDone.userId,
          recipientRole:    "office",
          notificationType: "sr_not_completed",
        },
      ] : [],
    });

    if (!rawUpdated) {
      res.status(409).json({ error: "Concurrent modification — request status changed" });
      return;
    }
    const updated = rowToSerializable(rawUpdated);

    await audit({
      actorId: customerId,
      actorRole: "customer",
      action: "service_request_status_changed",
      targetType: "service_request",
      targetId: updated.id,
      metadata: { from: "awaiting_customer_confirmation", to: "not_completed" },
    });

    res.json(serializeRequest(updated));
  },
);

// ── POST /service-requests/:id/review — customer submits recommendation ───────
// responseSpeed has been removed from this endpoint (migration 0022).
// Response speed is now system-calculated from first_response_at - created_at.

router.post(
  "/service-requests/:id/review",
  requireRole("customer"),
  async (req: Request, res: Response): Promise<void> => {
    const params = ServiceRequestIdParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const body = SubmitServiceReviewBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: body.error.message });
      return;
    }

    const customerId = req.session.user!.id;
    const [existing] = await db
      .select()
      .from(serviceRequestsTable)
      .where(
        and(
          eq(serviceRequestsTable.id, params.data.id),
          eq(serviceRequestsTable.customerId, customerId),
        ),
      );
    if (!existing) {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    if (existing.status !== "completed") {
      res.status(409).json({
        error: "Can only review a completed and customer-confirmed request",
      });
      return;
    }

    // Prevent duplicate reviews (belt-and-suspenders alongside the UNIQUE index).
    const [existingReview] = await db
      .select({ id: serviceRequestReviewsTable.id })
      .from(serviceRequestReviewsTable)
      .where(eq(serviceRequestReviewsTable.requestId, existing.id));
    if (existingReview) {
      res.status(409).json({ error: "A review for this request already exists" });
      return;
    }

    // Insert review. UNIQUE constraint on request_id is the last line of defense
    // against race conditions (two simultaneous requests both passing the check
    // above — whichever arrives second gets 409, not 500).
    let review: typeof serviceRequestReviewsTable.$inferSelect;
    try {
      const [inserted] = await db
        .insert(serviceRequestReviewsTable)
        .values({
          requestId: existing.id,
          customerId,
          wasCompleted: body.data.wasCompleted,
          wouldRecommend: body.data.wouldRecommend,
          // responseSpeed intentionally omitted — system-calculated now.
        })
        .returning();
      review = inserted;
    } catch (err: unknown) {
      const pgCode =
        (err as { code?: string })?.code ??
        (err as { cause?: { code?: string } })?.cause?.code;
      if (pgCode === "23505") {
        res.status(409).json({ error: "A review for this request already exists" });
        return;
      }
      throw err;
    }

    await audit({
      actorId: customerId,
      actorRole: "customer",
      action: "service_request_review_submitted",
      targetType: "service_request",
      targetId: existing.id,
      metadata: {
        reviewId: review.id,
        wasCompleted: review.wasCompleted,
        wouldRecommend: review.wouldRecommend,
        officeId: existing.officeId,
      },
    });

    res.status(201).json({
      id: review.id,
      requestId: review.requestId,
      customerId: review.customerId,
      wasCompleted: review.wasCompleted,
      wouldRecommend: review.wouldRecommend,
      responseSpeed: review.responseSpeed ?? null,
      createdAt: review.createdAt.toISOString(),
    });
  },
);

// ── Private service-request attachments ──────────────────────────────────────
// These routes deliberately use their own reservation model instead of
// upload_claims: both a customer and an office can be a valid uploader, and
// each claim must be bound to a single request plus an allowed lifecycle state.

router.post(
  "/service-requests/:id/attachments/request-url",
  requireRole("customer", "office"),
  async (req: Request, res: Response): Promise<void> => {
    const params = ServiceRequestIdParams.safeParse(req.params);
    const body = RequestServiceRequestAttachmentUploadUrlBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid attachment upload details" });
      return;
    }

    const user = req.session.user!;
    const request = await getAuthorizedAttachmentRequest(params.data.id, user);
    if (!request) {
      res.status(404).json({ error: "Request not found" });
      return;
    }

    const uploaderRole = attachmentUploadRoleFor(request, user);
    if (!uploaderRole) {
      res.status(409).json({
        error: "Attachments can only be uploaded by the office before its offer, or by the customer after accepting an offer",
        code: "attachment_upload_not_allowed",
      });
      return;
    }

    const fileName = safeAttachmentFileName(body.data.name);
    if (body.data.size > SERVICE_REQUEST_ATTACHMENT_MAX_FILE_SIZE) {
      res.status(400).json({
        error: "Attachment exceeds the 10MB per-file limit",
        code: "attachment_file_too_large",
      });
      return;
    }

    try {
      const uploadURL = await objectStorageService.getObjectEntityUploadURL({
        contentType: body.data.contentType,
        contentLength: body.data.size,
        expiresIn: SERVICE_REQUEST_ATTACHMENT_RESERVATION_TTL_MS / 1000,
      });
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
      const now = new Date();

      await db.transaction(async (tx) => {
        // Serialize quota checks per service request. Without this transaction-
        // scoped advisory lock, concurrent URL requests can each observe spare
        // capacity and reserve more than the 5-file / 25MB request limit.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(172, ${request.id})`,
        );
        const [attachmentTotals] = await tx
          .select({
            fileCount: sql<number>`count(*)::int`,
            totalSize: sql<number>`coalesce(sum(${serviceRequestAttachmentsTable.fileSize}), 0)::int`,
          })
          .from(serviceRequestAttachmentsTable)
          .where(eq(serviceRequestAttachmentsTable.requestId, request.id));
        const [reservationTotals] = await tx
          .select({
            fileCount: sql<number>`count(*)::int`,
            totalSize: sql<number>`coalesce(sum(${serviceRequestAttachmentReservationsTable.fileSize}), 0)::int`,
          })
          .from(serviceRequestAttachmentReservationsTable)
          .where(
            and(
              eq(serviceRequestAttachmentReservationsTable.requestId, request.id),
              gt(serviceRequestAttachmentReservationsTable.expiresAt, now),
            ),
          );

        const reservedFiles =
          Number(attachmentTotals?.fileCount ?? 0) +
          Number(reservationTotals?.fileCount ?? 0);
        const reservedBytes =
          Number(attachmentTotals?.totalSize ?? 0) +
          Number(reservationTotals?.totalSize ?? 0);
        if (reservedFiles >= SERVICE_REQUEST_ATTACHMENT_MAX_FILES) {
          throw new AttachmentLimitError("Attachment count limit reached");
        }
        if (reservedBytes + body.data.size > SERVICE_REQUEST_ATTACHMENT_MAX_TOTAL_SIZE) {
          throw new AttachmentLimitError("Attachment total size limit reached");
        }

        await tx.insert(serviceRequestAttachmentReservationsTable).values({
          requestId: request.id,
          uploaderUserId: user.id,
          uploaderRole,
          objectPath,
          fileName,
          contentType: body.data.contentType,
          fileSize: body.data.size,
          expiresAt: new Date(Date.now() + SERVICE_REQUEST_ATTACHMENT_RESERVATION_TTL_MS),
        });
      });

      res.status(201).json({ uploadURL, objectPath });
    } catch (error) {
      if (error instanceof AttachmentLimitError) {
        res.status(409).json({
          error: error.message,
          code: "attachment_limit_reached",
        });
        return;
      }
      req.log.error({ err: error }, "Failed to reserve service-request attachment upload");
      res.status(500).json({ error: "Failed to prepare attachment upload" });
    }
  },
);

router.post(
  "/service-requests/:id/attachments",
  requireRole("customer", "office"),
  async (req: Request, res: Response): Promise<void> => {
    const params = ServiceRequestIdParams.safeParse(req.params);
    const body = RegisterServiceRequestAttachmentBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid attachment registration details" });
      return;
    }

    const user = req.session.user!;
    const request = await getAuthorizedAttachmentRequest(params.data.id, user);
    if (!request) {
      res.status(404).json({ error: "Request not found" });
      return;
    }
    const uploaderRole = attachmentUploadRoleFor(request, user);
    if (!uploaderRole) {
      res.status(409).json({
        error: "Attachments are not allowed at this request stage",
        code: "attachment_upload_not_allowed",
      });
      return;
    }

    const [reservation] = await db
      .select()
      .from(serviceRequestAttachmentReservationsTable)
      .where(
        and(
          eq(serviceRequestAttachmentReservationsTable.requestId, request.id),
          eq(serviceRequestAttachmentReservationsTable.uploaderUserId, user.id),
          eq(serviceRequestAttachmentReservationsTable.uploaderRole, uploaderRole),
          eq(serviceRequestAttachmentReservationsTable.objectPath, body.data.objectPath),
        ),
      );
    if (!reservation) {
      res.status(409).json({
        error: "This upload URL is not valid for the request",
        code: "attachment_reservation_invalid",
      });
      return;
    }
    if (reservation.expiresAt <= new Date()) {
      await db
        .delete(serviceRequestAttachmentReservationsTable)
        .where(eq(serviceRequestAttachmentReservationsTable.id, reservation.id));
      res.status(409).json({
        error: "This upload URL has expired. Request a new one.",
        code: "attachment_reservation_expired",
      });
      return;
    }

    let verifiedObjectPath: string | null = null;
    let attachmentPersisted = false;
    try {
      const metadata = await objectStorageService.getObjectEntityMetadata(
        reservation.objectPath,
      );
      const actualType = metadata.contentType ?? "";
      const actualSize = metadata.contentLength ?? 0;
      if (
        !isServiceRequestAttachmentContentType(actualType) ||
        actualType !== reservation.contentType ||
        actualSize !== reservation.fileSize ||
        actualSize > SERVICE_REQUEST_ATTACHMENT_MAX_FILE_SIZE
      ) {
        throw new Error("Attachment metadata does not match the reserved upload");
      }

      const objectFile = await objectStorageService.getObjectEntityFile(
        reservation.objectPath,
      );
      const bytes = await objectStorageService.downloadObjectBuffer(
        objectFile,
        SERVICE_REQUEST_ATTACHMENT_MAX_FILE_SIZE,
      );
      if (
        bytes.length !== actualSize ||
        !hasValidServiceRequestAttachmentSignature(actualType, bytes)
      ) {
        throw new Error("Attachment file signature is invalid");
      }
      // A presigned PUT URL remains usable until it expires. Persisting its
      // object path would let the uploader replace an already-verified file.
      // Copy verified bytes to a fresh server-owned key before making metadata
      // visible; clients never receive a write URL for that final key.
      verifiedObjectPath = await objectStorageService.saveObjectEntity(
        bytes,
        actualType,
        "service-request-attachment",
      );

      const [attachment] = await db.transaction(async (tx) => {
        // The DELETE is the single-use/replay guard: only one concurrent
        // registration can consume this exact reservation. If the insert
        // fails, the transaction rolls back and leaves the reservation intact.
        const consumed = await tx
          .delete(serviceRequestAttachmentReservationsTable)
          .where(
            and(
              eq(serviceRequestAttachmentReservationsTable.id, reservation.id),
              eq(serviceRequestAttachmentReservationsTable.requestId, request.id),
              eq(serviceRequestAttachmentReservationsTable.uploaderUserId, user.id),
              eq(serviceRequestAttachmentReservationsTable.uploaderRole, uploaderRole),
              eq(serviceRequestAttachmentReservationsTable.objectPath, reservation.objectPath),
              gt(serviceRequestAttachmentReservationsTable.expiresAt, new Date()),
            ),
          )
          .returning();
        if (!consumed[0]) {
          throw new AttachmentReservationError(
            "Attachment reservation has already been used or expired",
          );
        }
        return tx
          .insert(serviceRequestAttachmentsTable)
          .values({
            requestId: request.id,
            uploaderUserId: user.id,
            uploaderRole,
            objectPath: verifiedObjectPath!,
            fileName: reservation.fileName,
            contentType: actualType,
            fileSize: actualSize,
          })
          .returning();
      });

      if (!attachment) throw new Error("Attachment insert returned no row");
      attachmentPersisted = true;
      // The temporary object is no longer needed. Cleanup is intentionally
      // best-effort; its path is unrecognized after the reservation is
      // consumed, so a cleanup failure cannot expose it.
      void objectStorageService.deleteObjectEntity(reservation.objectPath).catch(
        (cleanupError) =>
          req.log.warn(
            { err: cleanupError },
            "Failed to clean up temporary service-request attachment upload",
          ),
      );
      await audit({
        actorId: user.id,
        actorRole: uploaderRole,
        action: "service_request_attachment_registered",
        targetType: "service_request_attachment",
        targetId: attachment.id,
        metadata: { requestId: request.id, contentType: actualType, fileSize: actualSize },
      });
      res.status(201).json(serializeAttachment(attachment));
    } catch (error) {
      if (verifiedObjectPath && !attachmentPersisted) {
        void objectStorageService.deleteObjectEntity(verifiedObjectPath).catch(
          (cleanupError) =>
            req.log.warn(
              { err: cleanupError },
              "Failed to clean up unregistered verified service-request attachment",
            ),
        );
      }
      if (error instanceof ObjectNotFoundError) {
        res.status(400).json({
          error: "Uploaded attachment was not found in storage",
          code: "attachment_object_not_found",
        });
        return;
      }
      if (error instanceof AttachmentReservationError) {
        res.status(409).json({
          error: error.message,
          code: "attachment_reservation_invalid",
        });
        return;
      }
      req.log.warn({ err: error }, "Service-request attachment registration rejected");
      res.status(400).json({
        error: "Attachment could not be verified. Upload a valid JPG, PNG, or PDF and try again.",
        code: "attachment_verification_failed",
      });
    }
  },
);

router.get(
  "/service-requests/:id/attachments",
  requireRole("customer", "office", "admin"),
  async (req: Request, res: Response): Promise<void> => {
    const params = ServiceRequestIdParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid request id" });
      return;
    }
    const request = await getAuthorizedAttachmentRequest(
      params.data.id,
      req.session.user!,
    );
    if (!request) {
      res.status(404).json({ error: "Request not found" });
      return;
    }

    const attachments = await db
      .select()
      .from(serviceRequestAttachmentsTable)
      .where(eq(serviceRequestAttachmentsTable.requestId, request.id))
      .orderBy(desc(serviceRequestAttachmentsTable.createdAt));
    res.json({ items: attachments.map(serializeAttachment), total: attachments.length });
  },
);

router.get(
  "/service-requests/:id/attachments/:attachmentId/download",
  requireRole("customer", "office", "admin"),
  async (req: Request, res: Response): Promise<void> => {
    const params = ServiceRequestAttachmentIdParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid attachment id" });
      return;
    }
    const request = await getAuthorizedAttachmentRequest(
      params.data.id,
      req.session.user!,
    );
    if (!request) {
      res.status(404).json({ error: "Request not found" });
      return;
    }

    const [attachment] = await db
      .select()
      .from(serviceRequestAttachmentsTable)
      .where(
        and(
          eq(serviceRequestAttachmentsTable.id, params.data.attachmentId),
          eq(serviceRequestAttachmentsTable.requestId, request.id),
        ),
      );
    if (!attachment) {
      res.status(404).json({ error: "Attachment not found" });
      return;
    }

    try {
      const objectFile = await objectStorageService.getObjectEntityFile(
        attachment.objectPath,
      );
      const response = await objectStorageService.downloadObject(objectFile);
      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${safeAttachmentFileName(attachment.fileName).replace(/"/g, "")}"`,
      );
      if (response.body) {
        Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Attachment object not found" });
        return;
      }
      req.log.error({ err: error }, "Failed to download service-request attachment");
      res.status(500).json({ error: "Failed to download attachment" });
    }
  },
);

// ── GET /offices/:slug/service-metrics — public metrics for Quick Card ─────────
//
// Returns three independently sourced metrics:
//
//   completedCount          — ALL completed transactions (with or without reviews).
//   reviewCount             — Number of customers who submitted a recommendation.
//   recommendPct            — % of reviewers who would recommend (denominator =
//                             reviewCount, not completedCount).
//   avgFirstResponseMinutes — Average minutes from request creation to the
//                             office's first offer response, across ALL requests
//                             that have a first_response_at (not just completed).
//                             NULL when no response timestamp exists yet.

router.get(
  "/offices/:slug/service-metrics",
  async (req: Request, res: Response): Promise<void> => {
    const params = ServiceMetricsSlugParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const [office] = await db
      .select({ id: officesTable.id })
      .from(officesTable)
      .where(eq(officesTable.slug, params.data.slug));

    if (!office) {
      res.status(404).json({ error: "Office not found" });
      return;
    }

    // Query 1: completed count + recommendation % (with LEFT JOIN so we count
    // completed transactions regardless of whether they have a review).
    const [completedMetrics] = await db
      .select({
        completedCount: sql<number>`count(${serviceRequestsTable.id})::int`,
        reviewCount: sql<number>`count(${serviceRequestReviewsTable.id})::int`,
        recommendPct: sql<number>`
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
          eq(serviceRequestsTable.officeId, office.id),
          eq(serviceRequestsTable.status, "completed"),
        ),
      );

    // Query 2: average first-response time in minutes across ALL requests from
    // this office that have a first_response_at timestamp (including rejected /
    // non-completed ones — the office's response behaviour applies to all
    // enquiries, not just completed work).
    const [responseMetrics] = await db
      .select({
        avgFirstResponseMinutes: sql<number | null>`
          CASE WHEN COUNT(*) = 0 THEN NULL
          ELSE ROUND(AVG(
            EXTRACT(EPOCH FROM (${serviceRequestsTable.firstResponseAt} - ${serviceRequestsTable.createdAt})) / 60.0
          ))::int END`,
      })
      .from(serviceRequestsTable)
      .where(
        and(
          eq(serviceRequestsTable.officeId, office.id),
          sql`${serviceRequestsTable.firstResponseAt} IS NOT NULL`,
        ),
      );

    res.setHeader("Cache-Control", "public, max-age=60, stale-while-revalidate=30");
    res.json({
      completedCount: completedMetrics?.completedCount ?? 0,
      reviewCount: completedMetrics?.reviewCount ?? 0,
      recommendPct: completedMetrics?.recommendPct ?? 0,
      avgFirstResponseMinutes: responseMetrics?.avgFirstResponseMinutes ?? null,
    });
  },
);

export default router;

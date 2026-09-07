import { Router, type IRouter, type Request, type Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import {
  db,
  officesTable,
  usersTable,
  contactEventsTable,
  videoCallRequestsTable,
} from "@workspace/db";
import { and, desc, eq, gt } from "drizzle-orm";
import {
  CreateContactEventBody,
  CreateContactEventResponse,
  CreateVideoCallRequestBody,
  CreateVideoCallRequestResponse,
  ListMyVideoCallRequestsResponse,
  ListMyContactEventsQueryParams,
  ListMyContactEventsResponse,
  ListMyOfficeContactEventsQueryParams,
  ListMyOfficeContactEventsResponse,
  ListMyOfficeVideoCallRequestsResponse,
  UpdateMyOfficeVideoCallRequestStatusParams,
  UpdateMyOfficeVideoCallRequestStatusBody,
  UpdateMyOfficeVideoCallRequestStatusResponse,
} from "@workspace/api-zod";
import { requireRole, requireActiveCustomer } from "../middlewares/authMiddleware";
import { recordAuditLog } from "../lib/auditLog";
import { getOfficeIdForUser } from "../lib/auth";

const router: IRouter = Router();

// A double-tap or retry within this window returns the existing event instead
// of creating a duplicate row. 60 s prevents same-session duplicate clicks
// while still recording genuinely separate contacts later in the session.
const DEDUPE_WINDOW_MS = 60_000;

const contactWriteLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) =>
    req.session.user?.id
      ? `contact:user:${req.session.user.id}`
      : `contact:ip:${ipKeyGenerator(req.ip ?? "")}`,
  handler: (_req, res) => {
    res.status(429).json({ error: "Too many requests, please slow down." });
  },
});

router.post(
  "/contact-events",
  contactWriteLimiter,
  requireActiveCustomer,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = CreateContactEventBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [office] = await db
      .select({ id: officesTable.id })
      .from(officesTable)
      .where(
        and(
          eq(officesTable.id, parsed.data.officeId),
          eq(officesTable.status, "active"),
        ),
      );
    if (!office) {
      res.status(404).json({ error: "Office not found" });
      return;
    }

    // Internal/seed accounts cannot generate contact events — return silently
    // so QA activity never inflates office contact metrics.
    if (req.session.user?.isInternal) {
      res.status(200).json({ skipped: true });
      return;
    }

    const customerId = req.session.user!.id;
    const dedupeSince = new Date(Date.now() - DEDUPE_WINDOW_MS);
    const [recent] = await db
      .select()
      .from(contactEventsTable)
      .where(
        and(
          eq(contactEventsTable.customerUserId, customerId),
          eq(contactEventsTable.officeId, parsed.data.officeId),
          eq(contactEventsTable.actionType, parsed.data.actionType),
          gt(contactEventsTable.createdAt, dedupeSince),
        ),
      )
      .orderBy(desc(contactEventsTable.createdAt))
      .limit(1);

    if (recent) {
      res.status(200).json(CreateContactEventResponse.parse(recent));
      return;
    }

    let event: typeof contactEventsTable.$inferSelect;
    try {
      const [inserted] = await db
        .insert(contactEventsTable)
        .values({
          customerUserId: customerId,
          officeId: parsed.data.officeId,
          actionType: parsed.data.actionType,
          sourcePage: parsed.data.sourcePage ?? null,
          language: parsed.data.language ?? null,
          // Phase 1 analytics: link this contact event back to the search journey
          // that led to it. NULL when not provided (pre-Phase-1 clients).
          searchSessionId: parsed.data.searchSessionId ?? null,
        })
        .returning();

      if (!inserted) {
        req.log?.warn({ officeId: parsed.data.officeId, actionType: parsed.data.actionType },
          "[contact] INSERT returned no rows — contact_events table may be unreachable");
        res.status(500).json({ error: "Failed to record contact event" });
        return;
      }
      event = inserted;
    } catch (insertErr) {
      req.log?.error({ err: (insertErr as Error).message, officeId: parsed.data.officeId,
        actionType: parsed.data.actionType }, "[contact] contact_events INSERT failed");
      res.status(500).json({ error: "Failed to record contact event" });
      return;
    }

    if (parsed.data.actionType === "whatsapp_click") {
      await recordAuditLog({
        actor: req.session.user,
        action: "contact.whatsapp_click",
        targetType: "office",
        targetId: parsed.data.officeId,
      });
    }

    res.status(201).json(CreateContactEventResponse.parse(event));
  },
);

router.post(
  "/video-call-requests",
  contactWriteLimiter,
  requireActiveCustomer,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = CreateVideoCallRequestBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [office] = await db
      .select({ id: officesTable.id, videoCallEnabled: officesTable.videoCallEnabled })
      .from(officesTable)
      .where(
        and(
          eq(officesTable.id, parsed.data.officeId),
          eq(officesTable.status, "active"),
        ),
      );
    if (!office || !office.videoCallEnabled) {
      res.status(404).json({ error: "Video calls are not available for this office" });
      return;
    }

    // Internal/seed accounts cannot generate contact events — skip the
    // contact_events row but still allow the video-call request itself
    // so QA can test the form flow without inflating office metrics.
    const isInternal = req.session.user?.isInternal ?? false;
    const customerId = req.session.user!.id;

    const [request] = await db
      .insert(videoCallRequestsTable)
      .values({
        customerUserId: customerId,
        officeId: parsed.data.officeId,
        preferredDate: parsed.data.preferredDate,
        preferredTime: parsed.data.preferredTime,
        timezone: parsed.data.timezone,
        contactNumber: parsed.data.contactNumber,
        note: parsed.data.note ?? null,
      })
      .returning();

    // A video-call request also counts as "verified commercial contact",
    // so it gets its own contact_events row alongside the request record.
    // Excluded: internal/seed users; deduped: same 60 s window as /contact-events
    // to absorb accidental double-submits without blocking genuine later contacts.
    if (!isInternal) {
      const dedupeSince = new Date(Date.now() - DEDUPE_WINDOW_MS);
      const [recentContact] = await db
        .select({ id: contactEventsTable.id })
        .from(contactEventsTable)
        .where(
          and(
            eq(contactEventsTable.customerUserId, customerId),
            eq(contactEventsTable.officeId, parsed.data.officeId),
            eq(contactEventsTable.actionType, "video_call_request"),
            gt(contactEventsTable.createdAt, dedupeSince),
          ),
        )
        .limit(1);

      if (!recentContact) {
        await db.insert(contactEventsTable).values({
          customerUserId: customerId,
          officeId: parsed.data.officeId,
          actionType: "video_call_request",
        });
      }
    }

    await recordAuditLog({
      actor: req.session.user,
      action: "contact.video_call_request.create",
      targetType: "office",
      targetId: parsed.data.officeId,
      metadata: { videoCallRequestId: request.id },
    });

    res.status(201).json(CreateVideoCallRequestResponse.parse(request));
  },
);

router.get(
  "/video-call-requests/me",
  requireRole("customer"),
  async (req: Request, res: Response): Promise<void> => {
    const rows = await db
      .select()
      .from(videoCallRequestsTable)
      .where(eq(videoCallRequestsTable.customerUserId, req.session.user!.id))
      .orderBy(desc(videoCallRequestsTable.createdAt));

    res.json(ListMyVideoCallRequestsResponse.parse(rows));
  },
);

router.get(
  "/contact-events/me",
  requireRole("customer"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = ListMyContactEventsQueryParams.safeParse(req.query);
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
        officeName: officesTable.name,
      })
      .from(contactEventsTable)
      .innerJoin(officesTable, eq(officesTable.id, contactEventsTable.officeId))
      .where(eq(contactEventsTable.customerUserId, req.session.user!.id))
      .orderBy(desc(contactEventsTable.createdAt))
      .limit(limit);

    res.json(ListMyContactEventsResponse.parse(rows));
  },
);

router.get(
  "/offices/me/contact-events",
  requireRole("office"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = ListMyOfficeContactEventsQueryParams.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const officeId = await getOfficeIdForUser(req.session.user!.id);
    if (!officeId) {
      res.status(403).json({ error: "No office profile for this account" });
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
      })
      .from(contactEventsTable)
      .innerJoin(usersTable, eq(usersTable.id, contactEventsTable.customerUserId))
      .where(eq(contactEventsTable.officeId, officeId))
      .orderBy(desc(contactEventsTable.createdAt))
      .limit(limit);

    res.json(ListMyOfficeContactEventsResponse.parse(rows));
  },
);

router.get(
  "/offices/me/video-call-requests",
  requireRole("office"),
  async (req: Request, res: Response): Promise<void> => {
    const officeId = await getOfficeIdForUser(req.session.user!.id);
    if (!officeId) {
      res.status(403).json({ error: "No office profile for this account" });
      return;
    }

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
      })
      .from(videoCallRequestsTable)
      .innerJoin(
        usersTable,
        eq(usersTable.id, videoCallRequestsTable.customerUserId),
      )
      .where(eq(videoCallRequestsTable.officeId, officeId))
      .orderBy(desc(videoCallRequestsTable.createdAt));

    res.json(ListMyOfficeVideoCallRequestsResponse.parse(rows));
  },
);

router.patch(
  "/offices/me/video-call-requests/:requestId/status",
  requireRole("office"),
  async (req: Request, res: Response): Promise<void> => {
    const params = UpdateMyOfficeVideoCallRequestStatusParams.safeParse(
      req.params,
    );
    const body = UpdateMyOfficeVideoCallRequestStatusBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res
        .status(400)
        .json({ error: params.error?.message ?? body.error?.message });
      return;
    }

    const officeId = await getOfficeIdForUser(req.session.user!.id);
    if (!officeId) {
      res.status(403).json({ error: "No office profile for this account" });
      return;
    }

    const [existing] = await db
      .select()
      .from(videoCallRequestsTable)
      .where(
        and(
          eq(videoCallRequestsTable.id, params.data.requestId),
          eq(videoCallRequestsTable.officeId, officeId),
        ),
      );
    if (!existing) {
      res.status(404).json({ error: "Request not found" });
      return;
    }

    const [updated] = await db
      .update(videoCallRequestsTable)
      .set({
        status: body.data.status,
        respondedAt: new Date(),
        respondedBy: req.session.user!.id,
      })
      .where(eq(videoCallRequestsTable.id, existing.id))
      .returning();

    await recordAuditLog({
      actor: req.session.user,
      action: "contact.video_call_request.status_change",
      targetType: "video_call_request",
      targetId: existing.id,
      metadata: { status: body.data.status },
    });

    const [customer] = await db
      .select({ name: usersTable.name })
      .from(usersTable)
      .where(eq(usersTable.id, updated.customerUserId));

    res.json(
      UpdateMyOfficeVideoCallRequestStatusResponse.parse({
        ...updated,
        customerName: customer?.name ?? "",
      }),
    );
  },
);

export default router;

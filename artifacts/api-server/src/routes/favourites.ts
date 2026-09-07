import { Router, type IRouter, type Request, type Response } from "express";
import { db, favouritesTable, officesTable } from "@workspace/db";
import { fireAnalyticsEvent, extractRequestContext } from "../lib/analyticsWriter";
import { readVisitorId } from "../lib/visitorSession";
import { and, eq, inArray } from "drizzle-orm";
import {
  ListFavouritesResponse,
  AddFavouriteBody,
  AddFavouriteResponse,
  RemoveFavouriteParams,
} from "@workspace/api-zod";
import {
  serializeOfficeSummary,
  loadServiceTagsByOfficeId,
} from "../lib/officeSerializer";
import { requireRole } from "../middlewares/authMiddleware";

const router: IRouter = Router();

router.get(
  "/favourites",
  requireRole("customer"),
  async (req: Request, res: Response): Promise<void> => {
    const favourites = await db
      .select({ officeId: favouritesTable.officeId })
      .from(favouritesTable)
      .where(eq(favouritesTable.customerUserId, req.session.user!.id));

    if (favourites.length === 0) {
      res.json(ListFavouritesResponse.parse([]));
      return;
    }

    const offices = await db
      .select()
      .from(officesTable)
      .where(
        and(
          inArray(
            officesTable.id,
            favourites.map((f) => f.officeId),
          ),
          eq(officesTable.status, "active"),
        ),
      );

    const serviceTags = await loadServiceTagsByOfficeId(
      offices.map((o) => o.id),
    );

    res.json(
      ListFavouritesResponse.parse(
        offices.map((office) =>
          serializeOfficeSummary(office, serviceTags.get(office.id) ?? []),
        ),
      ),
    );
  },
);

router.post(
  "/favourites",
  requireRole("customer"),
  async (req: Request, res: Response): Promise<void> => {
    const parsed = AddFavouriteBody.safeParse(req.body);
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
      res.status(400).json({ error: "Office not found" });
      return;
    }

    const [favourite] = await db
      .insert(favouritesTable)
      .values({
        customerUserId: req.session.user!.id,
        officeId: parsed.data.officeId,
      })
      .onConflictDoNothing()
      .returning();

    const result =
      favourite ??
      (
        await db
          .select()
          .from(favouritesTable)
          .where(
            and(
              eq(favouritesTable.customerUserId, req.session.user!.id),
              eq(favouritesTable.officeId, parsed.data.officeId),
            ),
          )
      )[0];

    res.status(201).json(AddFavouriteResponse.parse(result));
  },
);

router.delete(
  "/favourites/:officeId",
  requireRole("customer"),
  async (req: Request, res: Response): Promise<void> => {
    const params = RemoveFavouriteParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    await db
      .delete(favouritesTable)
      .where(
        and(
          eq(favouritesTable.customerUserId, req.session.user!.id),
          eq(favouritesTable.officeId, params.data.officeId),
        ),
      );

    res.sendStatus(204);

    // Phase 1 analytics: fire favorite_remove event (fire-and-forget, after response)
    try {
      const ctx = extractRequestContext(req);
      fireAnalyticsEvent({
        eventName: "favorite_remove",
        officeId: params.data.officeId,
        visitorId: readVisitorId(req) ?? undefined,
        authenticatedUserId: ctx.authenticatedUserId ?? undefined,
        interfaceLanguage: ctx.interfaceLanguage ?? undefined,
        deviceCategory: ctx.deviceCategory ?? undefined,
        isBot: ctx.isBot,
        botDetectionVersion: ctx.botDetectionVersion,
        exclusionReason: ctx.exclusionReason ?? undefined,
      });
    } catch {
      // Never block the response path
    }
  },
);

export default router;

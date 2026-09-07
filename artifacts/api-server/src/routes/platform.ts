import { Router, type IRouter, type Request, type Response } from "express";
import { db, officesTable, officeCategoryEnum } from "@workspace/db";
import { serviceRequestsTable } from "@workspace/db";
import { count, eq, sql } from "drizzle-orm";
import { GetPlatformSummaryResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.get(
  "/platform/summary",
  async (_req: Request, res: Response): Promise<void> => {
    // Office counts from the offices table (active offices only).
    const [officeTotals] = await db
      .select({
        totalOffices: count(),
        verifiedOffices: sql<number>`count(*) filter (where ${officesTable.isVerified})`,
      })
      .from(officesTable)
      .where(eq(officesTable.status, "active"));

    // Total completed transactions from the real service-request workflow.
    // This replaces the legacy offices.completed_transactions static column
    // (which contained seeded demo values). Uses the live workflow data only.
    const [srTotals] = await db
      .select({
        totalCompletedTransactions: sql<number>`count(*)::int`,
      })
      .from(serviceRequestsTable)
      .where(eq(serviceRequestsTable.status, "completed"));

    res.json(
      GetPlatformSummaryResponse.parse({
        totalOffices: Number(officeTotals?.totalOffices ?? 0),
        verifiedOffices: Number(officeTotals?.verifiedOffices ?? 0),
        totalCompletedTransactions: Number(
          srTotals?.totalCompletedTransactions ?? 0,
        ),
        totalCategories: officeCategoryEnum.length,
      }),
    );
  },
);

export default router;

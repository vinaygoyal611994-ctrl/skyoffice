import { Router, type IRouter, type Request, type Response } from "express";
import { db, officesTable, officeCategoryEnum } from "@workspace/db";
import { count, eq } from "drizzle-orm";
import { ListCategoriesResponse } from "@workspace/api-zod";
import { CATEGORY_LABELS } from "../lib/categories";

const router: IRouter = Router();

router.get("/categories", async (_req: Request, res: Response): Promise<void> => {
  const rows = await db
    .select({ category: officesTable.category, count: count() })
    .from(officesTable)
    .where(eq(officesTable.status, "active"))
    .groupBy(officesTable.category);

  const countsByCategory = new Map(rows.map((r) => [r.category, r.count]));

  const result = officeCategoryEnum.map((key) => ({
    key,
    labelAr: CATEGORY_LABELS[key].labelAr,
    labelEn: CATEGORY_LABELS[key].labelEn,
    officeCount: countsByCategory.get(key) ?? 0,
  }));

  res.json(ListCategoriesResponse.parse(result));
});

export default router;

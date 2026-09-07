import { Router, type IRouter, type Request, type Response } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";

const router: IRouter = Router();

router.get("/healthz", async (req: Request, res: Response): Promise<void> => {
  // Shallow check (default): confirms the process is alive.
  if (req.query.deep !== "1") {
    const data = HealthCheckResponse.parse({ status: "ok" });
    res.json(data);
    return;
  }

  // Deep check (?deep=1): verifies the database pool can execute a query.
  // Returns 200 { status:"ok", db:"ok" } on success, or
  //         503 { status:"degraded", db:"error", message } on failure.
  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
    } finally {
      client.release();
    }
    res.json({ status: "ok", db: "ok" });
  } catch (err) {
    res.status(503).json({
      status: "degraded",
      db: "error",
      message: (err as Error).message,
    });
  }
});

export default router;

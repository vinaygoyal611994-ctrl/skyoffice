import { Router, type IRouter, type Request, type Response } from "express";
import crypto from "crypto";
import { requireRole } from "../middlewares/authMiddleware";
import { getOfficeIdForUser } from "../lib/auth";
import {
  getZoomAuthUrl,
  connectZoomWithCode,
  getZoomConnectionStatus,
  disconnectZoom,
} from "../services/zoomService";

const router: IRouter = Router();

// Store OAuth state in session to prevent CSRF
declare module "express-session" {
  interface SessionData {
    zoomOAuthState?: string;
  }
}

function signState(payload: string): string {
  const secret = process.env.SESSION_SECRET ?? "skayoffice-secret";
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

/**
 * GET /zoom/oauth/start
 * Generates Zoom OAuth URL and redirects the office to Zoom's auth page.
 */
router.get(
  "/zoom/oauth/start",
  requireRole("office"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const officeId = await getOfficeIdForUser(req.session.user!.id);
      if (!officeId) {
        res.status(403).json({ error: "No office profile for this account" });
        return;
      }
      // Encode officeId in state so callback doesn't need session cookie
      const random = crypto.randomBytes(16).toString("hex");
      const payload = `${officeId}.${random}`;
      const state = `${payload}.${signState(payload)}`;

      const authUrl = getZoomAuthUrl(state);
      res.json({ url: authUrl });
    } catch (err: any) {
      req.log?.error({ err: err.message }, "[zoom] Failed to generate auth URL");
      res.status(500).json({ error: "Zoom OAuth not configured on this server" });
    }
  },
);

/**
 * GET /zoom/oauth/callback
 * Handles the redirect from Zoom after the office authorises the app.
 * Exchanges the code for tokens and saves them.
 */
router.get(
  "/zoom/oauth/callback",
  async (req: Request, res: Response): Promise<void> => {
    const { code, state, error } = req.query as Record<string, string>;

    if (error) {
      req.log?.warn({ error }, "[zoom] OAuth denied by office");
      const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:25700";
      res.redirect(`${frontendUrl}/?zoom=denied`);
      return;
    }

    if (!state) {
      res.status(400).json({ error: "Missing state" });
      return;
    }

    // Validate HMAC-signed state (officeId.random.sig)
    const parts = state.split(".");
    if (parts.length !== 3) {
      res.status(400).json({ error: "Invalid state format" });
      return;
    }
    const [officeIdStr, random, receivedSig] = parts;
    const payload = `${officeIdStr}.${random}`;
    if (signState(payload) !== receivedSig) {
      req.log?.warn("[zoom] OAuth state signature invalid — possible CSRF");
      res.status(400).json({ error: "Invalid OAuth state" });
      return;
    }

    const officeId = parseInt(officeIdStr, 10);
    if (isNaN(officeId) || officeId <= 0) {
      res.status(400).json({ error: "Invalid office in state" });
      return;
    }

    if (!code) {
      res.status(400).json({ error: "Missing authorization code" });
      return;
    }

    try {
      await connectZoomWithCode(officeId, code);
      req.log?.info({ officeId }, "[zoom] Office connected Zoom account");
      const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:25700";
      res.redirect(`${frontendUrl}/?zoom=connected`);
    } catch (err: any) {
      req.log?.error({ err: err.message, officeId }, "[zoom] Failed to connect Zoom");
      const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:25700";
      res.redirect(`${frontendUrl}/?zoom=error`);
    }
  },
);

/**
 * GET /zoom/status
 * Returns the Zoom connection status for the authenticated office.
 */
router.get(
  "/zoom/status",
  requireRole("office"),
  async (req: Request, res: Response): Promise<void> => {
    const officeId = await getOfficeIdForUser(req.session.user!.id);
    if (!officeId) {
      res.status(403).json({ error: "No office profile for this account" });
      return;
    }

    const status = await getZoomConnectionStatus(officeId);
    res.json(status);
  },
);

/**
 * DELETE /zoom/disconnect
 * Disconnects the office's Zoom account. Existing booking records are preserved.
 */
router.delete(
  "/zoom/disconnect",
  requireRole("office"),
  async (req: Request, res: Response): Promise<void> => {
    const officeId = await getOfficeIdForUser(req.session.user!.id);
    if (!officeId) {
      res.status(403).json({ error: "No office profile for this account" });
      return;
    }

    await disconnectZoom(officeId);
    req.log?.info({ officeId }, "[zoom] Office disconnected Zoom");
    res.json({ success: true });
  },
);

/**
 * POST /zoom/webhooks
 * Receives event notifications from Zoom (meeting deleted, updated, etc.)
 * Zoom sends a URL validation challenge on first registration.
 */
router.post(
  "/zoom/webhooks",
  async (req: Request, res: Response): Promise<void> => {
    // Zoom URL validation handshake
    if (req.body?.event === "endpoint.url_validation") {
      const plainToken = req.body.payload?.plainToken ?? "";
      const webhookSecret = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
      if (!webhookSecret) {
        res.status(500).json({ error: "Webhook secret not configured" });
        return;
      }
      const hashForValidate = crypto
        .createHmac("sha256", webhookSecret)
        .update(plainToken)
        .digest("hex");
      res.json({ plainToken, encryptedToken: hashForValidate });
      return;
    }

    // Verify webhook signature
    const webhookSecret = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;
    if (webhookSecret) {
      const message = `v0:${req.headers["x-zm-request-timestamp"]}:${JSON.stringify(req.body)}`;
      const expectedSig = "v0=" + crypto.createHmac("sha256", webhookSecret).update(message).digest("hex");
      const receivedSig = req.headers["x-zm-signature"] as string;
      if (receivedSig !== expectedSig) {
        req.log?.warn("[zoom-webhook] Invalid signature");
        res.status(401).json({ error: "Invalid signature" });
        return;
      }
    }

    const event = req.body?.event as string;
    req.log?.info({ event }, "[zoom-webhook] Received event");

    // Handle meeting deleted event from Zoom side
    if (event === "meeting.deleted" || event === "meeting.ended") {
      // Future: update provider_status in video_call_meeting_details
      // Currently logged only — booking lifecycle is managed by SkayOffice
    }

    res.json({ received: true });
  },
);

export default router;

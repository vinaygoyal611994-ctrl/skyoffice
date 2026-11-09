import crypto from "crypto";
import { db, officeZoomConnectionsTable, videoCallMeetingDetailsTable } from "@workspace/db";
import { and, eq, ne } from "drizzle-orm";
import { encrypt, decrypt } from "../lib/encryption";

const ZOOM_BASE = "https://api.zoom.us/v2";
const ZOOM_OAUTH_BASE = "https://zoom.us/oauth";

// ── Env helpers ──────────────────────────────────────────────────────────────

function zoomCreds() {
  const clientId = process.env.ZOOM_CLIENT_ID;
  const clientSecret = process.env.ZOOM_CLIENT_SECRET;
  const redirectUri = process.env.ZOOM_REDIRECT_URI;
  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error("Zoom OAuth env vars (ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET, ZOOM_REDIRECT_URI) not configured");
  }
  return { clientId, clientSecret, redirectUri };
}

// ── OAuth URL ────────────────────────────────────────────────────────────────

export function getZoomAuthUrl(state: string): string {
  const { clientId, redirectUri } = zoomCreds();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    state,
  });
  return `${ZOOM_OAUTH_BASE}/authorize?${params}`;
}

// ── Token exchange ───────────────────────────────────────────────────────────

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

async function exchangeCode(code: string): Promise<TokenResponse> {
  const { clientId, clientSecret, redirectUri } = zoomCreds();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const resp = await fetch(`${ZOOM_OAUTH_BASE}/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Zoom code exchange failed: ${resp.status} ${body}`);
  }
  return resp.json() as Promise<TokenResponse>;
}

async function doRefreshToken(encryptedRefreshToken: string): Promise<TokenResponse> {
  const { clientId, clientSecret } = zoomCreds();
  const refreshToken = decrypt(encryptedRefreshToken);
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const resp = await fetch(`${ZOOM_OAUTH_BASE}/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Zoom token refresh failed: ${resp.status} ${body}`);
  }
  return resp.json() as Promise<TokenResponse>;
}

// ── Zoom user profile ────────────────────────────────────────────────────────

interface ZoomUser {
  id: string;
  account_id: string;
  email: string;
}

async function fetchZoomUser(accessToken: string): Promise<ZoomUser> {
  const resp = await fetch(`${ZOOM_BASE}/users/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) throw new Error("Failed to fetch Zoom user profile");
  return resp.json() as Promise<ZoomUser>;
}

// ── Save OAuth connection ────────────────────────────────────────────────────

export async function connectZoomWithCode(officeId: number, code: string): Promise<void> {
  const tokens = await exchangeCode(code);
  const zoomUser = await fetchZoomUser(tokens.access_token);
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);

  await db
    .insert(officeZoomConnectionsTable)
    .values({
      officeId,
      zoomAccountId: zoomUser.account_id,
      zoomUserId: zoomUser.id,
      zoomUserEmail: zoomUser.email,
      encryptedAccessToken: encrypt(tokens.access_token),
      encryptedRefreshToken: encrypt(tokens.refresh_token),
      tokenExpiresAt: expiresAt,
      grantedScopes: tokens.scope,
      status: "connected",
      lastValidatedAt: new Date(),
      lastRefreshedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: officeZoomConnectionsTable.officeId,
      set: {
        zoomAccountId: zoomUser.account_id,
        zoomUserId: zoomUser.id,
        zoomUserEmail: zoomUser.email,
        encryptedAccessToken: encrypt(tokens.access_token),
        encryptedRefreshToken: encrypt(tokens.refresh_token),
        tokenExpiresAt: expiresAt,
        grantedScopes: tokens.scope,
        status: "connected",
        lastValidatedAt: new Date(),
        lastRefreshedAt: new Date(),
      },
    });
}

// ── Get valid access token (auto-refresh) ────────────────────────────────────

export async function getValidAccessToken(officeId: number): Promise<string> {
  const [conn] = await db
    .select()
    .from(officeZoomConnectionsTable)
    .where(eq(officeZoomConnectionsTable.officeId, officeId));

  if (!conn || !conn.encryptedAccessToken || !conn.encryptedRefreshToken) {
    throw new Error("ZOOM_NOT_CONNECTED");
  }
  if (conn.status === "reauth_required" || conn.status === "disconnected") {
    throw new Error("ZOOM_REAUTH_REQUIRED");
  }

  // Refresh if token expires within 5 minutes
  const needsRefresh =
    !conn.tokenExpiresAt ||
    conn.tokenExpiresAt.getTime() - Date.now() < 5 * 60 * 1000;

  if (!needsRefresh) return decrypt(conn.encryptedAccessToken);

  // Conditional update: only proceed if not already refreshing (prevents race condition)
  const claimed = await db
    .update(officeZoomConnectionsTable)
    .set({ status: "token_refreshing" })
    .where(
      and(
        eq(officeZoomConnectionsTable.officeId, officeId),
        ne(officeZoomConnectionsTable.status, "token_refreshing"),
      ),
    )
    .returning({ id: officeZoomConnectionsTable.id });

  if (claimed.length === 0) {
    // Another concurrent request is already refreshing — return current token as-is
    return decrypt(conn.encryptedAccessToken);
  }

  try {
    const newTokens = await doRefreshToken(conn.encryptedRefreshToken);
    const expiresAt = new Date(Date.now() + newTokens.expires_in * 1000);

    await db
      .update(officeZoomConnectionsTable)
      .set({
        encryptedAccessToken: encrypt(newTokens.access_token),
        encryptedRefreshToken: encrypt(newTokens.refresh_token),
        tokenExpiresAt: expiresAt,
        status: "connected",
        lastRefreshedAt: new Date(),
      })
      .where(eq(officeZoomConnectionsTable.officeId, officeId));

    return newTokens.access_token;
  } catch {
    await db
      .update(officeZoomConnectionsTable)
      .set({ status: "reauth_required" })
      .where(eq(officeZoomConnectionsTable.officeId, officeId));
    throw new Error("ZOOM_REAUTH_REQUIRED");
  }
}

// ── Create Zoom meeting ──────────────────────────────────────────────────────

export interface ZoomMeetingResult {
  meetingId: string;
  joinUrl: string;
  startUrl: string;
  password: string;
}

export async function createZoomMeeting(
  officeId: number,
  topic: string,
  startTime: string,
  timezone = "UTC",
): Promise<ZoomMeetingResult> {
  const accessToken = await getValidAccessToken(officeId);

  const resp = await fetch(`${ZOOM_BASE}/users/me/meetings`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      topic,
      type: 2, // Scheduled
      start_time: startTime,
      duration: 25,
      timezone,
      password: crypto.randomBytes(4).toString("hex"),
      settings: {
        waiting_room: true,
        auto_recording: "none",
        join_before_host: false,
        participant_video: true,
        host_video: true,
        mute_upon_entry: false,
        approval_type: 2, // No registration required
        password_required: true,
      },
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Zoom meeting creation failed: ${resp.status} ${body}`);
  }

  const data = (await resp.json()) as {
    id: number;
    join_url: string;
    start_url: string;
    password: string;
  };

  return {
    meetingId: String(data.id),
    joinUrl: data.join_url,
    startUrl: data.start_url,
    password: data.password,
  };
}

// ── Cancel Zoom meeting ──────────────────────────────────────────────────────

export async function cancelZoomMeeting(
  officeId: number,
  externalMeetingId: string,
): Promise<void> {
  let accessToken: string;
  try {
    accessToken = await getValidAccessToken(officeId);
  } catch {
    // If tokens gone, treat as already cancelled
    return;
  }

  const resp = await fetch(`${ZOOM_BASE}/meetings/${externalMeetingId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  // 204 = deleted, 404 = already gone — both are acceptable
  if (!resp.ok && resp.status !== 404) {
    throw new Error(`Zoom meeting cancellation failed: ${resp.status}`);
  }
}

// ── Disconnect ───────────────────────────────────────────────────────────────

export async function disconnectZoom(officeId: number): Promise<void> {
  await db
    .update(officeZoomConnectionsTable)
    .set({
      status: "disconnected",
      encryptedAccessToken: null,
      encryptedRefreshToken: null,
      tokenExpiresAt: null,
    })
    .where(eq(officeZoomConnectionsTable.officeId, officeId));
}

// ── Get connection status ────────────────────────────────────────────────────

export async function getZoomConnectionStatus(officeId: number) {
  const [conn] = await db
    .select({
      status: officeZoomConnectionsTable.status,
      zoomUserEmail: officeZoomConnectionsTable.zoomUserEmail,
      lastValidatedAt: officeZoomConnectionsTable.lastValidatedAt,
    })
    .from(officeZoomConnectionsTable)
    .where(eq(officeZoomConnectionsTable.officeId, officeId));

  return conn ?? {
    status: "not_connected" as const,
    zoomUserEmail: null,
    lastValidatedAt: null,
  };
}

// ── Get meeting details for a video call request ─────────────────────────────

export async function getMeetingForRequest(videoCallRequestId: number) {
  const [meeting] = await db
    .select()
    .from(videoCallMeetingDetailsTable)
    .where(eq(videoCallMeetingDetailsTable.videoCallRequestId, videoCallRequestId));
  return meeting ?? null;
}

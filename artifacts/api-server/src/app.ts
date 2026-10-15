import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import session from "express-session";
import pgSession from "connect-pg-simple";
import signature from "cookie-signature";
import * as Sentry from "@sentry/node";
import router from "./routes";
import { logger } from "./lib/logger";
import { attachSessionUser, enforceAdminSessionLimits } from "./middlewares/authMiddleware";
import { pool } from "@workspace/db";
import { recordHttpError } from "./lib/healthTracker";
import type { NextFunction, Request, Response } from "express";

const app: Express = express();

if (!process.env.SESSION_SECRET) {
  throw new Error(
    "SESSION_SECRET environment variable is required but was not provided.",
  );
}

// ---------------------------------------------------------------------------
// Sentry error monitoring — only active when SENTRY_DSN is set.
// Set SENTRY_DSN in Replit Secrets to enable. When absent the app runs
// normally; all errors still appear in Pino logs.
// ---------------------------------------------------------------------------
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
    // Never send session tokens, passwords, or customer PII to Sentry.
    sendDefaultPii: false,
    beforeSend(event) {
      // Scrub Authorization headers (bearer session tokens)
      if (event.request?.headers) {
        delete event.request.headers["authorization"];
        delete event.request.headers["cookie"];
      }
      // Scrub request body fields that may carry credentials or PII
      if (event.request?.data && typeof event.request.data === "object") {
        const body = event.request.data as Record<string, unknown>;
        for (const field of ["password", "passwordHash", "sessionToken", "token"]) {
          if (field in body) body[field] = "[REDACTED]";
        }
      }
      return event;
    },
  });
  logger.info("Sentry error monitoring initialized");
} else {
  logger.info("SENTRY_DSN not set — error monitoring disabled (set SENTRY_DSN secret to enable)");
}

const PgSessionStore = pgSession(session);

// ---------------------------------------------------------------------------
// CORS allowlist
// ---------------------------------------------------------------------------
function buildAllowedOrigins(): Set<string> {
  const origins = new Set<string>();

  if (
    process.env.NODE_ENV === "production" &&
    !process.env.CORS_ALLOWED_ORIGINS?.trim()
  ) {
    throw new Error(
      "[startup] CORS_ALLOWED_ORIGINS is required in production. Set it to a " +
        "comma-separated list of canonical frontend origins before deploying.",
    );
  }

  const fromEnvList = (raw: string | undefined) => {
    if (!raw) return;
    for (const entry of raw.split(",")) {
      const trimmed = entry.trim();
      if (trimmed) origins.add(trimmed);
    }
  };

  fromEnvList(process.env.CORS_ALLOWED_ORIGINS);

  if (process.env.REPLIT_DEV_DOMAIN) {
    origins.add(`https://${process.env.REPLIT_DEV_DOMAIN}`);
  }
  for (const domain of process.env.REPLIT_DOMAINS?.split(",") ?? []) {
    const trimmed = domain.trim();
    if (trimmed) origins.add(`https://${trimmed}`);
  }

  // Local dev (running the workspace outside the Replit proxy).
  // Port 25700 is the current Vite dev server port (assigned by the PORT env
  // var in the artifact config).  5173 is kept for backwards compatibility in
  // case any tooling still uses the old default port.
  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost:5173");
    origins.add("http://127.0.0.1:5173");
    origins.add("http://localhost:25700");
    origins.add("http://127.0.0.1:25700");
  }

  return origins;
}

const allowedOrigins = buildAllowedOrigins();
logger.info({ allowedOrigins: [...allowedOrigins] }, "CORS allowlist configured");

class CorsOriginNotAllowedError extends Error {
  constructor() {
    super("Not allowed by CORS");
  }
}

// ---------------------------------------------------------------------------
// Request logging
// ---------------------------------------------------------------------------
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// ---------------------------------------------------------------------------
// Security headers (Helmet)
// Placed before CORS so headers appear on every response including 4xx/5xx.
//
// CSP note: this server only returns JSON (never HTML), so a strict
// default-src 'none' policy is correct and safe. Browsers ignore
// Content-Security-Policy on non-HTML content types.
//
// HSTS is only emitted in production — the Replit Autoscale proxy already
// enforces HTTPS; adding HSTS in dev would lock out plain-HTTP local testing.
// ---------------------------------------------------------------------------
app.disable("x-powered-by");
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    // HSTS: 180 days in production, disabled in development
    hsts: process.env.NODE_ENV === "production"
      ? { maxAge: 15_552_000, includeSubDomains: true, preload: false }
      : false,
    // API resources are consumed cross-origin by the frontend
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    // Standard protective headers
    noSniff: true,           // X-Content-Type-Options: nosniff
    frameguard: { action: "deny" }, // X-Frame-Options: DENY
    referrerPolicy: { policy: "no-referrer" },
    permittedCrossDomainPolicies: { permittedPolicies: "none" },
  }),
);

// Helmet 8 does not expose permissionsPolicy in its combined options type.
// Set the header manually so microphone and geolocation are allowed for
// same-origin — Helmet's default sends microphone=() which blocks the
// browser mic API even when the user has granted permission.
app.use((_req, res, next) => {
  res.setHeader("Permissions-Policy", "camera=(), microphone=(self), geolocation=(self)");
  next();
});

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }
      if (allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      logger.warn({ origin }, "Rejected CORS request from disallowed origin");
      callback(new CorsOriginNotAllowedError());
    },
    credentials: true,
  }),
);
// Turns a rejected CORS origin into a clean, bilingual 403 instead of
// the default Express error page (which would leak a stack trace).
app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (err instanceof CorsOriginNotAllowedError) {
    res.status(403).json({
      error: "هذا المصدر غير مسموح له بالوصول إلى الخادم.\nThis origin is not allowed to access this server.",
    });
    return;
  }
  next(err);
});
const jsonBodyParser = express.json();
const urlencodedBodyParser = express.urlencoded({ extended: true });
const isDirectUploadRelay = (req: Request) =>
  req.method === "PUT" &&
  /^\/api\/storage\/uploads\/direct\/[^/]+$/.test(req.path);

// The upload relay must authenticate and validate its claim/category before
// reading any bytes. Letting these requests pass through the global JSON or
// form parsers first would bypass that admission order when a caller spoofed
// Content-Type.
app.use((req: Request, res: Response, next: NextFunction) => {
  if (isDirectUploadRelay(req)) {
    next();
    return;
  }
  jsonBodyParser(req, res, next);
});
app.use((req: Request, res: Response, next: NextFunction) => {
  if (isDirectUploadRelay(req)) {
    next();
    return;
  }
  urlencodedBodyParser(req, res, next);
});

// ---------------------------------------------------------------------------
// Bearer-token → session-cookie shim (required for Replit Autoscale)
//
// Autoscale's Google Frontend layer replaces this app's `Set-Cookie` header
// with its own session-affinity cookie (GAESA) before the response reaches
// the browser — the app's own `connect.sid` cookie never arrives client-side,
// so cookie-based sessions cannot work there. This is a platform-level
// behavior of Autoscale deployments, not something fixable by adjusting
// cookie flags/trust-proxy settings in this app.
//
// To keep sessions working without changing the deployment target, the
// client instead receives its session id in the JSON login/register response
// body (see routes/auth.ts) and stores it itself, resending it on every
// request as `Authorization: Bearer <sessionId>`. This middleware converts
// that header back into the signed `connect.sid` cookie format that
// express-session expects, *before* the session middleware runs, so the rest
// of the session machinery (store lookups, req.session, save/destroy) is
// completely unchanged. Real cookies (e.g. in the dev environment, where
// Set-Cookie is not stripped) keep working exactly as before.
//
// Token validation: express-session generates UUID v4 session IDs. We reject
// tokens that do not match this format before signing them — a malformed or
// garbage token skips the session-store lookup entirely, so the request
// continues unauthenticated (req.session.user is undefined) and the auth
// middleware returns 401 cleanly instead of forwarding an invalid cookie to
// the Postgres session store, which could produce an unexpected 500.
// ---------------------------------------------------------------------------
const SESSION_COOKIE_NAME = "connect.sid";
// express-session uses uid-safe to generate session IDs: 24 random bytes
// encoded as base64url, producing a 32-character string from the charset
// [A-Za-z0-9_-].  We accept any token that consists solely of those
// characters and is between 20 and 128 characters long.  This rejects
// obviously garbage payloads (empty strings, SQL fragments, HTML, short
// random junk) without introducing knowledge of the exact ID length — a
// custom genid option could produce IDs of different lengths.  Tokens that
// pass this check but have no matching session in the store are handled
// gracefully: express-session leaves req.session.user undefined and the auth
// middleware returns 401, never 500.
const SESSION_ID_REGEX = /^[A-Za-z0-9_-]{20,128}$/;
app.use((req, _res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    // Only inject tokens that look like genuine uid-safe session IDs.
    // Malformed or garbage tokens skip injection, leaving req.session.user
    // undefined → downstream 401, never 500.
    if (token && SESSION_ID_REGEX.test(token)) {
      const signed = `s:${signature.sign(token, process.env.SESSION_SECRET!)}`;
      const cookiePair = `${SESSION_COOKIE_NAME}=${encodeURIComponent(signed)}`;
      req.headers.cookie = req.headers.cookie
        ? `${req.headers.cookie}; ${cookiePair}`
        : cookiePair;
    }
  }
  next();
});

app.use(
  session({
    // createTableIfMissing is intentionally false: the session table is created
    // by the database migrations and is guaranteed to exist by the time the
    // server starts. Leaving it true causes connect-pg-simple to call
    // _rawEnsureSessionStoreTable before every session operation; if that
    // internal pg connection times out (common on cold-start Autoscale
    // deployments) the promise rejects and is not cached, so every subsequent
    // session write also fails → every login after authentication returns 500.
    store: new PgSessionStore({ pool, tableName: "session", createTableIfMissing: false }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    // HIGH-07: rolling sessions keep active users signed in; reduced maxAge
    // limits blast radius if a session token is ever stolen.
    rolling: true,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days (was 30)
    },
  }),
);
app.use(attachSessionUser);

// HIGH-07: Enforce 8-hour absolute lifetime and 30-minute idle timeout for
// admin sessions.  Non-admin sessions pass through this middleware unchanged.
app.use(enforceAdminSessionLimits);

app.use("/api", router);

// ---------------------------------------------------------------------------
// API 404 — must come AFTER the router so it only fires for paths that no
// route handler matched. Returns JSON (never Express's default HTML page),
// keeping the API contract consistent for all callers.
// ---------------------------------------------------------------------------
app.use("/api", (_req: Request, res: Response) => {
  res.status(404).json({ error: "Not found" });
});

// ---------------------------------------------------------------------------
// Sentry error handler — must be registered after all routes
// ---------------------------------------------------------------------------
if (process.env.SENTRY_DSN) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use(Sentry.expressErrorHandler() as any);
}

// ---------------------------------------------------------------------------
// Generic error handler — catches anything not handled by routes
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, "Unhandled API error");
  // Record in the in-memory health tracker (query string stripped inside recordHttpError)
  recordHttpError(500, req.method, req.path, err);
  if (!res.headersSent) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default app;

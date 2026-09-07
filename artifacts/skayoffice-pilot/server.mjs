/**
 * SkayOffice Pilot — Production Static File Server
 *
 * Replaces Replit's CDN static-serve so we can apply full security headers
 * (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy,
 * Permissions-Policy, HSTS) to every HTML, JS, CSS, and asset response.
 *
 * This is intentionally dependency-free (Node.js built-ins only) so it adds
 * zero install-time risk and starts in < 50 ms.
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Configuration ────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT || '25700', 10);
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PROD = NODE_ENV === 'production';
const CANONICAL_ORIGIN = 'https://skayoffice.com';

// The built frontend lives here (matches vite.config.ts build.outDir)
const PUBLIC_DIR = path.resolve(__dirname, 'dist/public');

// ── MIME types ───────────────────────────────────────────────────────────────

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif':  'image/gif',
  '.ico':  'image/x-icon',
  '.txt':  'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf':  'font/ttf',
  '.otf':  'font/otf',
  '.pdf':  'application/pdf',
};

// ── Security headers ─────────────────────────────────────────────────────────
//
// CSP directive rationale:
//   script-src 'self'
//     — Vite production build emits only external .js files; no inline scripts.
//       modulePreload polyfill is disabled in vite.config.ts to keep this clean.
//   style-src 'self' 'unsafe-inline' https://fonts.googleapis.com
//     — 'unsafe-inline' is required because React components and Radix UI use
//       the style= attribute for dynamic values (e.g. popover positioning,
//       Recharts SVG dimensions). Google Fonts stylesheet is loaded from
//       fonts.googleapis.com; the actual font binaries from fonts.gstatic.com.
//   img-src / media-src: 'self'
//     — Public office media is served through the app's authenticated storage
//       routes. blob: supports local upload previews.
//   connect-src 'self' [STORAGE_ENDPOINT]
//     — All API calls go through the Replit proxy to /api (same origin).
//       S3/R2 presigned upload URLs are called directly from the browser when
//       STORAGE_ENDPOINT is provided to the production web process.
//   frame-ancestors 'none'
//     — Blocks clickjacking; equivalent to X-Frame-Options: DENY but works
//       even when CSP is set via HTTP header (meta tag cannot carry this).
//   unsafe-eval is NOT present anywhere; React production builds don't need it.

const storageEndpoint = process.env.STORAGE_ENDPOINT?.replace(/\/+$/, '');
const storageConnectSource = storageEndpoint ? ` ${storageEndpoint}` : '';

const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self'",
  `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  `connect-src 'self'${storageConnectSource}`,
  "font-src 'self' data: https://fonts.gstatic.com",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const SECURITY_HEADERS = {
  'X-Content-Type-Options':    'nosniff',
  'X-Frame-Options':           'DENY',
  'Referrer-Policy':           'strict-origin-when-cross-origin',
  'Permissions-Policy':        'camera=(), microphone=(), geolocation=(self)',
  'Content-Security-Policy':   CSP_DIRECTIVES,
  // HSTS: 180 days, include subdomains. Only meaningful over HTTPS (Replit prod).
  ...(IS_PROD ? { 'Strict-Transport-Security': 'max-age=15552000; includeSubDomains' } : {}),
};

// ── Cache-Control policy ─────────────────────────────────────────────────────
//
// HTML:  no-cache — must revalidate on every navigation so deploys take effect
// Assets (JS/CSS/images with content-hash filenames): immutable, 1 year
// Other (favicon, robots.txt, etc.): short cache, revalidate

function cacheControl(mimeType, filePath) {
  if (mimeType.startsWith('text/html'))        return 'no-cache';
  // Vite appends a content hash to JS and CSS bundles — safe to cache forever
  if (/\.[a-f0-9]{8,}\.(js|css)$/.test(filePath)) return 'public, max-age=31536000, immutable';
  return 'public, max-age=3600';
}

// ── Request handler ──────────────────────────────────────────────────────────

function serveFile(res, filePath, mimeType) {
  const stat = fs.statSync(filePath);
  const headers = {
    'Content-Type':    mimeType,
    'Content-Length':  stat.size,
    'Cache-Control':   cacheControl(mimeType, filePath),
    ...SECURITY_HEADERS,
  };
  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

function canonicalUrlForRequest(requestPath) {
  const pathname = requestPath === '/index.html' ? '/' : requestPath;
  const normalizedPath = pathname === '/' ? '/' : `/${pathname.replace(/^\/+|\/+$/g, '')}`;
  const canonicalUrl = new URL(CANONICAL_ORIGIN);
  canonicalUrl.pathname = normalizedPath;
  return canonicalUrl.href;
}

function serveIndex(res, requestPath) {
  const indexPath = path.join(PUBLIC_DIR, 'index.html');
  const canonicalUrl = canonicalUrlForRequest(requestPath);
  const html = fs.readFileSync(indexPath, 'utf8')
    .replace(
      '<link rel="canonical" href="https://skayoffice.com/" />',
      `<link rel="canonical" href="${canonicalUrl}" />`,
    )
    .replace(
      '<meta property="og:url" content="https://skayoffice.com/" />',
      `<meta property="og:url" content="${canonicalUrl}" />`,
    );
  res.writeHead(200, {
    'Content-Type':   'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    'Cache-Control':  'no-cache',
    ...SECURITY_HEADERS,
  });
  res.end(html);
}

function handle(req, res) {
  // Health check — used by Replit startup probe
  if (req.url === '/healthz' || req.url === '/healthz?') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('ok');
    return;
  }

  // Strip query string and normalise
  const rawPath = req.url.split('?')[0];
  const urlPath = rawPath === '/' ? '/index.html' : rawPath;
  const filePath = path.join(PUBLIC_DIR, urlPath);

  // Path traversal guard
  if (!filePath.startsWith(PUBLIC_DIR + path.sep) && filePath !== PUBLIC_DIR) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }

  // Try to serve the exact file
  try {
    const stat = fs.statSync(filePath);
    if (stat.isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const mimeType = MIME_TYPES[ext] || 'application/octet-stream';
      serveFile(res, filePath, mimeType);
      return;
    }
  } catch (_) {
    // File not found — fall through to SPA catch-all
  }

  // SPA catch-all: every unknown path returns index.html (React Router handles it)
  try {
    serveIndex(res, rawPath);
  } catch (err) {
    console.error('Failed to serve index.html:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  }
}

// ── Start server ─────────────────────────────────────────────────────────────

const server = http.createServer(handle);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`SkayOffice Pilot frontend server running on port ${PORT} (${NODE_ENV})`);
  console.log(`Serving static files from: ${PUBLIC_DIR}`);
});

server.on('error', (err) => {
  console.error('Server error:', err);
  process.exit(1);
});

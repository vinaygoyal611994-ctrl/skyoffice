import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

// ---------------------------------------------------------------------------
// Security response headers for the React SPA
//
// These headers are applied by the Vite dev server to every response
// (HTML, JS, CSS, assets). They complement the security headers on the
// API server (see artifacts/api-server/src/app.ts).
//
// CSP notes:
//  - unsafe-inline and unsafe-eval are required by the Vite HMR dev server.
//    A production build step (vite build) would allow a stricter policy with
//    script hashes instead of these directives.
//  - STORAGE_ENDPOINT, when supplied, is added only to connect-src because
//    browser uploads go directly to S3/R2 presigned PUT URLs. Credentials are
//    never exposed to the browser.
//  - connect-src 'self' covers API calls routed through the app proxy.
// ---------------------------------------------------------------------------
const storageEndpoint = process.env.STORAGE_ENDPOINT?.replace(/\/+$/, '');
const storageConnectSource = storageEndpoint ? ` ${storageEndpoint}` : '';

const securityHeaders: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(self), geolocation=(self)",
  "Content-Security-Policy": [
    "default-src 'self'",
    // Vite HMR requires unsafe-inline + unsafe-eval in dev server mode
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    // Tailwind CSS utility classes + shadcn/ui use inline style attributes
    // fonts.googleapis.com serves the Google Fonts CSS (Plus Jakarta Sans + Readex Pro)
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    // Public media is served by the API; blob covers local upload previews.
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    // API calls plus optional S3/R2 presigned uploads.
    `connect-src 'self'${storageConnectSource}`,
    // fonts.gstatic.com serves the actual Google Font binary files
    "font-src 'self' data: https://fonts.gstatic.com",
    // No iframes allowed anywhere in the app
    "frame-src 'none'",
    // Prevents this page from being embedded in an iframe (clickjacking)
    "frame-ancestors 'none'",
    // No Flash, Java, or other plugin content
    "object-src 'none'",
    // Prevents base-tag injection attacks
    "base-uri 'self'",
  ].join("; "),
};

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    ...(process.env.NODE_ENV !== 'production'
      ? [
          await import('@replit/vite-plugin-runtime-error-modal').then(
            (m) => m.default(),
          ),
        ]
      : []),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
    // Disable the modulepreload polyfill inline script so the production CSP
    // can use `script-src 'self'` without `unsafe-inline`.
    // Modern browsers (Chrome 66+, Firefox 115+, Safari 17+) support
    // <link rel="modulepreload"> natively; the polyfill is not needed.
    modulePreload: { polyfill: false },
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
    headers: securityHeaders,
    // Proxy /api calls to the API server in dev so that Playwright / browser
    // tests running against localhost:PORT work without the Replit reverse proxy.
    // changeOrigin rewrites the Origin header so the API server's CORS check
    // accepts the request as if it came from localhost:8080 itself.
    proxy: {
      '/api': {
        target: process.env.API_TARGET || 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
    headers: securityHeaders,
  },
});

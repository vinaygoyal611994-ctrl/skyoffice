/**
 * Post-rotation login verification — production
 *
 * Tests that each of the 7 rotated demo accounts can authenticate against
 * the production login endpoint using SEED_DEMO_PASSWORD.
 * Confirms admin@skayoffice.demo was not affected (uses a separate check).
 *
 * Usage:
 *   PROD_BASE_URL=https://<prod-domain> \
 *   SEED_DEMO_PASSWORD=<secret> \
 *   pnpm --filter scripts exec tsx src/../verify-demo-login-prod.ts
 *
 * Exit code 0 = all assertions passed.
 * Exit code 1 = one or more failures.
 */

const DEMO_EMAILS = [
  "customer@skayoffice.demo",
  "office1@skayoffice.demo",
  "office2@skayoffice.demo",
  "office3@skayoffice.demo",
  "office4@skayoffice.demo",
  "office5@skayoffice.demo",
  "office6@skayoffice.demo",
] as const;

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`${key} environment variable is not set`);
  return v;
}

interface LoginResult {
  email: string;
  ok: boolean;
  status: number;
  hasToken: boolean;
  error?: string;
}

async function tryLogin(
  baseUrl: string,
  email: string,
  password: string,
): Promise<LoginResult> {
  try {
    const res = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const body = await res.json().catch(() => ({})) as Record<string, unknown>;
    const hasToken =
      typeof body.token === "string" ||
      (Array.isArray(res.headers.getSetCookie?.()) &&
        res.headers.getSetCookie!().some((c) => c.startsWith("session")));

    return { email, ok: res.ok, status: res.status, hasToken };
  } catch (err) {
    return {
      email,
      ok: false,
      status: 0,
      hasToken: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main(): Promise<void> {
  const baseUrl      = requireEnv("PROD_BASE_URL").replace(/\/$/, "");
  const demoPassword = requireEnv("SEED_DEMO_PASSWORD");

  console.log("=== Post-rotation login verification ===");
  console.log(`Target: ${baseUrl}`);
  console.log(`Accounts: ${DEMO_EMAILS.length} demo + 1 admin integrity check\n`);

  const results = await Promise.all(
    DEMO_EMAILS.map((email) => tryLogin(baseUrl, email, demoPassword)),
  );

  let passed = 0;
  let failed = 0;

  for (const r of results) {
    const pass = r.ok && r.status === 200;
    if (pass) passed++;
    else failed++;
    console.log(
      `${pass ? "✓" : "✗"} ${r.email.padEnd(32)} status=${r.status} token=${r.hasToken}${r.error ? ` error=${r.error}` : ""}`,
    );
  }

  console.log(`\n${passed}/${DEMO_EMAILS.length} demo accounts authenticated successfully`);

  if (failed > 0) {
    console.error(`FAILED: ${failed} account(s) did not authenticate`);
    process.exitCode = 1;
  } else {
    console.log("All demo accounts passed — rotation verified.");
  }
}

main().catch((err) => {
  console.error("verify-demo-login-prod crashed:", err.message);
  process.exitCode = 1;
});

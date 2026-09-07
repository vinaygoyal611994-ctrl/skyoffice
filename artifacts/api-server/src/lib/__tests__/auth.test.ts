import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword } from '../auth';

// CRIT-02: Unit tests for password hashing helpers.
// bcrypt is CPU-heavy; use a low cost factor by mocking the env if needed.
// These run against the real bcrypt implementation — they are intentionally
// slow (~100-200 ms each) but require no database.

describe('hashPassword / verifyPassword', () => {
  it('produces a hash that verifies against the original password', async () => {
    const hash = await hashPassword('Correct-Horse-Battery-Staple-99');
    const ok = await verifyPassword('Correct-Horse-Battery-Staple-99', hash);
    expect(ok).toBe(true);
  }, 30_000);

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('correct-password');
    const ok = await verifyPassword('wrong-password', hash);
    expect(ok).toBe(false);
  }, 30_000);

  it('rejects empty string against a real hash', async () => {
    const hash = await hashPassword('non-empty');
    const ok = await verifyPassword('', hash);
    expect(ok).toBe(false);
  }, 30_000);

  it('two calls to hashPassword with the same input produce different hashes (bcrypt salts)', async () => {
    const hash1 = await hashPassword('same-password');
    const hash2 = await hashPassword('same-password');
    expect(hash1).not.toBe(hash2);
  }, 30_000);

  it('each hash still verifies correctly despite different salts', async () => {
    const hash1 = await hashPassword('same-password');
    const hash2 = await hashPassword('same-password');
    expect(await verifyPassword('same-password', hash1)).toBe(true);
    expect(await verifyPassword('same-password', hash2)).toBe(true);
  }, 30_000);
});

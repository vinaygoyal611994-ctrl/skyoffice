import { describe, it, expect } from 'vitest';
import { isValidEmail, isValidPhone, normalizeEmail, normalizePhone } from '../validation';

// CRIT-02: Unit tests for validation helpers used in auth registration.

describe('isValidEmail', () => {
  it('accepts standard email formats', () => {
    expect(isValidEmail('user@example.com')).toBe(true);
    expect(isValidEmail('user+tag@sub.domain.org')).toBe(true);
  });

  it('rejects malformed emails', () => {
    expect(isValidEmail('')).toBe(false);
    expect(isValidEmail('notanemail')).toBe(false);
    expect(isValidEmail('@nodomain.com')).toBe(false);
    expect(isValidEmail('missing@')).toBe(false);
  });
});

describe('normalizeEmail', () => {
  it('lowercases the entire address', () => {
    expect(normalizeEmail('User@EXAMPLE.COM')).toBe('user@example.com');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeEmail('  user@example.com  ')).toBe('user@example.com');
  });
});

describe('isValidPhone', () => {
  it('accepts E.164-compatible numbers', () => {
    expect(isValidPhone('+966501234567')).toBe(true);
    expect(isValidPhone('+12125551234')).toBe(true);
  });

  it('rejects obviously invalid inputs', () => {
    expect(isValidPhone('')).toBe(false);
    expect(isValidPhone('abc')).toBe(false);
  });
});

describe('normalizePhone', () => {
  it('strips non-digit characters except leading +', () => {
    const result = normalizePhone('+966 50 123 4567');
    // Should contain only digits and optional leading +
    expect(result).toMatch(/^\+?[\d]+$/);
  });
});

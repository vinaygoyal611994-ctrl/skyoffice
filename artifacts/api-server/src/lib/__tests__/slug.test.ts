import { describe, it, expect } from 'vitest';
import { slugify } from '../slug';

// CRIT-02: Unit tests for slug.ts pure helpers.
// These require no database and run offline.

describe('slugify', () => {
  it('lowercases and hyphenates English names', () => {
    expect(slugify('Levant Bridge Translation')).toBe('levant-bridge-translation');
  });

  it('strips diacritics from transliterated names', () => {
    expect(slugify('Café Au Lait')).toBe('cafe-au-lait');
  });

  it('trims leading/trailing hyphens', () => {
    expect(slugify('  --hello world--  ')).toBe('hello-world');
  });

  it('collapses multiple spaces/special chars into a single hyphen', () => {
    expect(slugify('hello   &&&  world')).toBe('hello-world');
  });

  it('returns "office" for Arabic-only (no Latin) names', () => {
    // Arabic characters are stripped, leaving empty string → fallback
    expect(slugify('مكتب اختبار')).toBe('office');
  });

  it('returns "office" for empty string', () => {
    expect(slugify('')).toBe('office');
  });

  it('handles numeric names', () => {
    expect(slugify('123 Main St')).toBe('123-main-st');
  });

  it('is URL-safe (no special characters)', () => {
    const result = slugify('A & B (test) / Ltd.');
    expect(result).toMatch(/^[a-z0-9-]+$/);
  });
});

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      '../skayoffice-pilot/src/components/account/**/*.test.ts',
    ],
    // Integration tests that require DATABASE_URL are skipped automatically
    // when the env var is absent — each suite must check and call `skipIf`.
    passWithNoTests: true,
  },
});

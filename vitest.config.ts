import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import { appVersion } from './vite.config.ts';

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
  },
  test: {
    coverage: {
      provider: 'istanbul',
      include: ['src/core/**/*.ts', 'src/worker/**/*.ts', 'src/app/lib/**/*.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts'],
      reporter: ['text', 'json-summary', 'html'],
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'core',
          environment: 'node',
          include: ['src/core/**/*.test.ts'],
        },
      },
      {
        // App logic outside components (storage, API calls, cache), on Node with fake-indexeddb.
        extends: true,
        test: {
          name: 'app',
          environment: 'node',
          include: ['src/app/**/*.test.ts'],
        },
      },
      {
        extends: true,
        plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
        test: {
          name: 'worker',
          include: ['src/worker/**/*.test.ts'],
        },
      },
    ],
  },
});

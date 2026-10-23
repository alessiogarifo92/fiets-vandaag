import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
import { appVersion } from './vite.config.ts';

// Applied to the local D1 before every worker test file (src/worker/test-setup.ts).
const migrations = await readD1Migrations('./migrations');

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion()),
  },
  test: {
    coverage: {
      provider: 'istanbul',
      include: ['src/core/**/*.ts', 'src/worker/**/*.ts', 'src/app/lib/**/*.ts', 'src/app/sw-core.ts'],
      exclude: ['**/*.test.ts', '**/*.d.ts', 'src/worker/test-*.ts', 'src/app/lib/test-api.ts'],
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
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' },
            miniflare: {
              bindings: { TEST_MIGRATIONS: migrations, INVITE_CODE: 'test-invite', MAX_DEVICES: '3' },
            },
          }),
        ],
        test: {
          name: 'worker',
          include: ['src/worker/**/*.test.ts'],
          setupFiles: ['src/worker/test-setup.ts'],
        },
      },
    ],
  },
});

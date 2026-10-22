// Worker tests: the local D1 gets the real migrations before each test file (vitest.config.ts).
import { applyD1Migrations, type D1Migration } from 'cloudflare:test';
import { env } from 'cloudflare:workers';

// A test-only binding, so it stays out of the production Env type.
const { TEST_MIGRATIONS } = env as unknown as { TEST_MIGRATIONS: D1Migration[] };

await applyD1Migrations(env.DB, TEST_MIGRATIONS);

import { drain } from './cron/drain';
import { withErrorBoundary } from './http';
import { route } from './router';

export default {
  fetch(request, env, ctx): Promise<Response> {
    return withErrorBoundary(() =>
      route(request, {
        env,
        version: __APP_VERSION__,
        now: () => Date.now(),
        waitUntil: (p) => ctx.waitUntil(p),
      }),
    );
  },

  // The morning push drain, `* 2-11 * * *` UTC (wrangler.jsonc). Only the error type is logged.
  async scheduled(_controller, env): Promise<void> {
    try {
      await drain(env, { now: Date.now() });
    } catch (err) {
      console.error('drain failed', err instanceof Error ? err.name : typeof err);
    }
  },
} satisfies ExportedHandler<Env>;

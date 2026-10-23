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
} satisfies ExportedHandler<Env>;

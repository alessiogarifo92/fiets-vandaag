import { withErrorBoundary } from './http';
import { route } from './router';

export default {
  fetch(request, env): Promise<Response> {
    return withErrorBoundary(() => route(request, { env, version: __APP_VERSION__ }));
  },
} satisfies ExportedHandler<Env>;

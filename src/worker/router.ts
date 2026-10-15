import { handleHealth } from './api/health';
import { errorResponse } from './http';

export interface RouteContext {
  env: Env;
  version: string;
}

type Handler = (request: Request, ctx: RouteContext) => Response | Promise<Response>;

// method -> path -> handler. Later tickets add /api/devices, /api/routes/:slot, /api/opens.
const routes: Record<string, Record<string, Handler>> = {
  '/api/health': {
    GET: (_request, ctx) => handleHealth(ctx.version),
  },
};

export async function route(request: Request, ctx: RouteContext): Promise<Response> {
  const { pathname } = new URL(request.url);
  const methods = routes[pathname];
  if (!methods) return errorResponse(404, 'not_found', 'No such endpoint');

  const method = request.method === 'HEAD' ? 'GET' : request.method;
  const handler = methods[method];
  if (!handler) {
    return errorResponse(405, 'method_not_allowed', `${request.method} is not allowed here`, {
      allow: Object.keys(methods).join(', '),
    });
  }
  return handler(request, ctx);
}

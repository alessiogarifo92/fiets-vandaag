import { handleDeleteMe, handleGetMe, handlePatchMe, handleRegister } from './api/devices';
import { handleHealth } from './api/health';
import { handleOpen } from './api/opens';
import { handleDeleteRoute, handlePutRoute } from './api/routes';
import { errorResponse } from './http';

export interface RouteContext {
  env: Env;
  version: string;
  now: () => number;
  waitUntil: (promise: Promise<unknown>) => void;
}

type Handler = (request: Request, ctx: RouteContext, param: string) => Response | Promise<Response>;

// method -> handler, per path pattern. A `:name` segment matches one path segment and is passed as `param`.
const routes: [pattern: string, methods: Record<string, Handler>][] = [
  ['/api/health', { GET: (_request, ctx) => handleHealth(ctx.version) }],
  ['/api/devices', { POST: handleRegister }],
  ['/api/devices/me', { GET: handleGetMe, PATCH: handlePatchMe, DELETE: handleDeleteMe }],
  ['/api/routes/:slot', { PUT: handlePutRoute, DELETE: handleDeleteRoute }],
  ['/api/opens', { POST: handleOpen }],
];

export function matchPath(pattern: string, pathname: string): { param: string } | null {
  const want = pattern.split('/');
  const got = pathname.split('/');
  if (want.length !== got.length) return null;
  let param = '';
  for (let i = 0; i < want.length; i++) {
    if (want[i]!.startsWith(':')) {
      if (!got[i]) return null;
      try {
        param = decodeURIComponent(got[i]!);
      } catch {
        return null;
      }
    } else if (want[i] !== got[i]) return null;
  }
  return { param };
}

export async function route(request: Request, ctx: RouteContext): Promise<Response> {
  const { pathname } = new URL(request.url);
  for (const [pattern, methods] of routes) {
    const match = matchPath(pattern, pathname);
    if (!match) continue;
    const method = request.method === 'HEAD' && methods.GET ? 'GET' : request.method;
    const handler = methods[method];
    if (!handler) {
      return errorResponse(405, 'method_not_allowed', `${request.method} is not allowed here`, {
        allow: Object.keys(methods).join(', '),
      });
    }
    return handler(request, ctx, match.param);
  }
  return errorResponse(404, 'not_found', 'No such endpoint');
}

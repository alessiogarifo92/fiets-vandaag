import { apiError } from '../core/api';

const JSON_HEADERS = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...headers } });
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
): Response {
  return json(apiError(code, message), status, headers);
}

// Last line of defence: any throw becomes a JSON 500. Only the error type is logged,
// never IPs, endpoints or coordinates (docs/architecture.md §3).
export async function withErrorBoundary(run: () => Response | Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (err) {
    console.error('unhandled', err instanceof Error ? err.name : typeof err);
    return errorResponse(500, 'internal', 'Internal error');
  }
}

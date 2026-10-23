// Test double for the Worker API, for the app's unit tests.
import { vi } from 'vitest';
import type { FetchFn } from './device';

export const DEVICE = { deviceId: '123e4567-e89b-42d3-a456-426614174000', secret: 's'.repeat(43) };

export const ROUTE = {
  from: { label: 'Damrak 1', lat: 52.377, lon: 4.898 },
  to: { label: 'Zuid', lat: 52.339, lon: 4.872 },
  window: { start: 480, end: 540 },
};

interface Call {
  method: string;
  path: string;
  body: unknown;
  auth: string | undefined;
}

/** Answers like the Worker: 201 + credential for POST /api/devices, 204 or 200 for the rest, unless overridden. */
export function fakeApi(overrides: Record<string, { status: number; body: unknown }> = {}) {
  const calls: Call[] = [];
  const fetch = vi.fn<FetchFn>(async (path, init = {}) => {
    const method = init.method ?? 'GET';
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({
      method,
      path,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      auth: headers.authorization,
    });
    const key = `${method} ${path}`;
    const answer =
      overrides[key] ??
      (key === 'POST /api/devices'
        ? { status: 201, body: DEVICE }
        : key === 'PUT /api/routes/1'
          ? { status: 200, body: {} }
          : { status: 204, body: null });
    return new Response(answer.status === 204 ? null : JSON.stringify(answer.body), {
      status: answer.status,
    });
  });
  return { fetch, calls };
}

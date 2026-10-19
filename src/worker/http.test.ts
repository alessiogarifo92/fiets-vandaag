import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorResponse, withErrorBoundary } from './http';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('errorResponse', () => {
  it('uses the shared error shape and extra headers', async () => {
    const res = errorResponse(405, 'method_not_allowed', 'nope', { allow: 'GET' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET');
    expect(await res.json()).toEqual({ error: { code: 'method_not_allowed', message: 'nope' } });
  });
});

describe('withErrorBoundary', () => {
  it('passes a successful response through', async () => {
    const res = await withErrorBoundary(() => new Response('hi', { status: 201 }));
    expect(res.status).toBe(201);
    expect(await res.text()).toBe('hi');
  });

  it('turns a thrown error into a JSON 500 and logs only its type', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await withErrorBoundary(async () => {
      throw new TypeError('https://push.example/secret-endpoint 52.37,4.89');
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: { code: 'internal', message: 'Internal error' } });
    expect(log).toHaveBeenCalledWith('unhandled', 'TypeError');
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-endpoint');
  });

  it('handles a non-Error throw', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await withErrorBoundary(() => {
      throw 'boom';
    });
    expect(res.status).toBe(500);
    expect(log).toHaveBeenCalledWith('unhandled', 'string');
  });
});

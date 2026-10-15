import { describe, expect, it } from 'vitest';
import { isHealthResponse } from '../../core/api';
import { handleHealth } from './health';

describe('handleHealth', () => {
  it('returns 200 with ok and the given version', async () => {
    const res = handleHealth('1.2.3+abc1234');
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(body).toEqual({ ok: true, version: '1.2.3+abc1234' });
    expect(isHealthResponse(body)).toBe(true);
  });

  it('is JSON and never cached', () => {
    const res = handleHealth('x');
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

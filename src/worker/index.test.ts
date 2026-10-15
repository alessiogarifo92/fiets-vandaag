import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const base = 'https://fiets-vandaag.test';

describe('worker fetch', () => {
  it('GET /api/health answers ok with the build version', async () => {
    const res = await exports.default.fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    const body = await res.json<{ ok: boolean; version: string }>();
    expect(body.ok).toBe(true);
    expect(body.version).toBe(__APP_VERSION__);
    expect(body.version).toMatch(/^\d+\.\d+\.\d+\+\w+$/);
  });

  it('HEAD /api/health is accepted', async () => {
    const res = await exports.default.fetch(`${base}/api/health`, { method: 'HEAD' });
    expect(res.status).toBe(200);
  });

  it('unknown /api path is a JSON 404', async () => {
    const res = await exports.default.fetch(`${base}/api/nope`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'No such endpoint' } });
  });

  it('wrong method is a 405 with Allow', async () => {
    const res = await exports.default.fetch(`${base}/api/health`, { method: 'POST' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET');
    const body = await res.json<{ error: { code: string } }>();
    expect(body.error.code).toBe('method_not_allowed');
  });

  it('has the D1 binding available', () => {
    // Guards the wrangler.jsonc binding name that later tickets rely on.
    return import('cloudflare:workers').then(({ env }) => {
      expect(env.DB).toBeDefined();
    });
  });
});

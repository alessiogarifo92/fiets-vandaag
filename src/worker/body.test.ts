import { describe, expect, it } from 'vitest';
import { MAX_BODY_BYTES, readJson } from './body';

const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request('https://x', { method: 'POST', body, headers });

describe('readJson', () => {
  it('parses a body at exactly the limit', async () => {
    const json = JSON.stringify({ a: 'x'.repeat(MAX_BODY_BYTES - 8) });
    expect(new TextEncoder().encode(json).byteLength).toBe(MAX_BODY_BYTES);
    const res = await readJson(post(json));
    expect(res.ok).toBe(true);
  });

  it('refuses one byte over the limit', async () => {
    const json = JSON.stringify({ a: 'x'.repeat(MAX_BODY_BYTES - 7) });
    const res = await readJson(post(json));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(413);
  });

  it('counts bytes, not characters', async () => {
    const json = JSON.stringify({ a: '€'.repeat(700) }); // 3 bytes each
    const res = await readJson(post(json));
    expect(res.ok).toBe(false);
  });

  it('refuses a declared Content-Length over the limit before reading', async () => {
    const res = await readJson(post('{}', { 'content-length': '999999' }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.response.status).toBe(413);
  });

  it('answers invalid_json for an empty or broken body', async () => {
    for (const body of [null, '', '{"a":']) {
      const res = await readJson(post(body));
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.response.status).toBe(400);
        expect(await res.response.json()).toMatchObject({ error: { code: 'invalid_json' } });
      }
    }
  });
});

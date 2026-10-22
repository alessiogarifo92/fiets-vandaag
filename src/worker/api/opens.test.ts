import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { nextDate, previousDate } from '../../core/time';
import { callJson, clearDb, count, directCtx, register } from '../test-helpers';
import { handleOpen } from './opens';

beforeEach(clearDb);

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Amsterdam' }).format(new Date());

describe('POST /api/opens', () => {
  it('records one open per device, day and source', async () => {
    const dev = await register();
    for (let i = 0; i < 2; i++) {
      const res = await callJson('/api/opens', 'POST', { date: today(), source: 'app' }, dev.token);
      expect(res.status).toBe(204);
    }
    await callJson('/api/opens', 'POST', { date: today(), source: 'notification' }, dev.token);
    const { results } = await env.DB.prepare('SELECT local_date, source FROM opens ORDER BY source').all();
    expect(results).toEqual([
      { local_date: today(), source: 'app' },
      { local_date: today(), source: 'notification' },
    ]);
  });

  it('accepts yesterday and tomorrow for clock skew, nothing further', async () => {
    const dev = await register();
    const t = today();
    for (const date of [previousDate(t), nextDate(t)])
      expect((await callJson('/api/opens', 'POST', { date, source: 'app' }, dev.token)).status).toBe(204);
    for (const date of [previousDate(previousDate(t)), '2026-13-01', 'today'])
      expect((await callJson('/api/opens', 'POST', { date, source: 'app' }, dev.token)).status).toBe(400);
  });

  it('uses the Amsterdam date, not UTC', async () => {
    const dev = await register();
    // 23:30 UTC on 2026-10-22 is already 01:30 on the 23rd in Amsterdam (CEST).
    const { ctx } = directCtx({}, Date.UTC(2026, 9, 22, 23, 30));
    const req = new Request('https://x/api/opens', {
      method: 'POST',
      headers: { authorization: `Bearer ${dev.token}` },
      body: JSON.stringify({ date: '2026-10-24', source: 'app' }),
    });
    expect((await handleOpen(req, ctx)).status).toBe(204);
  });

  it('rejects an unknown source and needs a credential', async () => {
    const dev = await register();
    expect(
      (await callJson('/api/opens', 'POST', { date: today(), source: 'widget' }, dev.token)).status,
    ).toBe(400);
    expect((await callJson('/api/opens', 'POST', { date: today(), source: 'app' })).status).toBe(401);
    expect(await count('opens')).toBe(0);
  });
});

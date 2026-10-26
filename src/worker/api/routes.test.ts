import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { call, callJson, clearDb, count, register, validRoute } from '../test-helpers';

beforeEach(clearDb);

const fieldsOf = async (res: Response) => (await res.json<{ error: { fields?: object } }>()).error.fields;

describe('PUT /api/routes/:slot', () => {
  it('stores the cell, bearing, window, weekday mask and notify time, unscheduled', async () => {
    const dev = await register();
    const res = await callJson('/api/routes/1', 'PUT', validRoute, dev.token);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ slot: 1, ...validRoute });
    const row = await env.DB.prepare('SELECT * FROM routes WHERE device_id = ?').bind(dev.deviceId).first();
    expect(row).toMatchObject({
      slot: 1,
      cell: '52.37,4.89',
      bearing_deg: 87.4,
      window_start_min: 480,
      window_end_min: 540,
      weekdays: 0b0011111,
      notify_min: 435,
      next_run_at: null,
      lease_until: null,
    });
  });

  it('never stores start or end points sent alongside', async () => {
    const dev = await register();
    const body = { ...validRoute, from: { lat: 52.3731, lon: 4.8922 }, to: { lat: 52.3, lon: 4.95 } };
    expect((await callJson('/api/routes/1', 'PUT', body, dev.token)).status).toBe(200);
    const row = await env.DB.prepare('SELECT * FROM routes').first();
    expect(JSON.stringify(row)).not.toMatch(/52\.3731|4\.8922|4\.95/);
  });

  it('updates in place and clears the schedule and lease', async () => {
    const dev = await register();
    await callJson('/api/routes/1', 'PUT', validRoute, dev.token);
    await env.DB.prepare('UPDATE routes SET next_run_at = 1, lease_until = 2').run();
    const res = await callJson(
      '/api/routes/1',
      'PUT',
      { ...validRoute, notifyAt: null, weekdays: [6, 7] },
      dev.token,
    );
    expect(res.status).toBe(200);
    expect(await count('routes')).toBe(1);
    const row = await env.DB.prepare(
      'SELECT notify_min, weekdays, next_run_at, lease_until FROM routes',
    ).first();
    expect(row).toEqual({ notify_min: null, weekdays: 0b1100000, next_run_at: null, lease_until: null });
  });

  it('writes nothing for an identical PUT, so the schedule survives', async () => {
    const dev = await register();
    await callJson('/api/routes/1', 'PUT', validRoute, dev.token);
    await env.DB.prepare('UPDATE routes SET next_run_at = 123').run();
    const res = await callJson('/api/routes/1', 'PUT', validRoute, dev.token);
    expect(res.status).toBe(200);
    const row = await env.DB.prepare('SELECT next_run_at FROM routes').first();
    expect(row).toEqual({ next_run_at: 123 });
  });

  it('stores the ride time, NULL from an older app, and a new ride time clears the schedule', async () => {
    const dev = await register();
    const { rideMin: _omitted, ...old } = validRoute;
    await callJson('/api/routes/1', 'PUT', old, dev.token);
    const rideMin = () => env.DB.prepare('SELECT ride_min, next_run_at FROM routes').first();
    expect(await rideMin()).toEqual({ ride_min: null, next_run_at: null });
    await env.DB.prepare('UPDATE routes SET next_run_at = 123').run();
    await callJson('/api/routes/1', 'PUT', validRoute, dev.token);
    expect(await rideMin()).toEqual({ ride_min: 25, next_run_at: null });
  });

  it('keeps slots 1 and 2 apart', async () => {
    const dev = await register();
    await callJson('/api/routes/1', 'PUT', validRoute, dev.token);
    await callJson('/api/routes/2', 'PUT', { ...validRoute, bearing: 267.4 }, dev.token);
    expect(await count('routes', 'device_id = ?', dev.deviceId)).toBe(2);
  });

  it.each(['3', '0', 'abc', '%E0%A4%A'])('answers 404 for slot %s', async (slot) => {
    const dev = await register();
    const res = await callJson(`/api/routes/${slot}`, 'PUT', validRoute, dev.token);
    expect(res.status).toBe(404);
  });

  it.each([
    ['a cell off the grid', { cell: '52.3731,4.8922' }, 'cell'],
    ['a cell that is not a string', { cell: [52.37, 4.89] }, 'cell'],
    ['bearing 360', { bearing: 360 }, 'bearing'],
    ['a negative bearing', { bearing: -1 }, 'bearing'],
    ['a window over 180 minutes', { window: { start: 360, end: 545 } }, 'window.end'],
    ['no weekdays', { weekdays: [] }, 'weekdays'],
    ['weekday 8', { weekdays: [1, 8] }, 'weekdays'],
    ['a repeated weekday', { weekdays: [1, 1] }, 'weekdays'],
    ['a notify time after 12:00', { notifyAt: 725 }, 'notifyAt'],
    ['a notify time off the 5-minute grid', { notifyAt: 433 }, 'notifyAt'],
  ])('rejects %s', async (_label, patch, field) => {
    const dev = await register();
    const res = await callJson('/api/routes/1', 'PUT', { ...validRoute, ...patch }, dev.token);
    expect(res.status).toBe(400);
    expect(await fieldsOf(res)).toHaveProperty([field]);
    expect(await count('routes')).toBe(0);
  });

  it('needs a credential', async () => {
    expect((await callJson('/api/routes/1', 'PUT', validRoute)).status).toBe(401);
  });

  it('refuses a body over 2 KB', async () => {
    const dev = await register();
    const res = await callJson('/api/routes/1', 'PUT', { ...validRoute, pad: 'x'.repeat(2100) }, dev.token);
    expect(res.status).toBe(413);
  });
});

describe('DELETE /api/routes/:slot', () => {
  it('removes the route and its deliveries, leaving the other slot', async () => {
    const dev = await register();
    await callJson('/api/routes/1', 'PUT', validRoute, dev.token);
    await callJson('/api/routes/2', 'PUT', validRoute, dev.token);
    await env.DB.prepare(
      "INSERT INTO deliveries (route_id, local_date, status) SELECT id, '2026-10-22', 'sent' FROM routes",
    ).run();
    const res = await call('/api/routes/1', { method: 'DELETE', token: dev.token });
    expect(res.status).toBe(204);
    expect(await count('routes')).toBe(1);
    expect(await count('routes', 'slot = 2')).toBe(1);
    expect(await count('deliveries')).toBe(1);
  });

  it('is idempotent', async () => {
    const dev = await register();
    expect((await call('/api/routes/2', { method: 'DELETE', token: dev.token })).status).toBe(204);
  });

  it('only touches the caller’s routes', async () => {
    const a = await register();
    const b = await register();
    await callJson('/api/routes/1', 'PUT', validRoute, a.token);
    await call('/api/routes/1', { method: 'DELETE', token: b.token });
    expect(await count('routes', 'device_id = ?', a.deviceId)).toBe(1);
  });

  it('needs a credential and a valid slot', async () => {
    const dev = await register();
    expect((await call('/api/routes/1', { method: 'DELETE' })).status).toBe(401);
    expect((await call('/api/routes/9', { method: 'DELETE', token: dev.token })).status).toBe(404);
  });
});

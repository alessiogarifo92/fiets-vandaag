// A device's saved routes, slot 1 or 2. Only the midpoint cell and the bearing arrive here: start and end
// points never leave the phone (docs/architecture.md §3).

import { ERROR_CODES } from '../../core/api';
import { parseSlot, validateServerRoute, weekdayMask } from '../../core/validate';
import { authenticate } from '../auth';
import { readJson } from '../body';
import { errorResponse, invalidBody, json } from '../http';
import type { RouteContext } from '../router';
import { unauthorized } from './devices';

function badSlot(): Response {
  return errorResponse(404, ERROR_CODES.notFound, 'Route slot must be 1 or 2');
}

export async function handlePutRoute(
  request: Request,
  ctx: RouteContext,
  slotParam: string,
): Promise<Response> {
  const slot = parseSlot(slotParam);
  if (!slot) return badSlot();
  const device = await authenticate(request, ctx.env.DB, ctx.now());
  if (!device) return unauthorized();
  const body = await readJson(request);
  if (!body.ok) return body.response;
  const checked = validateServerRoute(body.value);
  if (!checked.ok) return invalidBody(checked.fields);
  const r = checked.value;
  // Any change clears the schedule and the lease, so the cron (ticket 5) plans the route again from scratch.
  await ctx.env.DB.prepare(
    `INSERT INTO routes (device_id, slot, cell, bearing_deg, window_start_min, window_end_min, weekdays,
                         notify_min, next_run_at, lease_until, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)
     ON CONFLICT (device_id, slot) DO UPDATE SET
       cell = excluded.cell, bearing_deg = excluded.bearing_deg,
       window_start_min = excluded.window_start_min, window_end_min = excluded.window_end_min,
       weekdays = excluded.weekdays, notify_min = excluded.notify_min,
       next_run_at = NULL, lease_until = NULL, updated_at = excluded.updated_at
     -- An identical PUT writes nothing, so repeating it cannot burn the D1 daily write quota.
     WHERE routes.cell IS NOT excluded.cell OR routes.bearing_deg IS NOT excluded.bearing_deg
        OR routes.window_start_min IS NOT excluded.window_start_min
        OR routes.window_end_min IS NOT excluded.window_end_min
        OR routes.weekdays IS NOT excluded.weekdays OR routes.notify_min IS NOT excluded.notify_min`,
  )
    .bind(
      device.id,
      slot,
      r.cell,
      r.bearing,
      r.window.start,
      r.window.end,
      weekdayMask(r.weekdays),
      r.notifyAt,
      ctx.now(),
    )
    .run();
  return json({ slot, ...r });
}

export async function handleDeleteRoute(
  request: Request,
  ctx: RouteContext,
  slotParam: string,
): Promise<Response> {
  const slot = parseSlot(slotParam);
  if (!slot) return badSlot();
  const device = await authenticate(request, ctx.env.DB, ctx.now());
  if (!device) return unauthorized();
  await ctx.env.DB.batch([
    ctx.env.DB.prepare(
      'DELETE FROM deliveries WHERE route_id IN (SELECT id FROM routes WHERE device_id = ? AND slot = ?)',
    ).bind(device.id, slot),
    ctx.env.DB.prepare('DELETE FROM routes WHERE device_id = ? AND slot = ?').bind(device.id, slot),
  ]);
  return new Response(null, { status: 204 });
}

// The kill-criterion instrument (docs/decisions.md, phase 1): one row per device, local day and source.

import { localNow, nextDate, previousDate } from '../../core/time';
import { validateOpen } from '../../core/validate';
import { authenticate } from '../auth';
import { readJson } from '../body';
import { invalidBody } from '../http';
import type { RouteContext } from '../router';
import { unauthorized } from './devices';

export async function handleOpen(request: Request, ctx: RouteContext): Promise<Response> {
  const now = ctx.now();
  const device = await authenticate(request, ctx.env.DB, now);
  if (!device) return unauthorized();
  const body = await readJson(request);
  if (!body.ok) return body.response;
  // Today in Amsterdam, plus a day either side for a phone clock that is a little off around midnight.
  const today = localNow(new Date(now)).date;
  const checked = validateOpen(body.value, [previousDate(today), today, nextDate(today)]);
  if (!checked.ok) return invalidBody(checked.fields);
  await ctx.env.DB.prepare('INSERT OR IGNORE INTO opens (device_id, local_date, source) VALUES (?, ?, ?)')
    .bind(device.id, checked.value.date, checked.value.source)
    .run();
  return new Response(null, { status: 204 });
}

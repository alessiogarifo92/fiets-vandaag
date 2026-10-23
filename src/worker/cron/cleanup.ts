// Bounded retention deletes (docs/architecture.md §3 "Retention", §4 "Cleanup"). They run only in a minute
// with nothing due, at most once an hour, and delete at most CLEANUP_LIMIT rows per table, so a backlog is
// worked off over several hours instead of blowing one run's CPU or D1 budget.

import { previousDate } from '../../core/time';

export const CLEANUP_LIMIT = 50;
export const CLEANUP_EVERY_MS = 60 * 60_000;
/** The row in weather_cache whose `fetched_at` is the last cleanup time. */
export const META_CELL = '_meta';

const DAY_MS = 24 * 60 * 60_000;
export const DELIVERIES_DAYS = 14;
export const OPENS_DAYS = 30;
export const WEATHER_KEEP_MS = 2 * DAY_MS;
export const INACTIVE_DEVICE_MS = 60 * DAY_MS;

function daysBefore(date: string, days: number): string {
  let d = date;
  for (let i = 0; i < days; i++) d = previousDate(d);
  return d;
}

export function cleanupDue(lastCleanup: number | null, now: number): boolean {
  return lastCleanup === null || now - lastCleanup >= CLEANUP_EVERY_MS;
}

/**
 * One transaction. `today` is the Amsterdam date. A device counts as inactive when it has neither opened
 * the app (last_seen_at) nor received a push (last_push_ok_at) for 60 days; it goes with all its rows.
 */
export function cleanupStatements(db: D1Database, now: number, today: string): D1PreparedStatement[] {
  const inactive = `SELECT id FROM devices WHERE last_seen_at < ?1
      AND (last_push_ok_at IS NULL OR last_push_ok_at < ?1) ORDER BY id LIMIT ${CLEANUP_LIMIT}`;
  const deviceCutoff = now - INACTIVE_DEVICE_MS;
  return [
    db
      .prepare(
        `INSERT INTO weather_cache (cell, fetched_at, payload) VALUES (?, ?, '{}')
         ON CONFLICT (cell) DO UPDATE SET fetched_at = excluded.fetched_at`,
      )
      .bind(META_CELL, now),
    db
      .prepare(
        `DELETE FROM deliveries WHERE rowid IN
           (SELECT rowid FROM deliveries WHERE local_date < ? LIMIT ${CLEANUP_LIMIT})`,
      )
      .bind(daysBefore(today, DELIVERIES_DAYS)),
    db
      .prepare(
        `DELETE FROM opens WHERE rowid IN (SELECT rowid FROM opens WHERE local_date < ? LIMIT ${CLEANUP_LIMIT})`,
      )
      .bind(daysBefore(today, OPENS_DAYS)),
    db
      .prepare(
        `DELETE FROM weather_cache WHERE cell IN
           (SELECT cell FROM weather_cache WHERE fetched_at < ? AND cell != ? LIMIT ${CLEANUP_LIMIT})`,
      )
      .bind(now - WEATHER_KEEP_MS, META_CELL),
    // Children first, then the devices; each statement re-selects the same inactive devices.
    db
      .prepare(
        `DELETE FROM deliveries WHERE route_id IN
           (SELECT id FROM routes WHERE device_id IN (${inactive}))`,
      )
      .bind(deviceCutoff),
    db.prepare(`DELETE FROM routes WHERE device_id IN (${inactive})`).bind(deviceCutoff),
    db.prepare(`DELETE FROM opens WHERE device_id IN (${inactive})`).bind(deviceCutoff),
    db.prepare(`DELETE FROM devices WHERE id IN (${inactive})`).bind(deviceCutoff),
  ];
}

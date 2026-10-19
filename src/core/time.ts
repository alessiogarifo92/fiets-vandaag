// Local time in Europe/Amsterdam, the only timezone of v1 (docs/decisions.md, phase 3).

export const TIMEZONE = 'Europe/Amsterdam';

/** "07:50" from minutes of day. */
export function formatMinutes(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** Minutes of day from "07:50"; null when malformed. */
export function parseMinutes(value: string): number | null {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

const parts = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/** Local date (YYYY-MM-DD) and minute of day of an instant, in Amsterdam. */
export function localNow(now: Date): { date: string; minute: number } {
  const p = Object.fromEntries(parts.formatToParts(now).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute) };
}

/** The calendar day after `date` (YYYY-MM-DD). */
export function nextDate(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * The day the Today screen talks about: today until the commute window is over, then tomorrow.
 */
export function commuteDay(now: Date, windowEnd: number): { date: string; tomorrow: boolean } {
  const { date, minute } = localNow(now);
  return minute < windowEnd ? { date, tomorrow: false } : { date: nextDate(date), tomorrow: true };
}

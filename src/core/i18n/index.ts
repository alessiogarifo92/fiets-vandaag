// Localizes reason codes and recommendations. The app uses it now; the push payload will use the same
// functions, so a notification and the Today screen always say the same thing.

import type { HourPoint } from '../forecast';
import type { Recommendation, RideConditions } from '../score';
import { formatMinutes } from '../time';
import type { Lang } from '../validate';
import { windComponents } from '../wind';
import { en, type MessageKey, type Messages } from './en';
import { it } from './it';
import { nl } from './nl';

export type { MessageKey, Messages };
export const catalogs: Record<Lang, Messages> = { en, nl, it };

export type Params = Record<string, string | number>;

/** Looks up `key` and fills its {placeholders}. An unknown placeholder is left as written. */
export function t(lang: Lang, key: MessageKey, params: Params = {}): string {
  return catalogs[lang][key].replace(/\{(\w+)\}/g, (m, name: string) =>
    name in params ? String(params[name]) : m,
  );
}

/** Placeholder names in a message, sorted; used by the completeness test. */
export function placeholders(message: string): string[] {
  return [...message.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
}

/** Picks the browser's language when supported, else English. */
export function pickLang(preferred: readonly string[]): Lang {
  for (const tag of preferred) {
    const base = tag.toLowerCase().split('-')[0];
    if (base === 'nl' || base === 'it' || base === 'en') return base;
  }
  return 'en';
}

export type WindKind = 'head' | 'tail' | 'cross' | 'light';

/** Which way the wind mostly hits the rider. */
export function windKind(speed: number, head: number, cross: number): WindKind {
  if (speed < 10) return 'light';
  if (Math.abs(cross) > Math.abs(head)) return 'cross';
  return head >= 0 ? 'head' : 'tail';
}

const kmh = (v: number) => Math.round(Math.abs(v));
const pct = (v: number) => Math.round(v / 5) * 5;

function windLine(lang: Lang, c: RideConditions): string {
  const kind = windKind(c.speed, c.head, c.cross);
  const speed =
    kind === 'head' || kind === 'tail' ? kmh(c.head) : kind === 'cross' ? kmh(c.cross) : kmh(c.speed);
  const line = t(lang, `wind.${kind}`, { speed });
  return c.gust >= 50 ? `${line}, ${t(lang, 'wind.gusts', { gust: kmh(c.gust) })}` : line;
}

function rainLine(lang: Lang, c: RideConditions): string {
  const prob = pct(c.maxRainProb);
  if (c.rainMm >= 0.2) return t(lang, 'rain.amount', { prob, mm: c.rainMm.toFixed(1) });
  if (prob >= 20) return t(lang, 'rain.chance', { prob });
  return t(lang, 'rain.dry');
}

function sentenceKey(rec: Recommendation): MessageKey {
  const r = new Set(rec.reasons);
  if (rec.verdict === 'shift') return r.has('shift_rain') ? 'sentence.shift.rain' : 'sentence.shift.wind';
  if (rec.verdict === 'pt') {
    if (r.has('storm')) return 'sentence.pt.storm';
    const wet = r.has('rain_likely');
    const windy = r.has('headwind_strong') || r.has('crosswind') || r.has('gusts');
    if (wet && !windy) return 'sentence.pt.rain';
    if (windy && !wet) return 'sentence.pt.wind';
    return 'sentence.pt.mixed';
  }
  if (r.has('rain_possible') || r.has('rain_likely')) return 'sentence.bike.rain';
  if (r.has('headwind') || r.has('headwind_strong')) return 'sentence.bike.wind';
  if (r.has('tailwind')) return 'sentence.bike.tailwind';
  return 'sentence.bike';
}

export interface Described {
  pill: string;
  sentence: string;
  support: string;
}

/** The three lines of the Today screen (DESIGN.md): verdict pill, sentence, supporting line. */
export function describe(rec: Recommendation, lang: Lang): Described {
  const time = formatMinutes(rec.departMin);
  const gust = kmh(rec.conditions.gust);
  return {
    pill: t(lang, `pill.${rec.verdict}`, { time }),
    sentence: t(lang, sentenceKey(rec), { time, gust }),
    support: `${windLine(lang, rec.conditions)} · ${rainLine(lang, rec.conditions)}`,
  };
}

/** Short phrase for one row of "Hour by hour", e.g. "headwind, dry". */
export function hourPhrase(lang: Lang, hour: HourPoint, bearingDeg: number): string {
  const c = windComponents(hour.windSpeed, hour.windFrom, bearingDeg);
  const wind = t(lang, `hours.phrase.${windKind(hour.windSpeed, c.head, c.cross)}`);
  const rain =
    hour.precipProb >= 60 || hour.precipMm >= 1
      ? 'hours.phrase.showers'
      : hour.precipProb >= 30
        ? 'hours.phrase.chance'
        : 'hours.phrase.dry';
  return `${wind}, ${t(lang, rain)}`;
}

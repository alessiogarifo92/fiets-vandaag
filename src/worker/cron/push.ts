// The morning push of one route: its text, its headers and what the push service's answer means
// (docs/architecture.md §2 "Push responses", §4 step 5).

import { describe, t } from '../../core/i18n';
import type { Recommendation } from '../../core/score';
import type { Lang } from '../../core/validate';
import type { PushContent, PushOptions } from '../push';

/** T6 replaces this with a deep link to the pushed verdict. */
export const MORNING_URL = '/#/today';

/** The same three lines as the Today screen (DESIGN.md): the pill as title, sentence and support as body. */
export function morningContent(rec: Recommendation, lang: Lang): PushContent {
  const d = describe(rec, lang);
  return { title: d.pill, body: `${d.sentence}\n${d.support}`, url: MORNING_URL };
}

export function noDataContent(lang: Lang): PushContent {
  return { title: t(lang, 'push.nodata.title'), body: t(lang, 'push.nodata.body'), url: MORNING_URL };
}

export const MIN_TTL_S = 300;

/**
 * A push is useless once the commute has started: the push service may hold it until the window starts
 * (at least 5 minutes). `topic` replaces an undelivered older push of the same route.
 */
export function morningOptions(nowMs: number, windowStartMs: number, slot: number): PushOptions {
  const ttl = Math.max(MIN_TTL_S, Math.ceil((windowStartMs - nowMs) / 1000));
  return { ttl, urgency: 'high', topic: `route-${slot}` };
}

/**
 * - `sent`: 2xx.
 * - `gone`: 404/410, the subscription no longer exists; the device is deleted.
 * - `retry`: 429/5xx, tried once more inside the same run.
 * - `rejected`: any other answer; three in a row delete the device.
 */
export type PushOutcome = 'sent' | 'gone' | 'retry' | 'rejected';

export function classifyPush(status: number): PushOutcome {
  if (status >= 200 && status < 300) return 'sent';
  if (status === 404 || status === 410) return 'gone';
  if (status === 429 || status >= 500) return 'retry';
  return 'rejected';
}

/** Other 4xx answers in a row before a device is deleted. */
export const MAX_PUSH_FAILURES = 3;

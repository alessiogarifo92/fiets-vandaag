// The morning recommendation: a 1-10 "bike day" score, a verdict and reason codes (docs/architecture.md §1).
// Core returns codes only; the app and the push localize them from the same i18n catalog.

import type { HourPoint } from './forecast';
import { rainOver } from './rain';
import { windComponents } from './wind';

export type Verdict = 'bike' | 'pt' | 'shift';

export type ReasonCode =
  | 'storm'
  | 'rain_likely'
  | 'rain_possible'
  | 'dry'
  | 'headwind_strong'
  | 'headwind'
  | 'tailwind'
  | 'crosswind'
  | 'gusts'
  | 'calm'
  | 'shift_rain'
  | 'shift_wind';

export interface RideConditions {
  maxRainProb: number;
  /** Expected mm on the ride. */
  rainMm: number;
  /** Heaviest rain in the ride's hours, mm/h. */
  rainRate: number;
  /** Mean wind speed over the ride, km/h. */
  speed: number;
  /** Mean headwind (negative: tailwind), km/h. */
  head: number;
  /** Mean crosswind magnitude, km/h. */
  cross: number;
  gust: number;
}

export interface Departure {
  departMin: number;
  score: number;
  conditions: RideConditions;
}

export interface Recommendation {
  date: string;
  verdict: Verdict;
  score: number;
  /** Best departure, minutes of day. */
  departMin: number;
  rideMin: number;
  conditions: RideConditions;
  reasons: ReasonCode[];
  /** Every candidate departure in the window, in order. */
  departures: Departure[];
}

export const BIKE_MIN_SCORE = 6;
export const STORM_GUST_KMH = 75;
const DEPARTURE_STEP_MIN = 10;

/** Wind and rain for a ride over [start, end), from one day's hours. Null if the forecast does not cover it. */
export function rideConditions(
  hours: readonly HourPoint[],
  start: number,
  end: number,
  bearingDeg: number,
): RideConditions | null {
  const rain = rainOver(hours, start, end);
  // Wind is an instant value: use the hourly instants that bracket the ride.
  const from = Math.floor(start / 60) * 60;
  const to = Math.ceil(end / 60) * 60;
  const instants = hours.filter((h) => h.minute >= from && h.minute <= to);
  if (!rain || instants.length === 0) return null;
  let head = 0;
  let cross = 0;
  let speed = 0;
  let gust = 0;
  for (const h of instants) {
    const c = windComponents(h.windSpeed, h.windFrom, bearingDeg);
    head += c.head;
    cross += Math.abs(c.cross);
    speed += h.windSpeed;
    gust = Math.max(gust, h.gust);
  }
  const n = instants.length;
  const r1 = (v: number) => Math.round(v * 10) / 10;
  return {
    maxRainProb: rain.maxProb,
    rainMm: rain.mm,
    rainRate: rain.maxRate,
    speed: r1(speed / n),
    head: r1(head / n),
    cross: r1(cross / n),
    gust: r1(gust),
  };
}

// Intensity, not the ride's total: 2.5 mm/h is a soaking whether the ride takes 15 or 45 minutes.
function rainPenalty(c: RideConditions): number {
  return (c.maxRainProb / 100) * 3 + Math.min(c.rainRate, 4) * 1.5;
}

function windPenalty(c: RideConditions): number {
  return Math.max(0, c.head) / 6 + Math.max(0, c.cross - 20) / 8 + Math.max(0, c.gust - 45) / 5;
}

/** 1-10, higher is a better day to cycle. Never increases as the headwind grows. */
export function rideScore(c: RideConditions): number {
  if (c.gust >= STORM_GUST_KMH) return 1;
  const raw = 10 - rainPenalty(c) - windPenalty(c);
  return Math.min(10, Math.max(1, Math.round(raw)));
}

/** Reason codes for one ride, most important first. */
export function reasonsFor(c: RideConditions): ReasonCode[] {
  const out: ReasonCode[] = [];
  if (c.gust >= STORM_GUST_KMH) out.push('storm');
  if (c.maxRainProb >= 60 || c.rainRate >= 1) out.push('rain_likely');
  else if (c.maxRainProb >= 30 || c.rainRate >= 0.2) out.push('rain_possible');
  if (c.head >= 20) out.push('headwind_strong');
  else if (c.head >= 10) out.push('headwind');
  else if (c.head <= -10) out.push('tailwind');
  if (c.cross >= 20) out.push('crosswind');
  if (c.gust >= 50 && c.gust < STORM_GUST_KMH) out.push('gusts');
  if (c.speed < 10) out.push('calm');
  if (!out.some((r) => r === 'rain_likely' || r === 'rain_possible')) out.push('dry');
  return out;
}

export interface RecommendInput {
  hours: readonly HourPoint[];
  date: string;
  /** Commute window in minutes of day: the ride has to fit inside [start, end]. */
  window: { start: number; end: number };
  bearingDeg: number;
  rideMin: number;
}

/**
 * Scores every departure in the window (every 10 minutes) and picks the best one; ties go to the earliest.
 * - `bike`: leaving at the start of the window is already fine (the best time may still be later).
 * - `shift`: the start of the window is not fine, but a later departure inside it is.
 * - `pt`: no departure in the window reaches BIKE_MIN_SCORE.
 */
export function recommend(input: RecommendInput): Recommendation | null {
  const { window, rideMin, bearingDeg } = input;
  const hours = input.hours.filter((h) => h.date === input.date);
  const lastDepart = Math.max(window.start, window.end - rideMin);
  const departures: Departure[] = [];
  for (let d = window.start; d <= lastDepart; d += DEPARTURE_STEP_MIN) {
    const conditions = rideConditions(hours, d, d + rideMin, bearingDeg);
    if (conditions) departures.push({ departMin: d, score: rideScore(conditions), conditions });
  }
  const first = departures[0];
  if (!first) return null;
  const best = departures.reduce((a, b) => (b.score > a.score ? b : a));

  let verdict: Verdict;
  if (best.score < BIKE_MIN_SCORE) verdict = 'pt';
  else if (first.score >= BIKE_MIN_SCORE) verdict = 'bike';
  else verdict = 'shift';

  const chosen = best;
  const reasons = reasonsFor(chosen.conditions);
  if (verdict === 'shift') {
    if (rainPenalty(first.conditions) - rainPenalty(best.conditions) >= 1) reasons.unshift('shift_rain');
    else reasons.unshift('shift_wind');
  }
  return {
    date: input.date,
    verdict,
    score: chosen.score,
    departMin: chosen.departMin,
    rideMin,
    conditions: chosen.conditions,
    reasons,
    departures,
  };
}

/** Estimated ride time: straight-line km × 1.3 for the street grid at 16 km/h, in 5-minute steps (10-90). */
export function estimateRideMin(straightKm: number): number {
  const min = ((straightKm * 1.3) / 16) * 60;
  return Math.min(90, Math.max(10, Math.ceil(min / 5) * 5));
}

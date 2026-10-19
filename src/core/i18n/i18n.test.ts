import { describe, expect, it } from 'vitest';
import type { Recommendation } from '../score';
import { catalogs, describe as describeRec, hourPhrase, pickLang, placeholders, t, windKind } from './index';

const langs = Object.keys(catalogs) as (keyof typeof catalogs)[];
const keys = Object.keys(catalogs.en).sort();

describe('catalog completeness', () => {
  it.each(langs)('%s has exactly the English keys', (lang) => {
    expect(Object.keys(catalogs[lang]).sort()).toEqual(keys);
  });

  it.each(langs)('%s keeps every {placeholder} of each English message', (lang) => {
    for (const key of keys) {
      const k = key as keyof typeof catalogs.en;
      expect({ key, p: placeholders(catalogs[lang][k]) }).toEqual({ key, p: placeholders(catalogs.en[k]) });
    }
  });

  it.each(langs)('%s has no empty message', (lang) => {
    expect(Object.values(catalogs[lang]).filter((m) => m.trim() === '')).toEqual([]);
  });
});

describe('t', () => {
  it('fills placeholders', () => {
    expect(t('en', 'pill.bike', { time: '07:50' })).toBe('Bike · leave 07:50');
    expect(t('nl', 'pill.bike', { time: '07:50' })).toBe('Fiets · vertrek 07:50');
  });

  it('leaves an unknown placeholder visible rather than blank', () => {
    expect(t('en', 'pill.bike')).toBe('Bike · leave {time}');
  });
});

describe('pickLang', () => {
  it.each([
    [['nl-NL', 'en'], 'nl'],
    [['it-IT'], 'it'],
    [['de-DE', 'en-GB'], 'en'],
    [['fr'], 'en'],
    [[], 'en'],
  ])('%o → %s', (pref, lang) => expect(pickLang(pref)).toBe(lang));
});

describe('windKind', () => {
  it.each([
    [5, 5, 0, 'light'],
    [20, 18, 5, 'head'],
    [20, -18, 5, 'tail'],
    [20, 4, -18, 'cross'],
  ] as const)('speed %d head %d cross %d → %s', (s, h, c, kind) => expect(windKind(s, h, c)).toBe(kind));
});

const rec = (over: Partial<Recommendation>): Recommendation => ({
  date: '2026-10-20',
  verdict: 'bike',
  score: 9,
  departMin: 470,
  rideMin: 25,
  conditions: { maxRainProb: 5, rainMm: 0, rainRate: 0, speed: 14, head: -12, cross: 4, gust: 22 },
  reasons: ['tailwind', 'dry'],
  departures: [],
  ...over,
});

describe('describe', () => {
  it('writes the verdict as a sentence with the time inside it', () => {
    expect(describeRec(rec({}), 'en')).toEqual({
      pill: 'Bike · leave 07:50',
      sentence: 'Leave at 07:50 and the wind is at your back.',
      support: 'Tailwind 12 km/h · dry',
    });
  });

  it('explains a shift for rain in Italian', () => {
    const d = describeRec(rec({ verdict: 'shift', departMin: 500, reasons: ['shift_rain', 'dry'] }), 'it');
    expect(d.sentence).toBe('Parti invece alle 08:20 ed eviti la pioggia.');
  });

  it.each([
    [['rain_likely', 'calm'], 'sentence.pt.rain'],
    [['headwind_strong', 'dry'], 'sentence.pt.wind'],
    [['rain_likely', 'headwind_strong'], 'sentence.pt.mixed'],
    [['storm', 'dry'], 'sentence.pt.storm'],
  ] as const)('pt with %o uses %s', (reasons, key) => {
    const d = describeRec(
      rec({ verdict: 'pt', reasons: [...reasons], conditions: { ...rec({}).conditions, gust: 80 } }),
      'en',
    );
    expect(d.sentence).toBe(t('en', key, { gust: 80 }));
    expect(d.pill).toBe('Public transport');
  });

  it('mentions rain amount and gusts in the supporting line', () => {
    const d = describeRec(
      rec({
        conditions: { maxRainProb: 62, rainMm: 0.84, rainRate: 1.2, speed: 30, head: 24, cross: 5, gust: 56 },
        reasons: ['rain_possible'],
      }),
      'nl',
    );
    expect(d.support).toBe('Tegenwind 24 km/u, windstoten 56 km/u · 60% kans op regen, ongeveer 0.8 mm');
    expect(d.sentence).toBe('Vertrek om 07:50 en neem voor de zekerheid een regenjas mee.');
  });

  it('uses the plain sentences for headwind and calm bike days', () => {
    expect(describeRec(rec({ reasons: ['headwind', 'dry'] }), 'en').sentence).toBe(
      'Leave at 07:50; expect to push against the wind.',
    );
    expect(describeRec(rec({ reasons: ['calm', 'dry'] }), 'en').sentence).toBe(
      'Good cycling weather: leave at 07:50.',
    );
    expect(describeRec(rec({ verdict: 'shift', reasons: ['shift_wind'] }), 'en').sentence).toBe(
      'Leave at 07:50 instead, when the wind is easier.',
    );
  });

  it('describes a crosswind and a light wind', () => {
    const cross = rec({
      conditions: { maxRainProb: 25, rainMm: 0, rainRate: 0, speed: 20, head: 2, cross: 19, gust: 30 },
    });
    expect(describeRec(cross, 'en').support).toBe('Crosswind 19 km/h · 25% chance of rain');
    const light = rec({
      conditions: { maxRainProb: 0, rainMm: 0, rainRate: 0, speed: 6, head: 6, cross: 0, gust: 9 },
    });
    expect(describeRec(light, 'en').support).toBe('Light wind 6 km/h · dry');
  });
});

describe('hourPhrase', () => {
  const hour = {
    date: '2026-10-20',
    minute: 480,
    precipProb: 70,
    precipMm: 1.2,
    windSpeed: 20,
    windFrom: 0,
    gust: 30,
  };
  it('combines wind relative to the route with rain', () => {
    expect(hourPhrase('en', hour, 0)).toBe('headwind, showers');
    expect(hourPhrase('en', { ...hour, precipProb: 40, precipMm: 0 }, 180)).toBe('tailwind, chance of rain');
    expect(hourPhrase('it', { ...hour, precipProb: 0, precipMm: 0 }, 90)).toBe('vento laterale, asciutto');
  });
});

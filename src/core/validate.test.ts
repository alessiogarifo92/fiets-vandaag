import { describe, expect, it } from 'vitest';
import { isLang, validateLatLon, validateLocalRoute, validateNotifyMin, validateWindow } from './validate';

describe('isLang', () => {
  it.each(['en', 'nl', 'it'])('accepts %s', (l) => expect(isLang(l)).toBe(true));
  it.each(['de', 'EN', '', 1, null])('rejects %o', (l) => expect(isLang(l)).toBe(false));
});

describe('validateLatLon', () => {
  it('accepts a point', () => {
    expect(validateLatLon({ lat: 52.3, lon: 4.9 })).toEqual({ ok: true, value: { lat: 52.3, lon: 4.9 } });
  });

  it.each([
    [null],
    [{ lat: 91, lon: 0 }],
    [{ lat: 0, lon: -181 }],
    [{ lat: Number.NaN, lon: 0 }],
    [{ lat: '52', lon: 4 }],
  ])('rejects %o', (v) => {
    expect(validateLatLon(v).ok).toBe(false);
  });
});

describe('validateWindow', () => {
  it('accepts 07:30-09:00', () => {
    expect(validateWindow({ start: 450, end: 540 })).toEqual({ ok: true, value: { start: 450, end: 540 } });
  });

  it('accepts exactly 180 minutes and rejects 185', () => {
    expect(validateWindow({ start: 360, end: 540 }).ok).toBe(true);
    expect(validateWindow({ start: 360, end: 545 })).toEqual({
      ok: false,
      fields: { 'window.end': 'must be at most 180 minutes after the start' },
    });
  });

  it.each([
    ['end before start', { start: 540, end: 450 }],
    ['equal', { start: 450, end: 450 }],
    ['not a 5-minute step', { start: 451, end: 540 }],
    ['past 23:00', { start: 1320, end: 1385 }],
    ['negative', { start: -5, end: 30 }],
    ['not an object', 'morning'],
  ])('rejects %s', (_label, v) => {
    expect(validateWindow(v).ok).toBe(false);
  });
});

describe('validateNotifyMin', () => {
  it.each([null, 240, 420, 720])('accepts %o', (v) => expect(validateNotifyMin(v).ok).toBe(true));
  it.each([235, 725, 421, '07:00', undefined])('rejects %o', (v) =>
    expect(validateNotifyMin(v).ok).toBe(false),
  );
});

describe('validateLocalRoute', () => {
  const from = { label: 'Damrak 1, Amsterdam', lat: 52.3771, lon: 4.898 };
  const to = { label: 'Zuidas, Amsterdam', lat: 52.3389, lon: 4.8721 };
  const window = { start: 450, end: 540 };

  it('accepts a normal commute', () => {
    expect(validateLocalRoute({ from, to, window })).toEqual({ ok: true, value: { from, to, window } });
  });

  it('rejects start and end on the same spot', () => {
    expect(validateLocalRoute({ from, to: { ...from, label: 'x' }, window })).toEqual({
      ok: false,
      fields: { to: 'is too close to the start' },
    });
  });

  it('rejects a commute over 60 km', () => {
    const far = { label: 'Maastricht', lat: 50.85, lon: 5.69 };
    expect(validateLocalRoute({ from, to: far, window }).ok).toBe(false);
  });

  it.each([
    ['no label', { from: { lat: 52, lon: 5 }, to, window }],
    ['empty label', { from: { ...from, label: ' ' }, to, window }],
    ['bad window', { from, to, window: { start: 500, end: 400 } }],
    ['bad destination', { from, to: null, window }],
    ['not an object', null],
  ])('rejects %s', (_label, v) => {
    expect(validateLocalRoute(v).ok).toBe(false);
  });
});

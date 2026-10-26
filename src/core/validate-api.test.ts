import { describe, expect, it } from 'vitest';
import {
  isAllowedPushHost,
  parseSlot,
  validateBearing,
  validateCell,
  validateDevicePatch,
  validateOpen,
  validatePush,
  validateRegistration,
  validateServerRoute,
  validateWeekdays,
  weekdayMask,
  weekdaysFromMask,
} from './validate';

const P256 = 'B' + 'A'.repeat(86);
const AUTH = 'a'.repeat(22);
const push = (endpoint = 'https://fcm.googleapis.com/fcm/send/abc') => ({
  endpoint,
  keys: { p256dh: P256, auth: AUTH },
});
const fieldOf = (r: { ok: boolean; fields?: Record<string, string> }) => Object.keys(r.fields ?? {})[0];

describe('isAllowedPushHost', () => {
  it.each([
    'fcm.googleapis.com',
    'FCM.googleapis.com',
    'updates.push.services.mozilla.com',
    'web.push.apple.com',
    'wns2-db5p.notify.windows.com',
  ])('allows %s', (h) => expect(isAllowedPushHost(h)).toBe(true));

  it.each([
    'push.services.mozilla.com.evil.example',
    '.push.services.mozilla.com',
    'evilpush.services.mozilla.com',
    'notify.windows.com',
    'apple.com',
    'fcm.googleapis.com.evil.example',
    'xfcm.googleapis.com',
    'localhost',
  ])('refuses %s', (h) => expect(isAllowedPushHost(h)).toBe(false));
});

describe('validatePush', () => {
  it('accepts a subscription, with or without base64 padding', () => {
    expect(validatePush(push()).ok).toBe(true);
    expect(validatePush({ ...push(), keys: { p256dh: `${P256}=`, auth: `${AUTH}==` } }).ok).toBe(true);
  });

  it.each([
    ['not an object', null, 'push'],
    ['no endpoint', { keys: push().keys }, 'push.endpoint'],
    ['an over-long endpoint', push(`https://fcm.googleapis.com/${'x'.repeat(1100)}`), 'push.endpoint'],
    ['a bad URL', push('::'), 'push.endpoint'],
    ['http', push('http://fcm.googleapis.com/x'), 'push.endpoint'],
    ['a port', push('https://fcm.googleapis.com:444/x'), 'push.endpoint'],
    ['credentials', push('https://a:b@fcm.googleapis.com/x'), 'push.endpoint'],
    ['another host', push('https://example.com/x'), 'push.endpoint'],
    ['no keys', { endpoint: push().endpoint }, 'push.keys'],
    ['a short p256dh', { ...push(), keys: { p256dh: 'BAAA', auth: AUTH } }, 'push.keys.p256dh'],
    [
      'a compressed-looking p256dh',
      { ...push(), keys: { p256dh: 'A' + 'A'.repeat(86), auth: AUTH } },
      'push.keys.p256dh',
    ],
    ['a bad auth', { ...push(), keys: { p256dh: P256, auth: 'a+b/' } }, 'push.keys.auth'],
  ])('rejects %s', (_label, value, field) => {
    const r = validatePush(value);
    expect(r.ok).toBe(false);
    expect(fieldOf(r as never)).toBe(field);
  });
});

describe('validateRegistration', () => {
  it('accepts invite, lang and push', () => {
    expect(validateRegistration({ invite: 'abc', lang: 'nl', push: push() })).toEqual({
      ok: true,
      value: { invite: 'abc', lang: 'nl', push: push() },
    });
  });

  it.each([
    ['not an object', 'x', 'body'],
    ['an empty invite', { invite: '', lang: 'en', push: push() }, 'invite'],
    ['an over-long invite', { invite: 'x'.repeat(129), lang: 'en', push: push() }, 'invite'],
    ['an unknown language', { invite: 'a', lang: 'de', push: push() }, 'lang'],
    ['a bad push', { invite: 'a', lang: 'en', push: push('https://evil.example') }, 'push.endpoint'],
  ])('rejects %s', (_label, value, field) => {
    expect(fieldOf(validateRegistration(value) as never)).toBe(field);
  });
});

describe('validateDevicePatch', () => {
  it('accepts lang, push or both', () => {
    expect(validateDevicePatch({ lang: 'it' })).toEqual({ ok: true, value: { lang: 'it' } });
    expect(validateDevicePatch({ push: push() })).toEqual({ ok: true, value: { push: push() } });
    expect(validateDevicePatch({ lang: 'en', push: push() }).ok).toBe(true);
  });

  it('rejects nothing to change, a bad lang and a bad push', () => {
    expect(fieldOf(validateDevicePatch({}) as never)).toBe('body');
    expect(fieldOf(validateDevicePatch(null) as never)).toBe('body');
    expect(fieldOf(validateDevicePatch({ lang: 'fr' }) as never)).toBe('lang');
    expect(fieldOf(validateDevicePatch({ push: {} }) as never)).toBe('push.endpoint');
  });
});

describe('validateCell', () => {
  it.each(['52.37,4.89', '52,4.89', '-33.87,151.2', '0,0'])('accepts the cell id %s', (c) =>
    expect(validateCell(c)).toEqual({ ok: true, value: c }),
  );
  it.each(['52.3731,4.8922', '52.37,4.9', '52.37, 4.89', '52.370,4.890', '91,0', '0,181', 52.37, ''])(
    'rejects %o',
    (c) => expect(validateCell(c).ok).toBe(false),
  );
});

describe('validateBearing', () => {
  it('rounds to a tenth of a degree, and 359.96 wraps to 0', () => {
    expect(validateBearing(87.44)).toEqual({ ok: true, value: 87.4 });
    expect(validateBearing(0)).toEqual({ ok: true, value: 0 });
    expect(validateBearing(359.96)).toEqual({ ok: true, value: 0 });
  });
  it.each([360, -0.1, Number.NaN, Infinity, '90', null])('rejects %o', (b) =>
    expect(validateBearing(b).ok).toBe(false),
  );
});

describe('weekdays', () => {
  it('sorts distinct weekdays and round-trips through the mask', () => {
    expect(validateWeekdays([5, 1, 3])).toEqual({ ok: true, value: [1, 3, 5] });
    expect(weekdayMask([1, 2, 3, 4, 5])).toBe(31);
    expect(weekdayMask([7])).toBe(64);
    expect(weekdaysFromMask(127)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(weekdaysFromMask(weekdayMask([2, 6]))).toEqual([2, 6]);
  });
  it.each([[[]], [[0]], [[8]], [[1, 1]], [[1.5]], ['1,2'], [[1, 2, 3, 4, 5, 6, 7, 1]]])('rejects %o', (d) =>
    expect(validateWeekdays(d).ok).toBe(false),
  );
});

describe('validateServerRoute', () => {
  const route = {
    cell: '52.37,4.89',
    bearing: 87.4,
    window: { start: 480, end: 540 },
    weekdays: [1],
    notifyAt: null,
    rideMin: 25,
  };
  it('keeps only the server fields', () => {
    expect(validateServerRoute({ ...route, from: { lat: 1, lon: 2 } })).toEqual({ ok: true, value: route });
  });
  it('accepts a route without rideMin from an older app', () => {
    const { rideMin: _omitted, ...old } = route;
    expect(validateServerRoute(old)).toEqual({ ok: true, value: { ...route, rideMin: null } });
  });
  it.each([0, 61, 12.5, '25'])('rejects rideMin %o', (rideMin) => {
    expect(fieldOf(validateServerRoute({ ...route, rideMin }) as never)).toBe('rideMin');
  });
  it('accepts a ride as long as the window', () => {
    expect(validateServerRoute({ ...route, rideMin: 60 }).ok).toBe(true);
  });
  it('reports the first failing field', () => {
    expect(fieldOf(validateServerRoute(null) as never)).toBe('body');
    expect(fieldOf(validateServerRoute({ ...route, cell: 'x' }) as never)).toBe('cell');
    expect(fieldOf(validateServerRoute({ ...route, bearing: 400 }) as never)).toBe('bearing');
    expect(fieldOf(validateServerRoute({ ...route, window: {} }) as never)).toBe('window.start');
    expect(fieldOf(validateServerRoute({ ...route, weekdays: [] }) as never)).toBe('weekdays');
    expect(fieldOf(validateServerRoute({ ...route, notifyAt: 60 }) as never)).toBe('notifyAt');
  });
});

describe('parseSlot', () => {
  it.each([
    ['1', 1],
    ['2', 2],
    ['3', null],
    ['01', null],
    ['', null],
  ])('%s → %o', (v, expected) => expect(parseSlot(v)).toBe(expected));
});

describe('validateOpen', () => {
  const allowed = ['2026-10-21', '2026-10-22', '2026-10-23'];
  it('accepts an allowed date and source', () => {
    expect(validateOpen({ date: '2026-10-22', source: 'notification' }, allowed)).toEqual({
      ok: true,
      value: { date: '2026-10-22', source: 'notification' },
    });
  });
  it('rejects other dates and sources', () => {
    expect(fieldOf(validateOpen({ date: '2026-10-20', source: 'app' }, allowed) as never)).toBe('date');
    expect(fieldOf(validateOpen({ date: '2026-10-22', source: 'cron' }, allowed) as never)).toBe('source');
    expect(fieldOf(validateOpen([], allowed) as never)).toBe('date');
    expect(fieldOf(validateOpen(null, allowed) as never)).toBe('body');
  });
});

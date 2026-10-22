import { describe, expect, it } from 'vitest';
import { parseHash } from './routes';

describe('parseHash', () => {
  it.each([
    ['#/today', 'today'],
    ['#/setup', 'setup'],
    ['#hours', 'hours'],
    ['#/privacy', 'privacy'],
    ['#/install', 'install'],
    ['', null],
    ['#/nope', null],
  ])('%s → %s', (hash, route) => expect(parseHash(hash)).toBe(route));
});

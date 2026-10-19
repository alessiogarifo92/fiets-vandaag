import { describe, expect, it } from 'vitest';
import { queryString } from './query';

describe('queryString', () => {
  it('encodes keys and values', () => {
    expect(queryString({ q: 'Damrak 1, Amsterdam', fq: 'type:(adres OR weg)' })).toBe(
      'q=Damrak%201%2C%20Amsterdam&fq=type%3A(adres%20OR%20weg)',
    );
  });

  it('is empty for no params', () => {
    expect(queryString({})).toBe('');
  });
});

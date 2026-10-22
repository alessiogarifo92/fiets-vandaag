import { describe, expect, it } from 'vitest';
import { lookupUrl, parseLookup, parseSuggest, suggestUrl } from './pdok';

describe('PDOK urls', () => {
  it('sends the typed text and limits types', () => {
    const url = new URL(suggestUrl('Damrak 1'));
    expect(url.pathname).toBe('/bzk/locatieserver/search/v3_1/suggest');
    expect(url.searchParams.get('q')).toBe('Damrak 1');
    expect(url.searchParams.get('fq')).toContain('adres');
  });

  it('looks up one id with only the fields we use', () => {
    const url = new URL(lookupUrl('adr-1'));
    expect(url.searchParams.get('id')).toBe('adr-1');
    expect(url.searchParams.get('fl')).toBe('id,weergavenaam,centroide_ll');
  });
});

describe('parseSuggest', () => {
  it('keeps id and label of well-formed docs', () => {
    const body = {
      response: {
        docs: [
          { id: 'adr-1', weergavenaam: 'Damrak 1, 1012LG Amsterdam', type: 'adres' },
          { id: 42, weergavenaam: 'bad id' },
          null,
        ],
      },
    };
    expect(parseSuggest(body)).toEqual([{ id: 'adr-1', label: 'Damrak 1, 1012LG Amsterdam' }]);
  });

  it.each([null, {}, { response: {} }])('rejects %o', (body) => {
    expect(parseSuggest(body)).toBeNull();
  });
});

describe('parseLookup', () => {
  it('reads the WKT point longitude first', () => {
    const body = {
      response: {
        docs: [
          {
            id: 'adr-1',
            weergavenaam: 'Damrak 1, 1012LG Amsterdam',
            centroide_ll: 'POINT(4.89803846 52.37714446)',
          },
        ],
      },
    };
    expect(parseLookup(body)).toEqual({
      label: 'Damrak 1, 1012LG Amsterdam',
      lat: 52.37714446,
      lon: 4.89803846,
    });
  });

  it.each([
    ['no docs', { response: { docs: [] } }],
    ['bad point', { response: { docs: [{ weergavenaam: 'x', centroide_ll: 'POINT(abc)' }] } }],
    ['no label', { response: { docs: [{ centroide_ll: 'POINT(4 52)' }] } }],
  ])('rejects %s', (_label, body) => {
    expect(parseLookup(body)).toBeNull();
  });
});

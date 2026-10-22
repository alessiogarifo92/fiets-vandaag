// PDOK Locatieserver: address autocomplete (`suggest`) and coordinates of the picked result (`lookup`).
// PDOK receives the typed text only. CORS was checked on 2026-10-19 (`Access-Control-Allow-Origin: *`).

import { queryString } from './query';
import type { Place } from './validate';

export const PDOK_URL = 'https://api.pdok.nl/bzk/locatieserver/search/v3_1';

export interface Suggestion {
  id: string;
  label: string;
}

export function suggestUrl(query: string, rows = 6): string {
  const params = queryString({
    q: query,
    rows: String(rows),
    // Addresses, streets, postcodes and places: no parcels or municipalities as a commute end.
    fq: 'type:(adres OR weg OR postcode OR woonplaats)',
  });
  return `${PDOK_URL}/suggest?${params}`;
}

export function lookupUrl(id: string): string {
  const params = queryString({ id, fl: 'id,weergavenaam,centroide_ll' });
  return `${PDOK_URL}/lookup?${params}`;
}

function docs(body: unknown): Record<string, unknown>[] | null {
  if (typeof body !== 'object' || body === null) return null;
  const response = (body as Record<string, unknown>).response;
  if (typeof response !== 'object' || response === null) return null;
  const list = (response as Record<string, unknown>).docs;
  return Array.isArray(list)
    ? list.filter((d): d is Record<string, unknown> => typeof d === 'object' && d !== null)
    : null;
}

export function parseSuggest(body: unknown): Suggestion[] | null {
  const list = docs(body);
  if (!list) return null;
  return list.flatMap((d) =>
    typeof d.id === 'string' && typeof d.weergavenaam === 'string'
      ? [{ id: d.id, label: d.weergavenaam }]
      : [],
  );
}

const POINT_RE = /^POINT\((-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)\)$/;

/** `centroide_ll` is WKT with longitude first: "POINT(4.898 52.377)". */
export function parseLookup(body: unknown): Place | null {
  const first = docs(body)?.[0];
  if (!first || typeof first.weergavenaam !== 'string' || typeof first.centroide_ll !== 'string') return null;
  const m = POINT_RE.exec(first.centroide_ll);
  if (!m) return null;
  return { label: first.weergavenaam, lon: Number(m[1]), lat: Number(m[2]) };
}

import type { Page } from '@playwright/test';

// 07:00 in Amsterdam (CEST) on Tuesday 2026-10-20: before the default 07:30-09:00 window.
export const NOW = new Date('2026-10-20T05:00:00Z');

export const PLACES = {
  'adr-from': { label: 'Damrak 1, 1012LG Amsterdam', point: 'POINT(4.89803846 52.37714446)' },
  'adr-to': { label: 'Gustav Mahlerlaan 10, 1082PP Amsterdam', point: 'POINT(4.87381 52.33858)' },
} as const;

type Hour = { prob: number; mm: number; speed: number; from: number; gust: number };

/** An Open-Meteo body for 2026-10-20 and 21, with `hour(hh)` giving each hour's values. */
export function forecast(hour: (hh: number) => Partial<Hour> = () => ({})) {
  const time: string[] = [];
  const cols = {
    prob: [] as number[],
    mm: [] as number[],
    speed: [] as number[],
    from: [] as number[],
    gust: [] as number[],
  };
  for (const date of ['2026-10-20', '2026-10-21']) {
    for (let hh = 0; hh < 24; hh++) {
      time.push(`${date}T${String(hh).padStart(2, '0')}:00`);
      const h: Hour = { prob: 5, mm: 0, speed: 8, from: 30, gust: 15, ...hour(hh) };
      for (const k of Object.keys(cols) as (keyof Hour)[]) cols[k].push(h[k]);
    }
  }
  return {
    timezone: 'Europe/Amsterdam',
    hourly: {
      time,
      precipitation_probability: cols.prob,
      precipitation: cols.mm,
      wind_speed_10m: cols.speed,
      wind_direction_10m: cols.from,
      wind_gusts_10m: cols.gust,
    },
  };
}

export interface Calls {
  pdok: string[];
  meteo: string[];
}

/**
 * Mocks PDOK and Open-Meteo, records every URL called, and freezes the clock. Routes sit on the context, not
 * the page, so they also see requests that pass through the service worker.
 */
export async function mockThirdParties(page: Page, body = forecast()): Promise<Calls> {
  const calls: Calls = { pdok: [], meteo: [] };
  await page.clock.setFixedTime(NOW);
  await page.context().route('https://api.pdok.nl/**', async (route) => {
    const url = new URL(route.request().url());
    calls.pdok.push(url.toString());
    const headers = { 'access-control-allow-origin': '*' };
    if (url.pathname.endsWith('/suggest')) {
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const docs = Object.entries(PLACES)
        .filter(([, p]) => p.label.toLowerCase().includes(q.split(' ')[0]!))
        .map(([id, p]) => ({ id, weergavenaam: p.label, type: 'adres' }));
      return route.fulfill({ json: { response: { docs } }, headers });
    }
    const id = url.searchParams.get('id') as keyof typeof PLACES;
    const p = PLACES[id];
    return route.fulfill({
      json: { response: { docs: [{ id, weergavenaam: p.label, centroide_ll: p.point }] } },
      headers,
    });
  });
  await page.context().route('https://api.open-meteo.com/**', async (route) => {
    calls.meteo.push(route.request().url());
    return route.fulfill({ json: body, headers: { 'access-control-allow-origin': '*' } });
  });
  return calls;
}

/** Walks the three onboarding steps with the default 07:30-09:00 window. */
export async function onboard(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByLabel('Start address').fill('Damrak 1');
  await page.getByRole('option', { name: /Damrak 1/ }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Destination').fill('Gustav Mahlerlaan');
  await page.getByRole('option', { name: /Gustav Mahlerlaan/ }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: "See today's advice" }).click();
}

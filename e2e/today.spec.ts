import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { forecast, mockThirdParties, onboard } from './fixtures';

test('onboarding leads to a bike verdict on a calm dry morning', async ({ page }) => {
  const calls = await mockThirdParties(page);
  await onboard(page);

  await expect(page.getByText('Bike · leave 07:30')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Good cycling weather: leave at 07:30.');
  await expect(page.getByText(/Light wind 8 km\/h · dry/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open-Meteo.com (CC BY 4.0)' })).toBeVisible();

  // Only the rounded cell reaches Open-Meteo; the typed text is all PDOK sees.
  const meteo = new URL(calls.meteo[0]!);
  expect(meteo.searchParams.get('latitude')).toBe('52.36');
  expect(meteo.searchParams.get('longitude')).toBe('4.89');
  expect(calls.meteo.join(' ')).not.toContain('52.377');
  expect(calls.pdok.every((u) => !u.includes('4.898'))).toBe(true);
});

test('the route stays on the device and survives a reload', async ({ page }) => {
  await mockThirdParties(page);
  await onboard(page);
  await expect(page.getByText('Bike · leave 07:30')).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(/#\/today$/);
  await expect(page.getByText('Bike · leave 07:30')).toBeVisible();
});

test('a wet window says public transport', async ({ page }) => {
  await mockThirdParties(
    page,
    forecast(() => ({ prob: 95, mm: 2.5 })),
  );
  await onboard(page);
  await expect(page.getByText('Public transport', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Take public transport: it rains through your whole window.',
  );
});

test('early rain that clears shifts the departure', async ({ page }) => {
  // Rain 07:00-08:00 only (labelled 08:00): leaving at 08:00 inside the 07:30-09:00 window stays dry.
  await mockThirdParties(
    page,
    forecast((hh) => (hh === 8 ? { prob: 95, mm: 3 } : {})),
  );
  await onboard(page);
  await expect(page.getByText('Bike · leave 08:00')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Leave at 08:00 instead and you miss the rain.',
  );
});

test('hour by hour marks the window and the best moment', async ({ page }) => {
  await mockThirdParties(page);
  await onboard(page);
  await page.getByRole('button', { name: 'Hour by hour' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hour by hour');
  const rows = page.locator('ol.rows li');
  await expect(rows).toHaveCount(4); // 06:00-09:00
  await expect(rows.filter({ hasText: 'Best moment' })).toHaveText(/07:00/);
});

test('switching language translates the verdict and is remembered', async ({ page }) => {
  await mockThirdParties(page);
  await onboard(page);
  await page.getByRole('button', { name: 'Nederlands' }).click();
  await expect(page.getByText('Fiets · vertrek 07:30')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'nl');
  await page.getByRole('button', { name: 'Italiano' }).click();
  await expect(page.getByText('Bici · parti alle 07:30')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Bici · parti alle 07:30')).toBeVisible();
});

test('the privacy page lists every third party', async ({ page }) => {
  await mockThirdParties(page);
  await page.goto('/');
  await page.getByRole('link', { name: 'How your data is used' }).click();
  await expect(page.getByRole('heading', { name: 'PDOK (address search)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Open-Meteo (weather)' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Stays on this phone' })).toBeVisible();
});

test('a failing forecast shows an error with retry', async ({ page }) => {
  await mockThirdParties(page);
  await page.route('https://api.open-meteo.com/**', (route) => route.fulfill({ status: 503, body: 'down' }));
  await onboard(page);
  await expect(page.getByRole('alert')).toContainText('The forecast is unavailable');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

for (const screen of ['setup', 'today', 'hours', 'privacy', 'about'] as const) {
  test(`text contrast meets WCAG AA on ${screen}`, async ({ page }) => {
    await mockThirdParties(page);
    await onboard(page);
    await expect(page.getByText('Bike · leave 07:30')).toBeVisible();
    await page.goto(`/#/${screen}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
    expect(results.violations).toEqual([]);
  });
}

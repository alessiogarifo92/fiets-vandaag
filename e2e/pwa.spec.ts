/// <reference lib="dom" />
// page.evaluate callbacks run in the browser, so this file needs the DOM types.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page, type Route } from '@playwright/test';
import { mockThirdParties, NOW, onboard } from './fixtures';

// Playwright cannot install the app, emulate standalone mode or deliver a push: those stay on the
// real-device list of the ticket. Service workers run in Chromium only, so every test here is Chromium.

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';

const METEO = 'https://api.open-meteo.com/**';
const unreachable = (route: Route) => route.abort('internetdisconnected');

/** Cuts the network; the mocks would still answer, so Open-Meteo is made to fail as well. */
async function goOffline(page: Page): Promise<void> {
  await page.context().setOffline(true);
  await page.context().route(METEO, unreachable);
}

async function goOnline(page: Page): Promise<void> {
  await page.context().unroute(METEO, unreachable);
  await page.context().setOffline(false);
}

/** Waits until the service worker controls the page, so the next load can come from its cache. */
async function waitForServiceWorker(page: Page): Promise<void> {
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) {
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  }
}

test('the app is installable: manifest, icons and a service worker with scope /', async ({ page }) => {
  await mockThirdParties(page);
  await page.goto('/');
  await waitForServiceWorker(page);

  // The same check Lighthouse's installability audit used: Chrome's own list of installability errors.
  const cdp = await page.context().newCDPSession(page);
  const { installabilityErrors } = (await cdp.send('Page.getInstallabilityErrors')) as {
    installabilityErrors: unknown[];
  };
  expect(installabilityErrors).toEqual([]);

  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toBe('http://localhost:5173/');

  const manifest = await (await page.request.get('/manifest.webmanifest')).json();
  expect(manifest).toMatchObject({ id: '/', start_url: '/', scope: '/', display: 'standalone' });
  for (const icon of manifest.icons as { src: string }[]) {
    expect((await page.request.get(icon.src)).ok()).toBe(true);
  }
  expect((await page.request.get('/icons/apple-touch-icon.png')).ok()).toBe(true);
});

test('/sw.js is served with no-cache', async ({ request }) => {
  const res = await request.get('/sw.js');
  expect(res.ok()).toBe(true);
  expect(res.headers()['cache-control']).toContain('no-cache');
});

test('offline, the app opens from the cache and shows the last result with its forecast time', async ({
  page,
}) => {
  await mockThirdParties(page);
  await onboard(page);
  await expect(page.getByText('Bike · leave 07:30')).toBeVisible();
  await waitForServiceWorker(page);

  // An hour later the cached forecast is no longer fresh, and the network is gone.
  await page.clock.setFixedTime(new Date(NOW.getTime() + 60 * 60 * 1000));
  await goOffline(page);
  await page.reload();

  await expect(page.getByText(/^Bike · leave/)).toBeVisible();
  await expect(page.getByText('Offline: showing the forecast of 20-10 07:00')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open-Meteo.com (CC BY 4.0)' })).toBeVisible();
});

test('back online, the forecast refreshes without a reload', async ({ page }) => {
  const calls = await mockThirdParties(page);
  await onboard(page);
  await expect(page.getByText('Bike · leave 07:30')).toBeVisible();
  await waitForServiceWorker(page);
  await page.clock.setFixedTime(new Date(NOW.getTime() + 60 * 60 * 1000));
  await goOffline(page);
  await page.reload();
  await expect(page.getByText(/Offline: showing the forecast/)).toBeVisible();

  const before = calls.meteo.length;
  await goOnline(page);
  await expect(page.getByText('Forecast of 08:00')).toBeVisible();
  expect(calls.meteo.length).toBe(before + 1);
});

test('Android: the install card opens the browser prompt and then hides', async ({ page }) => {
  await mockThirdParties(page);
  await onboard(page);
  await expect(page.getByText('Bike · leave 07:30')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Install the app' })).toHaveCount(0);

  // Chrome fires beforeinstallprompt on its own schedule; fire one by hand to test the wiring.
  await page.evaluate(() => {
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: async () => {
        (window as unknown as { prompted: boolean }).prompted = true;
      },
      userChoice: Promise.resolve({ outcome: 'accepted' }),
    });
    window.dispatchEvent(event);
  });
  await expect(page.getByRole('heading', { name: 'Install the app' })).toBeVisible();
  await page.getByRole('button', { name: 'Install', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { prompted?: boolean }).prompted)).toBe(true);
  await expect(page.getByRole('heading', { name: 'Install the app' })).toHaveCount(0);
});

test('Android: the push toggle is shown and nothing asks permission before a tap', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { permissionAsks: number };
    w.permissionAsks = 0;
    // A phone that was never asked; the tap's answer is "denied", as headless Chromium would give.
    let permission: NotificationPermission = 'default';
    Object.defineProperty(Notification, 'permission', { get: () => permission });
    Notification.requestPermission = () => {
      w.permissionAsks++;
      permission = 'denied';
      return Promise.resolve(permission);
    };
  });
  await mockThirdParties(page);
  await onboard(page);
  await expect(page.getByRole('switch', { name: 'Morning notification' })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Morning notification' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  expect(await page.evaluate(() => (window as unknown as { permissionAsks: number }).permissionAsks)).toBe(0);

  // Without an invite code nothing is asked yet: the card asks for the code first.
  await page.getByRole('switch', { name: 'Morning notification' }).click();
  await expect(page.getByText('Enter your invite code first.')).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { permissionAsks: number }).permissionAsks)).toBe(0);

  await page.getByLabel('Invite code').fill('abc');
  await page.getByRole('switch', { name: 'Morning notification' }).click();
  // The prompt follows an IndexedDB read, so it is not there the instant the click returns.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { permissionAsks: number }).permissionAsks))
    .toBe(1);
  await expect(page.getByText('Notifications are blocked.', { exact: false })).toBeVisible();
  await expect(page.getByRole('switch', { name: 'Morning notification' })).toBeDisabled();
});

test.describe('iOS in the browser', () => {
  test.use({ userAgent: IPHONE_UA });

  test('onboarding starts with Add to Home Screen, and continuing in the browser is remembered', async ({
    page,
  }) => {
    await mockThirdParties(page);
    await page.goto('/');
    await expect(page).toHaveURL(/#\/install$/);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'First, add Fiets Vandaag to your Home Screen.',
    );
    await expect(page.getByText('Scroll down and choose “Add to Home Screen”.')).toBeVisible();
    // No install prompt exists on iOS, so no install button either.
    await expect(page.getByRole('button', { name: 'Install', exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Continue in the browser' }).click();
    await expect(page.getByLabel('Start address')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Start address')).toBeVisible();
  });

  test('without the Home Screen app there is no push toggle', async ({ page }) => {
    await mockThirdParties(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Continue in the browser' }).click();
    await page.getByLabel('Start address').fill('Damrak 1');
    await page.getByRole('option', { name: /Damrak 1/ }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByLabel('Destination').fill('Gustav Mahlerlaan');
    await page.getByRole('option', { name: /Gustav Mahlerlaan/ }).click();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('button', { name: "See today's advice" }).click();
    await expect(page.getByText('Bike · leave 07:30')).toBeVisible();
    await expect(page.getByRole('switch', { name: 'Morning notification' })).toHaveCount(0);
  });

  test('text contrast meets WCAG AA on the install step', async ({ page }) => {
    await mockThirdParties(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const results = await new AxeBuilder({ page }).withRules(['color-contrast']).analyze();
    expect(results.violations).toEqual([]);
  });

  test('the install step is translated', async ({ page }) => {
    await mockThirdParties(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Nederlands' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Zet Fiets Vandaag eerst op je beginscherm.',
    );
    await page.getByRole('button', { name: 'Italiano' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(
      'Prima aggiungi Fiets Vandaag alla schermata Home.',
    );
  });
});

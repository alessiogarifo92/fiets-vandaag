/// <reference lib="dom" />
// page.evaluate callbacks run in the browser, so this file needs the DOM types.
import { expect, test, type Page } from '@playwright/test';
import { mockThirdParties, onboard } from './fixtures';

// The device API is mocked here (its own behaviour is covered by the worker integration tests on a local
// D1); this checks what the app sends and when. Headless Chromium has no push service, so the browser's
// PushManager is stubbed with a fixed subscription.

const SUB = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/e2e-endpoint',
  keys: { p256dh: 'B' + 'A'.repeat(86), auth: 'a'.repeat(22) },
};
const DEVICE = { deviceId: '123e4567-e89b-42d3-a456-426614174000', secret: 's'.repeat(43) };

interface ApiCall {
  method: string;
  path: string;
  body: unknown;
  auth: string | null;
}

async function stubPush(page: Page, endpoint = SUB.endpoint): Promise<void> {
  await page.addInitScript(
    ({ sub }) => {
      // Kept across reloads, like a real permission.
      const read = () => (sessionStorage.getItem('e2e-permission') ?? 'default') as NotificationPermission;
      Object.defineProperty(Notification, 'permission', { get: read });
      Notification.requestPermission = () => {
        sessionStorage.setItem('e2e-permission', 'granted');
        return Promise.resolve(read());
      };
      let current: object | null = null;
      const make = () => ({ toJSON: () => sub, unsubscribe: async () => ((current = null), true) });
      PushManager.prototype.getSubscription = async () => current as PushSubscription | null;
      PushManager.prototype.subscribe = async () => (current = make()) as unknown as PushSubscription;
    },
    { sub: { ...SUB, endpoint } },
  );
}

async function mockApi(page: Page, overrides: Record<string, { status: number; json?: unknown }> = {}) {
  const calls: ApiCall[] = [];
  await page.context().route('**/api/{devices,devices/me,routes/*,opens}', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    calls.push({
      method: req.method(),
      path,
      body: req.postDataJSON(),
      auth: req.headers().authorization ?? null,
    });
    const key = `${req.method()} ${path}`;
    const answer =
      overrides[key] ??
      (key === 'POST /api/devices'
        ? { status: 201, json: DEVICE }
        : key === 'PUT /api/routes/1'
          ? { status: 200, json: {} }
          : { status: 204 });
    return answer.json === undefined
      ? route.fulfill({ status: answer.status })
      : route.fulfill({ status: answer.status, json: answer.json });
  });
  return calls;
}

const toggle = (page: Page) => page.getByRole('switch', { name: 'Morning notification' });

test('an invite link registers the device after the tap and sends only the route cell and bearing', async ({
  page,
}) => {
  await stubPush(page);
  await mockThirdParties(page);
  const calls = await mockApi(page);

  await page.goto('/?invite=team-2026');
  // The code is kept on the device and taken out of the address bar.
  await expect(page).not.toHaveURL(/invite=/);
  await onboard(page);
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByLabel('Invite code')).toHaveCount(0);
  expect(calls).toEqual([]);

  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByText('A test notification is on its way', { exact: false })).toBeVisible();

  const register = calls.find((c) => c.path === '/api/devices')!;
  expect(register.body).toEqual({ invite: 'team-2026', lang: 'en', push: SUB });
  const put = calls.find((c) => c.path === '/api/routes/1')!;
  expect(put.method).toBe('PUT');
  expect(put.auth).toBe(`Bearer ${DEVICE.deviceId}.${DEVICE.secret}`);
  // Midpoint of Damrak 1 and Gustav Mahlerlaan 10, rounded to its ~1 km cell; window 07:30-09:00; the
  // estimated ride (about 4.6 km straight) so the push computes the same advice as the Today screen.
  expect(put.body).toEqual({
    cell: '52.36,4.89',
    bearing: 201,
    window: { start: 450, end: 540 },
    weekdays: [1, 2, 3, 4, 5],
    notifyAt: 420,
    rideMin: 25,
  });
  expect(JSON.stringify(put.body)).not.toMatch(/Damrak|Mahler|52\.377|4\.898|52\.338|4\.873/);

  // Changing the push time re-sends the route.
  await page.getByLabel('Notify me at').selectOption({ label: '06:45' });
  await expect.poll(() => calls.filter((c) => c.path === '/api/routes/1').length).toBe(2);
  expect((calls.at(-1)!.body as { notifyAt: number }).notifyAt).toBe(405);

  // Switching language tells the server, so pushes arrive in that language.
  await page.getByRole('button', { name: 'Nederlands' }).click();
  await expect.poll(() => calls.find((c) => c.method === 'PATCH')?.body).toEqual({ lang: 'nl' });
});

test('without an invite link the code is typed in, and a wrong code says so', async ({ page }) => {
  await stubPush(page);
  await mockThirdParties(page);
  await mockApi(page, {
    'POST /api/devices': { status: 403, json: { error: { code: 'invite_invalid', message: 'x' } } },
  });
  await onboard(page);

  await page.getByLabel('Invite code').fill('wrong');
  await toggle(page).click();
  await expect(page.getByText('This invite code is not valid.', { exact: false })).toBeVisible();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'false');
});

test('a full house is explained', async ({ page }) => {
  await stubPush(page);
  await mockThirdParties(page);
  await mockApi(page, {
    'POST /api/devices': { status: 503, json: { error: { code: 'capacity', message: 'x' } } },
  });
  await onboard(page);
  await page.getByLabel('Invite code').fill('abc');
  await toggle(page).click();
  await expect(page.getByText('Fiets Vandaag is full for now.', { exact: false })).toBeVisible();
});

test('a registered app logs one open a day and re-sends a changed endpoint', async ({ page }) => {
  await stubPush(page);
  await mockThirdParties(page);
  const calls = await mockApi(page);
  await page.goto('/?invite=abc');
  await onboard(page);
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');

  // Next launch: the browser has rotated the subscription.
  await page.addInitScript(() => {
    const orig = PushManager.prototype.getSubscription;
    PushManager.prototype.getSubscription = async function () {
      const sub = await orig.call(this);
      return (sub ?? {
        toJSON: () => ({
          endpoint: 'https://fcm.googleapis.com/fcm/send/rotated',
          keys: { p256dh: 'B' + 'A'.repeat(86), auth: 'a'.repeat(22) },
        }),
        unsubscribe: async () => true,
      }) as PushSubscription;
    };
  });
  await page.reload();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
  await expect.poll(() => calls.filter((c) => c.method === 'PATCH').length).toBe(1);
  expect(calls.find((c) => c.method === 'PATCH')!.body).toEqual({
    push: { ...SUB, endpoint: 'https://fcm.googleapis.com/fcm/send/rotated' },
  });
  await expect
    .poll(() => calls.filter((c) => c.path === '/api/opens').map((c) => c.body))
    .toEqual([{ date: '2026-10-20', source: 'app' }]);
});

test('Delete my data removes the device on the server and everything on the phone', async ({ page }) => {
  await stubPush(page);
  await mockThirdParties(page);
  const calls = await mockApi(page);
  await page.goto('/?invite=abc');
  await onboard(page);
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');

  await page.getByRole('link', { name: 'Privacy' }).click();
  await expect(page.getByText('Our server, run by Cloudflare', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Delete my data' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(0);

  await page.getByRole('button', { name: 'Delete my data' }).click();
  await expect(page.getByText('It cannot be undone.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Delete everything' }).click();
  await expect(page.getByText('Your data has been deleted.')).toBeVisible();
  const del = calls.find((c) => c.method === 'DELETE')!;
  expect(del.path).toBe('/api/devices/me');
  expect(del.auth).toBe(`Bearer ${DEVICE.deviceId}.${DEVICE.secret}`);

  // Nothing is left on the phone: back goes to route setup, and a reload stays there.
  await page.getByRole('link', { name: /Back/ }).click();
  await expect(page.getByLabel('Start address')).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('Start address')).toBeVisible();
});

test('Delete my data keeps everything when the server cannot be reached', async ({ page }) => {
  await stubPush(page);
  await mockThirdParties(page);
  await mockApi(page, {
    'DELETE /api/devices/me': { status: 500, json: { error: { code: 'internal', message: 'x' } } },
  });
  await page.goto('/?invite=abc');
  await onboard(page);
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('link', { name: 'Privacy' }).click();
  await page.getByRole('button', { name: 'Delete my data' }).click();
  await page.getByRole('button', { name: 'Delete everything' }).click();
  await expect(page.getByText('Your data could not be deleted.', { exact: false })).toBeVisible();
  await page.getByRole('link', { name: /Back/ }).click();
  await expect(toggle(page)).toHaveAttribute('aria-checked', 'true');
});

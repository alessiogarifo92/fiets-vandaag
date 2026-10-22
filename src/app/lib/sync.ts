// Server upkeep on every app open and return to the foreground: endpoint resync, the daily open, the route.

import { logOpen, syncRoute } from './device';
import { resyncPush } from './push';

/** Each step is independent and best effort: the app works offline and tries again next time. */
export async function onAppOpen(now: Date, steps = { resyncPush, logOpen, syncRoute }): Promise<void> {
  await steps.resyncPush().catch(() => {});
  await steps.logOpen(now).catch(() => {});
  await steps.syncRoute().catch(() => {});
}

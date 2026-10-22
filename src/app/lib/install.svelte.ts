// Install state for the screens: the platform, whether the app runs installed, and Chrome's deferred
// install prompt (iOS has none; it gets the "Add to Home Screen" steps instead).

import { currentStandalone, detectPlatform, installMode, type InstallMode, type Platform } from './platform';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;

export const install = $state<{ platform: Platform; standalone: boolean; hasPrompt: boolean }>({
  platform: globalThis.navigator
    ? detectPlatform({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints ?? 0 })
    : 'other',
  standalone: globalThis.navigator ? currentStandalone() : false,
  hasPrompt: false,
});

export function mode(): InstallMode {
  return installMode(install.platform, install.standalone, install.hasPrompt);
}

/** Opens the browser's own install dialog; true when the user accepted. */
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  // A prompt can be used once; Chrome fires a new event if the user dismisses it.
  deferred = null;
  install.hasPrompt = false;
  await event.prompt();
  return (await event.userChoice).outcome === 'accepted';
}

globalThis.addEventListener?.('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as InstallPromptEvent;
  install.hasPrompt = true;
});

globalThis.addEventListener?.('appinstalled', () => {
  deferred = null;
  install.hasPrompt = false;
});

globalThis.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', () => {
  install.standalone = currentStandalone();
});

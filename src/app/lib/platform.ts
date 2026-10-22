// Which install and push path this browser gets (docs/architecture.md §6). Pure: the browser globals are
// passed in, so the unit tests can describe any device.

export type Platform = 'ios' | 'android' | 'other';

export interface DeviceInfo {
  userAgent: string;
  /** iPadOS 13+ reports a Mac user agent; only its touch points give it away. */
  maxTouchPoints: number;
}

export function detectPlatform({ userAgent, maxTouchPoints }: DeviceInfo): Platform {
  if (/iPhone|iPad|iPod/.test(userAgent)) return 'ios';
  if (/Macintosh/.test(userAgent) && maxTouchPoints > 1) return 'ios';
  if (/Android/.test(userAgent)) return 'android';
  return 'other';
}

/** iOS version as [major, minor], from "OS 16_4" (iPhone) or "Version/16.4" (iPadOS desktop UA). */
export function iosVersion(userAgent: string): [number, number] | null {
  const m = /OS (\d+)[_.](\d+)/.exec(userAgent) ?? /Version\/(\d+)\.(\d+)/.exec(userAgent);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

export interface DisplayInfo {
  /** `matchMedia('(display-mode: standalone)').matches`. */
  standaloneMedia: boolean;
  /** Safari's non-standard `navigator.standalone`. */
  navigatorStandalone?: boolean;
}

/** True when running as the installed app (opened from the Home Screen or the app drawer). */
export function isStandalone({ standaloneMedia, navigatorStandalone }: DisplayInfo): boolean {
  return standaloneMedia || navigatorStandalone === true;
}

export interface PushEnv extends DeviceInfo {
  standalone: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
}

/**
 * - `available`: the push toggle can be shown.
 * - `install-first`: iOS in the browser; web push only works from the Home Screen app.
 * - `ios-too-old`: iOS before 16.4 has no web push at all.
 * - `unsupported`: anything else without the APIs.
 */
export type PushAvailability = 'available' | 'install-first' | 'ios-too-old' | 'unsupported';

export function pushAvailability(env: PushEnv): PushAvailability {
  if (detectPlatform(env) === 'ios') {
    const v = iosVersion(env.userAgent);
    if (v && (v[0] < 16 || (v[0] === 16 && v[1] < 4))) return 'ios-too-old';
    // iOS exposes PushManager only inside the installed app, so test standalone before the APIs.
    if (!env.standalone) return 'install-first';
  }
  return env.hasServiceWorker && env.hasPushManager && env.hasNotification ? 'available' : 'unsupported';
}

/**
 * - `ios-steps`: show the "Add to Home Screen" steps (iOS has no install prompt).
 * - `prompt`: show an install button that opens the browser's own prompt (Chrome, Edge, Samsung Internet).
 * - `none`: already installed, or the browser offers no install path.
 */
export type InstallMode = 'ios-steps' | 'prompt' | 'none';

export function installMode(platform: Platform, standalone: boolean, hasPrompt: boolean): InstallMode {
  if (standalone) return 'none';
  if (platform === 'ios') return 'ios-steps';
  return hasPrompt ? 'prompt' : 'none';
}

/** Reads the live browser; the screens use this, the tests use the pure functions above. */
export function currentPushEnv(): PushEnv {
  return {
    userAgent: navigator.userAgent,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone: currentStandalone(),
    hasServiceWorker: 'serviceWorker' in navigator,
    hasPushManager: 'PushManager' in globalThis,
    hasNotification: 'Notification' in globalThis,
  };
}

export function currentStandalone(): boolean {
  return isStandalone({
    standaloneMedia: globalThis.matchMedia?.('(display-mode: standalone)').matches ?? false,
    navigatorStandalone: (navigator as Navigator & { standalone?: boolean }).standalone,
  });
}

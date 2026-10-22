import { describe, expect, it } from 'vitest';
import {
  detectPlatform,
  installMode,
  iosVersion,
  isStandalone,
  pushAvailability,
  type PushEnv,
} from './platform';

const UA = {
  iphone164:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Mobile/15E148 Safari/604.1',
  iphone163:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 16_3_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1',
  iphone15:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1',
  // Chrome on iPhone still runs WebKit and says CriOS.
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  // iPadOS 13+ asks for the desktop site by default.
  ipadDesktop:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  android:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  windows:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

describe('detectPlatform', () => {
  it.each([
    ['iphone164', 5, 'ios'],
    ['iphoneChrome', 5, 'ios'],
    ['ipadDesktop', 5, 'ios'],
    ['mac', 0, 'other'],
    ['android', 5, 'android'],
    ['windows', 0, 'other'],
  ] as const)('%s → %s', (ua, touch, expected) => {
    expect(detectPlatform({ userAgent: UA[ua], maxTouchPoints: touch })).toBe(expected);
  });
});

describe('iosVersion', () => {
  it('reads the iPhone OS version, with or without a patch number', () => {
    expect(iosVersion(UA.iphone164)).toEqual([16, 4]);
    expect(iosVersion(UA.iphone163)).toEqual([16, 3]);
  });

  it('reads Version/ from the iPadOS desktop user agent', () => {
    expect(iosVersion(UA.ipadDesktop)).toEqual([17, 4]);
  });

  it('returns null without a version', () => {
    expect(iosVersion('Mozilla/5.0 (iPhone)')).toBeNull();
  });
});

describe('isStandalone', () => {
  it('is true for the display-mode media query or Safari’s navigator.standalone', () => {
    expect(isStandalone({ standaloneMedia: true })).toBe(true);
    expect(isStandalone({ standaloneMedia: false, navigatorStandalone: true })).toBe(true);
  });

  it('is false in a browser tab', () => {
    expect(isStandalone({ standaloneMedia: false })).toBe(false);
    expect(isStandalone({ standaloneMedia: false, navigatorStandalone: false })).toBe(false);
  });
});

describe('pushAvailability', () => {
  const env = (over: Partial<PushEnv>): PushEnv => ({
    userAgent: UA.android,
    maxTouchPoints: 5,
    standalone: false,
    hasServiceWorker: true,
    hasPushManager: true,
    hasNotification: true,
    ...over,
  });

  it('Android Chrome has push in the browser and installed', () => {
    expect(pushAvailability(env({}))).toBe('available');
    expect(pushAvailability(env({ standalone: true }))).toBe('available');
  });

  it('iOS 16.4+ in the browser must install first, even when the APIs look present', () => {
    expect(pushAvailability(env({ userAgent: UA.iphone164 }))).toBe('install-first');
    expect(pushAvailability(env({ userAgent: UA.iphone164, hasPushManager: false }))).toBe('install-first');
  });

  it('iOS 16.4+ installed shows the toggle', () => {
    expect(pushAvailability(env({ userAgent: UA.iphone164, standalone: true }))).toBe('available');
    expect(pushAvailability(env({ userAgent: UA.ipadDesktop, standalone: true }))).toBe('available');
  });

  it('iOS before 16.4 has no web push, installed or not', () => {
    expect(pushAvailability(env({ userAgent: UA.iphone163 }))).toBe('ios-too-old');
    expect(pushAvailability(env({ userAgent: UA.iphone15, standalone: true }))).toBe('ios-too-old');
  });

  it('is unsupported when any API is missing outside iOS', () => {
    expect(pushAvailability(env({ hasServiceWorker: false }))).toBe('unsupported');
    expect(pushAvailability(env({ hasPushManager: false }))).toBe('unsupported');
    expect(pushAvailability(env({ hasNotification: false }))).toBe('unsupported');
  });

  it('is unsupported on an installed iOS app that lacks the APIs', () => {
    expect(pushAvailability(env({ userAgent: UA.iphone164, standalone: true, hasPushManager: false }))).toBe(
      'unsupported',
    );
  });
});

describe('installMode', () => {
  it('shows nothing once installed', () => {
    expect(installMode('ios', true, false)).toBe('none');
    expect(installMode('android', true, true)).toBe('none');
  });

  it('shows the Add to Home Screen steps on iOS, which has no prompt', () => {
    expect(installMode('ios', false, false)).toBe('ios-steps');
  });

  it('shows the install button only when the browser offered a prompt', () => {
    expect(installMode('android', false, true)).toBe('prompt');
    expect(installMode('other', false, true)).toBe('prompt');
    expect(installMode('android', false, false)).toBe('none');
  });
});

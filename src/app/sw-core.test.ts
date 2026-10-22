import { describe, expect, it, vi } from 'vitest';
import {
  cacheName,
  handleAsset,
  handleShell,
  precacheUrls,
  readPush,
  staleCaches,
  strategyFor,
  type CacheLike,
} from './sw-core';

const ORIGIN = 'https://fiets-vandaag.example';

/** A Map-backed cache keyed by URL, like CacheStorage's. */
function memoryCache(entries: Record<string, string> = {}): CacheLike & { keys: () => string[] } {
  const store = new Map<string, Response>(Object.entries(entries).map(([k, v]) => [k, new Response(v)]));
  const key = (r: Request | string) => (typeof r === 'string' ? r : new URL(r.url).pathname);
  return {
    match: async (r) => store.get(key(r))?.clone(),
    put: async (r, res) => void store.set(key(r), res),
    keys: () => [...store.keys()],
  };
}

describe('cache names', () => {
  it('versions the cache per build', () => {
    expect(cacheName('abc123')).toBe('fiets-shell-abc123');
  });

  it('drops older shell caches only', () => {
    expect(staleCaches(['fiets-shell-old', 'fiets-shell-new', 'other-app'], 'fiets-shell-new')).toEqual([
      'fiets-shell-old',
    ]);
  });
});

describe('precacheUrls', () => {
  it('lists the page and built files, without maps, dotfiles, sw.js, _headers or unused fonts', () => {
    const files = [
      '.assetsignore',
      '_headers',
      'sw.js',
      'index.html',
      'favicon.svg',
      'manifest.webmanifest',
      'icons/icon-192.png',
      'assets/index-abc.js',
      'assets/index-abc.js.map',
      'assets/index-abc.css',
      'assets/geist-latin-400-normal-x.woff2',
      'assets/geist-latin-ext-400-normal-x.woff2',
      'assets/geist-latin-400-normal-x.woff',
      'assets/geist-cyrillic-400-normal-x.woff2',
      'assets/geist-cyrillic-ext-500-normal-x.woff2',
      'assets/geist-vietnamese-600-normal-x.woff2',
    ];
    expect(precacheUrls(files)).toEqual([
      '/',
      '/assets/geist-latin-400-normal-x.woff2',
      '/assets/geist-latin-ext-400-normal-x.woff2',
      '/assets/index-abc.css',
      '/assets/index-abc.js',
      '/favicon.svg',
      '/icons/icon-192.png',
      '/manifest.webmanifest',
    ]);
  });
});

describe('strategyFor', () => {
  const req = (url: string, mode = 'cors', method = 'GET') => ({ url, mode, method });

  it('serves page navigations network first', () => {
    expect(strategyFor(req(`${ORIGIN}/`, 'navigate'), ORIGIN)).toBe('shell');
    expect(strategyFor(req(`${ORIGIN}/#/today`, 'navigate'), ORIGIN)).toBe('shell');
  });

  it('serves same-origin files from the cache', () => {
    expect(strategyFor(req(`${ORIGIN}/assets/index-abc.js`), ORIGIN)).toBe('asset');
    expect(strategyFor(req(`${ORIGIN}/icons/icon-192.png`, 'no-cors'), ORIGIN)).toBe('asset');
  });

  it('never intercepts the API, the worker script, other methods or third parties', () => {
    expect(strategyFor(req(`${ORIGIN}/api/health`), ORIGIN)).toBe('network');
    expect(strategyFor(req(`${ORIGIN}/api/devices`, 'cors', 'POST'), ORIGIN)).toBe('network');
    expect(strategyFor(req(`${ORIGIN}/sw.js`), ORIGIN)).toBe('network');
    expect(strategyFor(req('https://api.open-meteo.com/v1/forecast?x=1'), ORIGIN)).toBe('network');
    expect(strategyFor(req('https://api.pdok.nl/bzk/locatieserver/search/v3_1/suggest'), ORIGIN)).toBe(
      'network',
    );
  });
});

describe('handleShell', () => {
  it('returns the network page and refreshes the cached shell', async () => {
    const cache = memoryCache({ '/': 'old' });
    const fetchFn = vi.fn().mockResolvedValue(new Response('new'));
    const res = await handleShell(new Request(`${ORIGIN}/`), cache, fetchFn);
    expect(await res.text()).toBe('new');
    expect(await (await cache.match('/'))!.text()).toBe('new');
  });

  it('keeps the cached shell when the network answers an error', async () => {
    const cache = memoryCache({ '/': 'old' });
    const fetchFn = vi.fn().mockResolvedValue(new Response('down', { status: 503 }));
    const res = await handleShell(new Request(`${ORIGIN}/`), cache, fetchFn);
    expect(res.status).toBe(503);
    expect(await (await cache.match('/'))!.text()).toBe('old');
  });

  it('falls back to the cached shell offline', async () => {
    const cache = memoryCache({ '/': 'shell' });
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const res = await handleShell(new Request(`${ORIGIN}/#/today`), cache, fetchFn);
    expect(await res.text()).toBe('shell');
  });

  it('rethrows offline when nothing is cached yet', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(handleShell(new Request(`${ORIGIN}/`), memoryCache(), fetchFn)).rejects.toThrow(
      'Failed to fetch',
    );
  });
});

describe('handleAsset', () => {
  it('answers from the cache without the network', async () => {
    const cache = memoryCache({ '/assets/a.js': 'cached' });
    const fetchFn = vi.fn();
    const res = await handleAsset(new Request(`${ORIGIN}/assets/a.js`), cache, fetchFn);
    expect(await res.text()).toBe('cached');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('fetches and keeps a file on first use', async () => {
    const cache = memoryCache();
    const fetchFn = vi.fn().mockResolvedValue(new Response('font'));
    const res = await handleAsset(new Request(`${ORIGIN}/assets/f.woff2`), cache, fetchFn);
    expect(await res.text()).toBe('font');
    expect(cache.keys()).toEqual(['/assets/f.woff2']);
  });

  it('does not cache an error response', async () => {
    const cache = memoryCache();
    const fetchFn = vi.fn().mockResolvedValue(new Response('missing', { status: 404 }));
    const res = await handleAsset(new Request(`${ORIGIN}/assets/x.js`), cache, fetchFn);
    expect(res.status).toBe(404);
    expect(cache.keys()).toEqual([]);
  });
});

describe('readPush', () => {
  it('reads title, body and an in-app link', () => {
    expect(readPush({ title: 'Bike · leave 07:50', body: 'Tailwind', url: '/#/today' }, 'App')).toEqual({
      title: 'Bike · leave 07:50',
      body: 'Tailwind',
      url: '/#/today',
    });
  });

  it('still shows a notification for an empty or unreadable payload (iOS revokes silent pushes)', () => {
    const fallback = { title: 'App', body: '', url: '/#/today' };
    expect(readPush(undefined, 'App')).toEqual(fallback);
    expect(readPush(null, 'App')).toEqual(fallback);
    expect(readPush('text', 'App')).toEqual(fallback);
    expect(readPush({ title: '  ', body: 3 }, 'App')).toEqual(fallback);
  });

  it('never opens another site', () => {
    for (const url of [
      'https://evil.example/',
      '//evil.example',
      '/#/today?x=<script>',
      'javascript:alert(1)',
    ])
      expect(readPush({ title: 't', url }, 'App').url).toBe('/#/today');
  });

  it('caps the length of title and body', () => {
    const msg = readPush({ title: 'x'.repeat(500), body: 'y'.repeat(500) }, 'App');
    expect(msg.title).toHaveLength(120);
    expect(msg.body).toHaveLength(300);
  });
});

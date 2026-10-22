// Service-worker logic, kept free of the worker globals so it runs in unit tests (docs/architecture.md §6).
// Only same-origin GETs are handled: the API, PDOK and Open-Meteo always go to the network untouched.

export const CACHE_PREFIX = 'fiets-shell-';

/** The cache for one build. A new deploy gets a new name, and activation drops the older ones. */
export function cacheName(version: string): string {
  return CACHE_PREFIX + version;
}

/** Older shell caches to delete on activation; caches of other apps on the origin are left alone. */
export function staleCaches(names: readonly string[], current: string): string[] {
  return names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== current);
}

/** Fonts in scripts the three languages never use are cached on first use instead of at install. */
const SKIPPED_FONT = /-(cyrillic|greek|vietnamese)(-ext)?-[\w-]*\.woff2$|\.woff$/;

/** The app shell: the page itself plus every built file except the rarely used font subsets. */
export function precacheUrls(files: readonly string[]): string[] {
  const urls = files
    .filter((f) => !f.endsWith('.map') && !f.startsWith('.') && f !== 'sw.js' && f !== '_headers')
    .filter((f) => !SKIPPED_FONT.test(f))
    .map((f) => '/' + f.replace(/^\//, ''));
  return ['/', ...urls.filter((u) => u !== '/index.html')].sort();
}

export type Strategy = 'shell' | 'asset' | 'network';

export interface RequestInfo {
  url: string;
  method: string;
  mode: string;
}

/**
 * - `shell`: a page navigation; network first, falling back to the cached page when offline.
 * - `asset`: a same-origin file; cache first, filled on first use.
 * - `network`: everything else, not intercepted.
 */
export function strategyFor(req: RequestInfo, origin: string): Strategy {
  if (req.method !== 'GET') return 'network';
  const url = new URL(req.url);
  if (url.origin !== origin) return 'network';
  if (url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return 'network';
  if (req.mode === 'navigate') return 'shell';
  return 'asset';
}

export interface CacheLike {
  match(request: Request | string): Promise<Response | undefined>;
  put(request: Request | string, response: Response): Promise<void>;
}

/** Network first: a fresh page when online (so a deploy shows up), the cached shell when not. */
export async function handleShell(
  request: Request,
  cache: CacheLike,
  fetchFn: typeof fetch,
): Promise<Response> {
  try {
    const res = await fetchFn(request);
    if (res.ok) await cache.put('/', res.clone());
    return res;
  } catch (err) {
    const cached = await cache.match('/');
    if (cached) return cached;
    throw err;
  }
}

/** Cache first: built files have hashed names, so a cached copy is never out of date. */
export async function handleAsset(
  request: Request,
  cache: CacheLike,
  fetchFn: typeof fetch,
): Promise<Response> {
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetchFn(request);
  if (res.ok) await cache.put(request, res.clone());
  return res;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Where a tap on the notification opens the app. */
  url: string;
}

/**
 * Every push must show a notification, or iOS revokes the subscription (docs/architecture.md §6). An
 * unreadable payload still shows a generic one. The real payload arrives with the cron (tickets 5-6).
 */
export function readPush(data: unknown, fallbackTitle: string): PushMessage {
  const fallback = { title: fallbackTitle, body: '', url: '/#/today' };
  if (typeof data !== 'object' || data === null) return fallback;
  const d = data as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.slice(0, max) : null);
  const url = str(d.url, 200);
  return {
    title: str(d.title, 120) ?? fallback.title,
    body: str(d.body, 300) ?? fallback.body,
    // Only an in-app hash link: a push can never open another site.
    url: url && /^\/#\/[\w-]*$/.test(url) ? url : fallback.url,
  };
}

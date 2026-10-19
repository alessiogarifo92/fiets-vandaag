// On-device storage (IndexedDB). The route's start and end live only here (docs/architecture.md §3).

import type { HourPoint } from '../../core/forecast';
import type { Lang, LocalRoute } from '../../core/validate';

export interface CachedForecast {
  cellKey: string;
  fetchedAt: number;
  hours: HourPoint[];
}

export interface StoreShape {
  route: LocalRoute;
  lang: Lang;
  forecast: CachedForecast;
  /** Local date on which the timeline bars last animated in (DESIGN.md: once per day). */
  animatedOn: string;
}

const DB_NAME = 'fiets-vandaag';
const STORE = 'kv';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  // A failed open (private mode, storage blocked) must not poison later attempts.
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, op: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const req = op(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      }),
  );
}

/** Reads a value; storage errors read as "nothing stored" so the app still starts. */
export async function load<K extends keyof StoreShape>(key: K): Promise<StoreShape[K] | undefined> {
  try {
    return await run<StoreShape[K] | undefined>('readonly', (s) => s.get(key));
  } catch {
    return undefined;
  }
}

export async function save<K extends keyof StoreShape>(key: K, value: StoreShape[K]): Promise<void> {
  // $state proxies cannot be structured-cloned; store a plain copy.
  await run('readwrite', (s) => s.put(JSON.parse(JSON.stringify(value)), key));
}

export async function remove(key: keyof StoreShape): Promise<void> {
  await run('readwrite', (s) => s.delete(key));
}

/** Test hook: forget the open connection. */
export function _reset(): void {
  dbPromise = null;
}

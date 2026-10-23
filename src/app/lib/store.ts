// On-device storage (IndexedDB). The route's start and end live only here (docs/architecture.md §3).

import type { HourPoint } from '../../core/forecast';
import type { Lang, LocalRoute } from '../../core/validate';

export interface CachedForecast {
  cellKey: string;
  fetchedAt: number;
  hours: HourPoint[];
}

/** The browser's push subscription, as last sent to the server. */
export interface PushRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface StoreShape {
  route: LocalRoute;
  lang: Lang;
  forecast: CachedForecast;
  /** Local date on which the timeline bars last animated in (DESIGN.md: once per day). */
  animatedOn: string;
  push: PushRecord;
  /** iOS in the browser: the user chose to continue without installing first. */
  installSkipped: boolean;
  /** Credential from `POST /api/devices`; the server keeps only the hash of the secret. */
  device: DeviceCredential;
  /** Invite code from the invite link (`?invite=`) or typed in; kept to register again after turning off. */
  invite: string;
  /** Morning push time chosen by the user, minutes of day. */
  notifyAt: number;
  /** Local date of the last `POST /api/opens` with source `app`. */
  openedOn: string;
  /** JSON of the last route body the server accepted, to skip identical PUTs. */
  syncedRoute: string;
}

export interface DeviceCredential {
  deviceId: string;
  secret: string;
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
        // Settle on the transaction, not the request: a write is only durable once the transaction commits
        // (it can still abort after onsuccess, e.g. on a full disk).
        const tx = db.transaction(STORE, mode);
        const req = op(tx.objectStore(STORE));
        tx.oncomplete = () => resolve(req.result as T);
        tx.onabort = tx.onerror = () => reject(tx.error ?? req.error);
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

/** Removes everything this app stored on the device ("Delete my data"). */
export async function clear(): Promise<void> {
  await run('readwrite', (s) => s.clear());
}

/** Test hook: forget the open connection. */
export function _reset(): void {
  dbPromise = null;
}

import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { _reset, load, remove, save } from './store';

const route = {
  from: { label: 'Damrak 1', lat: 52.377, lon: 4.898 },
  to: { label: 'Zuid', lat: 52.339, lon: 4.872 },
  window: { start: 450, end: 540 },
};

// A fresh, empty IndexedDB for every test.
beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  _reset();
});

describe('store', () => {
  it('reads nothing on a fresh device', async () => {
    expect(await load('route')).toBeUndefined();
  });

  it('round-trips a value', async () => {
    await save('route', route);
    _reset(); // a new page load
    expect(await load('route')).toEqual(route);
  });

  it('stores a plain copy of proxies (Svelte $state cannot be cloned)', async () => {
    const proxy = new Proxy(route, {});
    await save('route', proxy);
    expect(await load('route')).toEqual(route);
  });

  it('removes a value', async () => {
    await save('lang', 'nl');
    await remove('lang');
    expect(await load('lang')).toBeUndefined();
  });

  it('reads as empty when IndexedDB is unavailable', async () => {
    const original = globalThis.indexedDB;
    _reset();
    // @ts-expect-error: simulate a browser with storage blocked
    globalThis.indexedDB = {
      open: () => {
        throw new Error('blocked');
      },
    };
    try {
      expect(await load('route')).toBeUndefined();
      await expect(save('lang', 'en')).rejects.toThrow('blocked');
    } finally {
      globalThis.indexedDB = original;
      _reset();
    }
  });
});

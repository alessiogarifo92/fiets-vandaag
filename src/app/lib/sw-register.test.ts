import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerServiceWorker } from './sw-register';

function setup(opts: { controller: boolean; register?: () => Promise<unknown> }) {
  const swListeners: Record<string, () => void> = {};
  const docListeners: Record<string, () => void> = {};
  const update = vi.fn().mockResolvedValue(undefined);
  const register = vi.fn(opts.register ?? (() => Promise.resolve({ update })));
  const reload = vi.fn();
  const doc = {
    visibilityState: 'visible',
    addEventListener: (t: string, f: () => void) => (docListeners[t] = f),
  };
  vi.stubGlobal('navigator', {
    serviceWorker: {
      controller: opts.controller ? {} : null,
      addEventListener: (t: string, f: () => void) => (swListeners[t] = f),
      register,
    },
  });
  vi.stubGlobal('location', { reload });
  vi.stubGlobal('document', doc);
  return { swListeners, docListeners, register, reload, update, doc };
}

afterEach(() => vi.unstubAllGlobals());

describe('registerServiceWorker', () => {
  it('registers /sw.js with scope /', () => {
    const { register } = setup({ controller: false });
    registerServiceWorker();
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/' });
  });

  it('does not reload when the first install takes control', () => {
    const { swListeners, reload } = setup({ controller: false });
    registerServiceWorker();
    swListeners.controllerchange!();
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads once when a new deploy takes over a controlled page', () => {
    const { swListeners, reload } = setup({ controller: true });
    registerServiceWorker();
    swListeners.controllerchange!();
    swListeners.controllerchange!();
    expect(reload).toHaveBeenCalledOnce();
  });

  it('checks for a new deploy when the app comes back to the foreground', async () => {
    const { docListeners, update, doc } = setup({ controller: true });
    registerServiceWorker();
    await vi.waitFor(() => expect(docListeners.visibilitychange).toBeDefined());
    docListeners.visibilitychange!();
    expect(update).toHaveBeenCalledOnce();
    doc.visibilityState = 'hidden';
    docListeners.visibilitychange!();
    expect(update).toHaveBeenCalledOnce();
  });

  it('swallows a failed registration (the app works without offline support)', async () => {
    const { register } = setup({ controller: false, register: () => Promise.reject(new Error('blocked')) });
    expect(() => registerServiceWorker()).not.toThrow();
    await expect(register.mock.results[0]!.value).rejects.toThrow('blocked');
  });

  it('does nothing without service-worker support', () => {
    vi.stubGlobal('navigator', {});
    expect(() => registerServiceWorker()).not.toThrow();
  });
});

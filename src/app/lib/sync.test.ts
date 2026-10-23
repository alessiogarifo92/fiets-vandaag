import { describe, expect, it, vi } from 'vitest';
import { onAppOpen } from './sync';

describe('onAppOpen', () => {
  it('runs every step in order, each one even when an earlier one fails', async () => {
    const order: string[] = [];
    const steps = {
      resyncPush: vi.fn(async () => {
        order.push('push');
        throw new Error('offline');
      }),
      logOpen: vi.fn(async () => {
        order.push('open');
        throw new Error('offline');
      }),
      syncRoute: vi.fn(async () => {
        order.push('route');
      }),
    };
    const now = new Date('2026-10-22T06:00:00Z');
    await expect(onAppOpen(now, steps)).resolves.toBeUndefined();
    expect(order).toEqual(['push', 'open', 'route']);
    expect(steps.logOpen).toHaveBeenCalledWith(now);
  });
});

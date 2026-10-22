import { describe, expect, it } from 'vitest';
import { matchPath } from './router';

describe('matchPath', () => {
  it.each([
    ['/api/health', '/api/health', { param: '' }],
    ['/api/health', '/api/health/', null],
    ['/api/routes/:slot', '/api/routes/1', { param: '1' }],
    ['/api/routes/:slot', '/api/routes/', null],
    ['/api/routes/:slot', '/api/routes/1/x', null],
    ['/api/routes/:slot', '/api/routes/%31', { param: '1' }],
    ['/api/routes/:slot', '/api/routes/%E0%A4%A', null],
    ['/api/devices/me', '/api/devices/you', null],
  ])('%s vs %s', (pattern, path, expected) => {
    expect(matchPath(pattern, path)).toEqual(expected);
  });
});

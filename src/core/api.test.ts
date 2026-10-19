import { describe, expect, it } from 'vitest';
import { apiError, isHealthResponse } from './api';

describe('apiError', () => {
  it('builds the error shape without fields', () => {
    expect(apiError('not_found', 'No such route')).toEqual({
      error: { code: 'not_found', message: 'No such route' },
    });
  });

  it('keeps field errors when given', () => {
    expect(apiError('invalid', 'Bad input', { slot: 'must be 1 or 2' })).toEqual({
      error: { code: 'invalid', message: 'Bad input', fields: { slot: 'must be 1 or 2' } },
    });
  });
});

describe('isHealthResponse', () => {
  it('accepts a valid health body', () => {
    expect(isHealthResponse({ ok: true, version: '0.0.1+abc1234' })).toBe(true);
  });

  it.each([
    ['null', null],
    ['a string', 'ok'],
    ['ok false', { ok: false, version: '1' }],
    ['ok truthy but not true', { ok: 1, version: '1' }],
    ['missing version', { ok: true }],
    ['empty version', { ok: true, version: '' }],
    ['numeric version', { ok: true, version: 1 }],
  ])('rejects %s', (_label, value) => {
    expect(isHealthResponse(value)).toBe(false);
  });
});

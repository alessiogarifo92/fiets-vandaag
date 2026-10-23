import { describe, expect, it } from 'vitest';
import { readInvite } from './invite';

describe('readInvite', () => {
  it('takes the invite out of the URL, keeping the rest', () => {
    expect(readInvite('https://app.test/?invite=abc123&x=1#/setup')).toEqual({
      invite: 'abc123',
      clean: '/?x=1#/setup',
    });
    expect(readInvite('https://app.test/?invite=a%20b')).toEqual({ invite: 'a b', clean: '/' });
  });

  it('leaves a URL without an invite untouched', () => {
    expect(readInvite('https://app.test/#/today')).toEqual({
      invite: null,
      clean: 'https://app.test/#/today',
    });
  });

  it('drops an empty or over-long invite but still cleans the URL', () => {
    expect(readInvite('https://app.test/?invite=')).toEqual({ invite: null, clean: '/' });
    expect(readInvite(`https://app.test/?invite=${'x'.repeat(129)}`)).toEqual({ invite: null, clean: '/' });
  });
});

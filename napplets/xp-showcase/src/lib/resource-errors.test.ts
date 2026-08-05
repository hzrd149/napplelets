import { describe, expect, it } from 'vitest';

import { RESOURCE_ERROR_CODES, explainResourceFailure, resourceErrorCode } from './resource-errors';

describe('resourceErrorCode', () => {
  it('prefers a real code property, for when the package starts attaching one', () => {
    const error = Object.assign(new Error('anything at all'), { code: 'too-large' });
    expect(resourceErrorCode(error)).toBe('too-large');
  });

  it('parses the code the current shim welds onto the message', () => {
    // resource/shim.js rejects with `new Error(`${err.error}: ${err.message}`).
    expect(resourceErrorCode(new Error('blocked-by-policy: host not allowed'))).toBe(
      'blocked-by-policy',
    );
  });

  it('parses a code-only message, which is what the shim sends with no detail', () => {
    expect(resourceErrorCode(new Error('not-found'))).toBe('not-found');
  });

  it('recognises every code in the NAP-RESOURCE set', () => {
    for (const code of RESOURCE_ERROR_CODES) {
      expect(resourceErrorCode(new Error(`${code}: detail`))).toBe(code);
    }
  });

  it('does not invent a code from arbitrary prose', () => {
    expect(resourceErrorCode(new Error('something went wrong: badly'))).toBe('unknown');
  });

  it('ignores a code property that is not one of ours', () => {
    const error = Object.assign(new Error('not-found'), { code: 'ENOENT' });
    expect(resourceErrorCode(error)).toBe('not-found');
  });

  it('survives a rejection that is not an Error at all', () => {
    expect(resourceErrorCode('timeout: gave up')).toBe('timeout');
    expect(resourceErrorCode(undefined)).toBe('unknown');
    expect(resourceErrorCode(null)).toBe('unknown');
    expect(resourceErrorCode({ message: 42 })).toBe('unknown');
  });
});

describe('explainResourceFailure', () => {
  it('has a sentence for every code, including the catch-all', () => {
    for (const code of [...RESOURCE_ERROR_CODES, 'unknown' as const]) {
      expect(explainResourceFailure(code)).toBeTruthy();
    }
  });
});

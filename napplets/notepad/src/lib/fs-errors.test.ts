import { describe, expect, it } from 'vitest';

import { describeFsError, isCancelled, isConflict, isUnavailable } from './fs-errors';

/** Every member of the `FsError` union in @napplet/core. */
const ALL_CODES = [
  'not-found',
  'already-exists',
  'not-a-file',
  'not-a-directory',
  'invalid-path',
  'invalid-data',
  'permission-denied',
  'policy-denied',
  'quota-exceeded',
  'too-large',
  'unsupported',
  'conflict',
  'cancelled',
  'io-error',
];

describe('describeFsError', () => {
  it('has a sentence for every FsError code', () => {
    for (const code of ALL_CODES) {
      const message = describeFsError(new Error(code));
      expect(message, code).not.toBe(code);
      expect(message.endsWith('.'), code).toBe(true);
    }
  });

  it('shortens the SDK’s missing-domain throw', () => {
    const error = new Error(
      'window.napplet.fs is unavailable -- runtime did not inject this domain',
    );
    expect(describeFsError(error)).toBe('This shell did not grant filesystem access.');
  });

  it('passes an unrecognised reason through rather than inventing one', () => {
    // A runtime may grow a reason this build has never heard of; saying the raw
    // code is still true, whereas a generic message would not be.
    expect(describeFsError(new Error('teapot'))).toBe('teapot');
  });

  it('handles a rejection that is not an Error', () => {
    expect(describeFsError('not-found')).toBe('The file no longer exists.');
  });
});

describe('predicates', () => {
  it('detects cancellation, which NAP-FS models as an error', () => {
    // Without this, dismissing the Open dialog would raise an error box.
    expect(isCancelled(new Error('cancelled'))).toBe(true);
    expect(isCancelled(new Error('not-found'))).toBe(false);
  });

  it('detects a stale-revision conflict', () => {
    expect(isConflict(new Error('conflict'))).toBe(true);
    expect(isConflict(new Error('permission-denied'))).toBe(false);
  });

  it('detects an absent fs domain', () => {
    expect(isUnavailable(new Error('window.napplet.fs is unavailable -- ...'))).toBe(true);
    expect(isUnavailable(new Error('io-error'))).toBe(false);
  });
});

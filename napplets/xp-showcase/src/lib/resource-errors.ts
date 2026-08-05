/**
 * Reading the typed failure out of a NAP-RESOURCE rejection.
 *
 * NAP-RESOURCE defines a closed set of error codes precisely so callers can
 * branch on the code rather than on prose. The current shim, though, rejects
 * with a plain `Error` whose message is `"<code>"` or `"<code>: <detail>"` --
 * `resource/shim.js` builds it as
 * `new Error(err.message ? `${err.error}: ${err.message}` : err.error)` -- so
 * the code arrives welded to the front of the message and there is no other
 * place to get it from.
 *
 * This function is that seam, in one place: it prefers a real `code` property
 * if a later package version starts attaching one, and only then falls back to
 * parsing. Nothing else in the napplet looks at a resource error message.
 */

/** `ResourceErrorCode` from `@napplet/core`, plus our own catch-all. */
export const RESOURCE_ERROR_CODES = [
  'invalid-request',
  'not-found',
  'blocked-by-policy',
  'timeout',
  'too-large',
  'unsupported-scheme',
  'decode-failed',
  'network-error',
  'quota-exceeded',
] as const;

export type KnownResourceErrorCode = (typeof RESOURCE_ERROR_CODES)[number];
export type ResourceFailureCode = KnownResourceErrorCode | 'unknown';

function isKnown(value: string): value is KnownResourceErrorCode {
  return (RESOURCE_ERROR_CODES as readonly string[]).includes(value);
}

function readString(error: unknown, key: 'code' | 'message'): string {
  if (typeof error !== 'object' || error === null) return '';
  const value = (error as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

export function resourceErrorCode(error: unknown): ResourceFailureCode {
  const code = readString(error, 'code');
  if (isKnown(code)) return code;

  const message = typeof error === 'string' ? error : readString(error, 'message');
  const head = (message.split(':')[0] ?? '').trim();
  return isKnown(head) ? head : 'unknown';
}

/** Plain-language reason, for a status line a reader can act on. */
export function explainResourceFailure(code: ResourceFailureCode): string {
  switch (code) {
    case 'blocked-by-policy':
      return 'the shell’s resource policy refused this URL';
    case 'not-found':
      return 'the shell could not find it';
    case 'timeout':
      return 'the shell timed out fetching it';
    case 'too-large':
      return 'it exceeds the shell’s size limit';
    case 'unsupported-scheme':
      return 'the shell has no handler for that URL scheme';
    case 'decode-failed':
      return 'the bytes arrived but would not decode';
    case 'network-error':
      return 'the shell’s fetch failed';
    case 'quota-exceeded':
      return 'this napplet is over its resource quota';
    case 'invalid-request':
      return 'the shell rejected the request as malformed';
    case 'unknown':
      return 'the shell reported no recognised error code';
  }
}

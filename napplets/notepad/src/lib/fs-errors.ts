/**
 * NAP-FS rejections, turned into something a Notepad user can act on.
 *
 * `FsError` is a closed string union on the wire, and the SDK rejects with an
 * `Error` whose `message` is the bare code (`'permission-denied'`, …). Anything
 * unrecognised is passed through rather than replaced, so a runtime that grows
 * a new reason still says something true.
 */

/** Every member of the `FsError` union. `file-browser`'s map covers 10 of these. */
const MESSAGES: Record<string, string> = {
  'not-found': 'The file no longer exists.',
  'already-exists': 'A file with that name already exists.',
  'not-a-file': 'That path is not a file.',
  'not-a-directory': 'That path is not a folder.',
  'invalid-path': 'That path is not valid.',
  'invalid-data': 'The filesystem rejected the file contents.',
  'permission-denied': 'Permission denied by the filesystem.',
  'policy-denied': 'The shell policy denied this operation.',
  'quota-exceeded': 'There is no space left to save the file.',
  'too-large': 'The file is too large for this operation.',
  unsupported: 'The filesystem does not support this operation.',
  conflict: 'The file changed before the operation completed.',
  cancelled: 'The operation was cancelled.',
  'io-error': 'The filesystem could not complete the operation.',
};

function codeOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function describeFsError(error: unknown): string {
  const code = codeOf(error);
  const known = MESSAGES[code];
  if (known) return known;
  // The SDK's own throw when the runtime injected no `fs` -- long, lowercase and
  // aimed at a developer. Users get the short version.
  if (code.includes('is unavailable')) return 'This shell did not grant filesystem access.';
  return code;
}

/**
 * A cancelled picker is a decision, not a failure.
 *
 * NAP-FS models cancellation as an error rather than an empty result, so
 * without this check every dismissed Open dialog would raise an error box.
 */
export function isCancelled(error: unknown): boolean {
  return codeOf(error) === 'cancelled';
}

/** A stale-`ifRevision` write. Routed to the conflict dialog, not the error box. */
export function isConflict(error: unknown): boolean {
  return codeOf(error) === 'conflict';
}

/** Whether the failure means the `fs` domain is not there at all. */
export function isUnavailable(error: unknown): boolean {
  return codeOf(error).includes('is unavailable');
}

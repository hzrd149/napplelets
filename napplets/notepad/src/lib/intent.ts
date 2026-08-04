/**
 * The NAP-INTENT handler side: turning an inbound request into an open.
 *
 * Notepad declares the `text-editor` archetype in its manifest, so a shell can
 * resolve it as the handler when another napplet dispatches an intent for that
 * role. The payload arrives shaped by the request's `convention`.
 *
 * Both `open` and `edit` are handled, on one convention each. They mean the
 * same thing here and deliberately so: Notepad has no read-only mode, so a
 * caller asking to `open` a text file and a caller asking to `edit` one both
 * end up with the file in the editor. Declaring only `open` would make callers
 * that reach for the more precise action fall through to no handler at all.
 *
 * The payload is untrusted input from another napplet, which is why this module
 * exists: a bad payload must produce a message, never a throw.
 */

/** The actions this napplet handles. `open` is the NAP-INTENT default. */
export const ACTIONS = ['open', 'edit'] as const;
export type IntentAction = (typeof ACTIONS)[number];

/** The archetype slug this napplet fulfils. */
export const ARCHETYPE = 'text-editor';

/** One convention per action, in the `napplet:<archetype>/<action>` form. */
export const CONVENTIONS = ACTIONS.map((action) => `napplet:${ARCHETYPE}/${action}` as const);

export type OpenIntent = {
  /** Virtual absolute NAP-FS path to open. */
  path: string;
  /** 1-based line to put the caret on, when the caller asked for one. */
  line?: number;
};

/**
 * The reason a request was rejected, phrased for the user rather than the
 * caller -- the person looking at Notepad is the one who sees it.
 */
export type IntentProblem = { problem: string };

export type ParsedIntent = OpenIntent | IntentProblem;

export const isProblem = (value: ParsedIntent): value is IntentProblem => 'problem' in value;

/** Whether this napplet handles `action`. An absent action means `open`. */
export function handlesAction(action: string | undefined): boolean {
  return ACTIONS.includes((action ?? 'open') as IntentAction);
}

/**
 * NAP-FS paths are virtual absolute paths. Rejecting anything else here keeps a
 * malformed caller from reaching `fs.stat` with a relative path, and rejecting
 * `..` segments keeps the runtime's own path resolution from being asked to
 * walk out of a root -- the shell would refuse anyway, but failing here says
 * something useful instead of surfacing a runtime error.
 */
function validatePath(value: string): string | null {
  if (!value.startsWith('/')) return 'The path must be an absolute path.';
  if (value.includes('\0')) return 'The path contains invalid characters.';
  if (value.split('/').includes('..')) return 'The path cannot contain "..".';
  return null;
}

/**
 * Parses an intent payload into an open request.
 *
 * A bare string is accepted as sugar for `{ path }`: NAAT describes invocation
 * query parameters becoming payload data, so a caller that has nothing but a
 * path should not have to wrap it.
 */
export function parseOpenIntent(payload: unknown): ParsedIntent {
  const record =
    typeof payload === 'string'
      ? { path: payload }
      : typeof payload === 'object' && payload !== null
        ? (payload as Record<string, unknown>)
        : null;

  if (!record) return { problem: 'Another napplet asked Notepad to open a file, but sent no path.' };

  const path = record.path;
  if (typeof path !== 'string' || !path) {
    return { problem: 'Another napplet asked Notepad to open a file, but sent no path.' };
  }

  const invalid = validatePath(path);
  if (invalid) return { problem: `Another napplet asked Notepad to open "${path}".\n${invalid}` };

  // An absent line is the common case and not an error. A present-but-nonsense
  // one is ignored rather than refused: the file is still what was asked for,
  // and refusing to open it over a bad line number would be the worse outcome.
  const raw = record.line;
  const line = typeof raw === 'number' && Number.isInteger(raw) && raw >= 1 ? raw : undefined;

  return line === undefined ? { path } : { path, line };
}

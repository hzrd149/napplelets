/**
 * What survives a reload, and how it is read back.
 *
 * NAP-FS holds the documents; NAP-STORAGE holds only the editor's own state --
 * which file was open, an unsaved buffer, and the word-wrap preference (which
 * would have lived in NAP-CONFIG had this napplet asked for it).
 *
 * Storage is shared, long-lived, and survives napplet upgrades, so everything
 * in it is untrusted input: a malformed record returns `null` rather than
 * throwing and taking the editor down on boot.
 */

import { DEFAULT_EOL, type Eol } from './text';

export const SESSION_KEY = 'session';

/**
 * NAP-STORAGE quota is 512 KB shared with everything else this napplet keeps,
 * and the buffer is stored as JSON-escaped text. Past this, the text is dropped
 * and only the path is remembered -- and the user is told, rather than
 * discovering it after the fact.
 */
export const MAX_SESSION_CHARS = 128 * 1024;

export type Session = {
  /** Virtual path of the open file, or null for an untitled buffer. */
  path: string | null;
  /** The buffer, only when it was unsaved and small enough to keep. */
  text: string | null;
  dirty: boolean;
  eol: Eol;
  bom: boolean;
  wordWrap: boolean;
  /** Directory the file dialog should open in next time. */
  lastDir: string | null;
};

export const DEFAULT_SESSION: Session = {
  path: null,
  text: null,
  dirty: false,
  eol: DEFAULT_EOL,
  bom: false,
  wordWrap: true,
  lastDir: null,
};

function optionalString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

export function parseSession(raw: string | null | undefined): Session | null {
  if (!raw) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;

  return {
    path: optionalString(record.path),
    text: typeof record.text === 'string' ? record.text : null,
    dirty: record.dirty === true,
    eol: record.eol === '\n' ? '\n' : '\r\n',
    bom: record.bom === true,
    // Absent means "never set", and word wrap was on by default in XP.
    wordWrap: record.wordWrap === undefined ? true : record.wordWrap === true,
    lastDir: optionalString(record.lastDir),
  };
}

export type SerializedSession = { raw: string; textDropped: boolean };

/**
 * Serialises for storage, dropping an oversized buffer rather than failing the
 * write outright. The caller is told so it can say so.
 *
 * A clean buffer is never stored: the file on disk is the source of truth, and
 * re-reading it on boot is both cheaper and more correct than trusting a copy.
 */
export function serializeSession(session: Session): SerializedSession {
  const keepText = session.dirty && session.text !== null;
  const textDropped = keepText && session.text!.length > MAX_SESSION_CHARS;
  const payload: Session = {
    ...session,
    text: keepText && !textDropped ? session.text : null,
    dirty: keepText && !textDropped ? session.dirty : false,
  };
  return { raw: JSON.stringify(payload), textDropped };
}

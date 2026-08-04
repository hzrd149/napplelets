import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SESSION,
  MAX_SESSION_CHARS,
  parseSession,
  serializeSession,
  type Session,
} from './session';

const session = (overrides: Partial<Session> = {}): Session => ({
  ...DEFAULT_SESSION,
  ...overrides,
});

describe('parseSession', () => {
  it('round-trips a dirty buffer', () => {
    const original = session({ path: '/docs/a.txt', text: 'hi', dirty: true, eol: '\n' });
    expect(parseSession(serializeSession(original).raw)).toEqual(original);
  });

  it('returns null for anything unusable rather than throwing on boot', () => {
    // Storage is shared and long-lived, so its contents are untrusted input.
    expect(parseSession(null)).toBeNull();
    expect(parseSession('')).toBeNull();
    expect(parseSession('{ not json')).toBeNull();
    expect(parseSession('"a string"')).toBeNull();
    expect(parseSession('null')).toBeNull();
  });

  it('fills in defaults for a partial record', () => {
    const parsed = parseSession('{"path":"/a.txt"}');
    expect(parsed).toEqual(session({ path: '/a.txt' }));
  });

  it('defaults word wrap on when absent, as XP did', () => {
    expect(parseSession('{}')?.wordWrap).toBe(true);
    expect(parseSession('{"wordWrap":false}')?.wordWrap).toBe(false);
  });

  it('coerces wrong-typed fields instead of trusting them', () => {
    const parsed = parseSession('{"path":42,"dirty":"yes","eol":"\\r","bom":1,"text":[]}');
    expect(parsed).toEqual(session({ path: null, dirty: false, eol: '\r\n', bom: false }));
  });
});

describe('serializeSession', () => {
  it('drops a clean buffer, because the file on disk is the source of truth', () => {
    const stored = parseSession(
      serializeSession(session({ path: '/a.txt', text: 'saved', dirty: false })).raw,
    );
    expect(stored?.text).toBeNull();
    expect(stored?.path).toBe('/a.txt');
  });

  it('drops an oversized buffer and says so', () => {
    const huge = 'x'.repeat(MAX_SESSION_CHARS + 1);
    const result = serializeSession(session({ path: '/a.txt', text: huge, dirty: true }));
    expect(result.textDropped).toBe(true);

    // Dropping the text must also drop the dirty flag, or the next boot would
    // claim there are unsaved changes it cannot show.
    const stored = parseSession(result.raw);
    expect(stored?.text).toBeNull();
    expect(stored?.dirty).toBe(false);
  });

  it('keeps a buffer that fits', () => {
    const text = 'x'.repeat(MAX_SESSION_CHARS);
    const result = serializeSession(session({ text, dirty: true }));
    expect(result.textDropped).toBe(false);
    expect(parseSession(result.raw)?.text).toBe(text);
  });

  it('preserves the last directory even with no open file', () => {
    const stored = parseSession(serializeSession(session({ lastDir: '/docs' })).raw);
    expect(stored?.lastDir).toBe('/docs');
  });
});

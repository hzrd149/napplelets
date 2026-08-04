import { describe, expect, it } from 'vitest';

import { isProblem, parseOpenIntent, type ParsedIntent } from './intent';

/** Unwraps a parse that is expected to have succeeded. */
const opened = (result: ParsedIntent) => {
  if (isProblem(result)) throw new Error(`expected an open request, got: ${result.problem}`);
  return result;
};

describe('parseOpenIntent', () => {
  it('accepts a path', () => {
    expect(opened(parseOpenIntent({ path: '/docs/notes.txt' }))).toEqual({
      path: '/docs/notes.txt',
    });
  });

  it('accepts a bare string as sugar for a path', () => {
    expect(opened(parseOpenIntent('/docs/notes.txt'))).toEqual({ path: '/docs/notes.txt' });
  });

  it('carries a line number when one is asked for', () => {
    expect(opened(parseOpenIntent({ path: '/logs/build.log', line: 42 }))).toEqual({
      path: '/logs/build.log',
      line: 42,
    });
  });

  it('ignores extra fields a caller sends', () => {
    expect(opened(parseOpenIntent({ path: '/a.txt', mode: 'readonly', column: 3 }))).toEqual({
      path: '/a.txt',
    });
  });

  it('ignores an unusable line rather than refusing the file', () => {
    // The file is still what was asked for; refusing it over a bad line number
    // would be the worse outcome.
    for (const line of [0, -1, 1.5, '7', null, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(opened(parseOpenIntent({ path: '/a.txt', line }))).toEqual({ path: '/a.txt' });
    }
  });

  it('reports a problem instead of throwing on any unusable payload', () => {
    // The payload arrives from another napplet, so it is untrusted input.
    for (const payload of [undefined, null, 42, [], {}, '', { path: '' }, { path: 7 }]) {
      expect(isProblem(parseOpenIntent(payload))).toBe(true);
    }
  });

  it('rejects a path that is not a virtual absolute path', () => {
    const result = parseOpenIntent({ path: 'notes.txt' });
    expect(isProblem(result)).toBe(true);
    expect(isProblem(result) && result.problem).toContain('absolute');
  });

  it('rejects traversal segments rather than handing them to the runtime', () => {
    const result = parseOpenIntent({ path: '/docs/../../etc/passwd' });
    expect(isProblem(result)).toBe(true);
    expect(isProblem(result) && result.problem).toContain('..');
  });

  it('allows dots inside a name, which are ordinary', () => {
    expect(opened(parseOpenIntent({ path: '/docs/..hidden/a..b.txt' }))).toEqual({
      path: '/docs/..hidden/a..b.txt',
    });
  });

  it('rejects a NUL byte', () => {
    expect(isProblem(parseOpenIntent({ path: '/docs/a\0.txt' }))).toBe(true);
  });
});

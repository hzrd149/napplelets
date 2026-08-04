import { describe, expect, it } from 'vitest';

import {
  base64ToBytes,
  buildLineIndex,
  bytesToBase64,
  concatBytes,
  decodeText,
  encodeText,
  findNext,
  indexOfLine,
  lineColFromIndex,
  replaceAll,
} from './text';

const utf8 = (value: string): Uint8Array => new TextEncoder().encode(value);
const BOM = String.fromCharCode(0xfeff);

describe('base64', () => {
  it('round-trips arbitrary bytes', () => {
    const bytes = new Uint8Array([0, 1, 127, 128, 255, 65, 66]);
    expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([...bytes]);
  });

  it('emits standard padded base64', () => {
    expect(bytesToBase64(utf8('hi'))).toBe('aGk=');
  });

  it('encodes a payload far past the argument-spread limit', () => {
    // `String.fromCharCode(...bytes)` blows the call stack around 100k args, so
    // the encoder chunks. A 2 MiB file is the size this has to survive.
    const bytes = new Uint8Array(2 * 1024 * 1024).fill(97);
    const encoded = bytesToBase64(bytes);
    expect(base64ToBytes(encoded).length).toBe(bytes.length);
  });

  it('concatenates read chunks in order', () => {
    const joined = concatBytes([utf8('one '), utf8('two '), utf8('three')]);
    expect(new TextDecoder().decode(joined)).toBe('one two three');
  });
});

describe('decodeText', () => {
  it('reports CRLF and normalises the buffer to LF', () => {
    const decoded = decodeText(utf8('a\r\nb\r\nc'));
    expect(decoded).toEqual({ text: 'a\nb\nc', eol: '\r\n', bom: false });
  });

  it('reports LF when there is no carriage return', () => {
    expect(decodeText(utf8('a\nb'))?.eol).toBe('\n');
  });

  it('treats a mixed-ending file as CRLF', () => {
    // Normalising toward LF would silently rewrite the CRLF lines on save.
    expect(decodeText(utf8('a\r\nb\nc'))?.eol).toBe('\r\n');
  });

  it('strips a BOM but remembers it', () => {
    const decoded = decodeText(utf8(`${BOM}hello`));
    expect(decoded?.text).toBe('hello');
    expect(decoded?.bom).toBe(true);
  });

  it('refuses invalid UTF-8 rather than producing replacement characters', () => {
    // Opening this as mojibake would corrupt the file the moment it was saved.
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0x41]))).toBeNull();
  });

  it('refuses bytes containing NUL', () => {
    expect(decodeText(new Uint8Array([0x41, 0x00, 0x42]))).toBeNull();
  });

  it('accepts an empty file', () => {
    expect(decodeText(new Uint8Array())).toEqual({ text: '', eol: '\n', bom: false });
  });

  it('handles multi-byte text', () => {
    expect(decodeText(utf8('héllo 世界 🎉'))?.text).toBe('héllo 世界 🎉');
  });
});

describe('encodeText', () => {
  it('round-trips a CRLF file byte-for-byte', () => {
    const original = utf8('one\r\ntwo\r\n');
    const decoded = decodeText(original)!;
    expect([...encodeText(decoded.text, decoded)]).toEqual([...original]);
  });

  it('round-trips a BOM + CRLF file byte-for-byte', () => {
    const original = utf8(`${BOM}alpha\r\nbeta`);
    const decoded = decodeText(original)!;
    expect([...encodeText(decoded.text, decoded)]).toEqual([...original]);
  });

  it('round-trips an LF file without introducing carriage returns', () => {
    const original = utf8('one\ntwo\n');
    const decoded = decodeText(original)!;
    expect([...encodeText(decoded.text, decoded)]).toEqual([...original]);
  });
});

describe('findNext', () => {
  const text = 'the cat sat on the mat';

  it('finds forwards from an offset', () => {
    expect(findNext(text, 'the', 0)).toBe(0);
    expect(findNext(text, 'the', 1)).toBe(15);
  });

  it('ignores case unless asked', () => {
    expect(findNext('Hello', 'hello', 0)).toBe(0);
    expect(findNext('Hello', 'hello', 0, { matchCase: true })).toBe(-1);
  });

  it('returns -1 past the last match without wrap, and wraps when asked', () => {
    expect(findNext(text, 'the', 16)).toBe(-1);
    expect(findNext(text, 'the', 16, { wrap: true })).toBe(0);
  });

  it('searches backwards from the caret', () => {
    expect(findNext(text, 'the', 15, { backwards: true })).toBe(0);
    expect(findNext(text, 'the', 0, { backwards: true })).toBe(-1);
    expect(findNext(text, 'the', 0, { backwards: true, wrap: true })).toBe(15);
  });

  it('never matches an empty needle', () => {
    expect(findNext(text, '', 0, { wrap: true })).toBe(-1);
  });

  it('keeps offsets exact when case folding would change length', () => {
    // U+0130 lowercases to two code points; a naive toLowerCase() haystack
    // would shift every later match by one and land the caret in the wrong place.
    const tricky = 'İstanbul needle';
    expect(tricky.slice(findNext(tricky, 'needle', 0), findNext(tricky, 'needle', 0) + 6)).toBe(
      'needle',
    );
  });
});

describe('replaceAll', () => {
  it('replaces every occurrence and counts them', () => {
    expect(replaceAll('a-a-a', 'a', 'b')).toEqual({ text: 'b-b-b', count: 3 });
  });

  it('does not re-match inside its own replacement', () => {
    expect(replaceAll('aa', 'a', 'aa')).toEqual({ text: 'aaaa', count: 2 });
  });

  it('honours match case', () => {
    expect(replaceAll('Cat cat', 'cat', 'dog', { matchCase: true }).count).toBe(1);
    expect(replaceAll('Cat cat', 'cat', 'dog').count).toBe(2);
  });

  it('preserves the original casing of untouched text', () => {
    expect(replaceAll('Cat CAT', 'cat', 'dog').text).toBe('dog dog');
  });

  it('is a no-op for an empty needle', () => {
    expect(replaceAll('abc', '', 'x')).toEqual({ text: 'abc', count: 0 });
  });
});

describe('line index', () => {
  const text = 'one\ntwo\nthree';
  const offsets = buildLineIndex(text);

  it('records a start offset per line', () => {
    expect(offsets).toEqual([0, 4, 8]);
  });

  it('maps offsets to 1-based line and column', () => {
    expect(lineColFromIndex(0, offsets)).toEqual({ line: 1, col: 1 });
    expect(lineColFromIndex(4, offsets)).toEqual({ line: 2, col: 1 });
    expect(lineColFromIndex(6, offsets)).toEqual({ line: 2, col: 3 });
  });

  it('is correct at the very end of the last line', () => {
    expect(lineColFromIndex(text.length, offsets)).toEqual({ line: 3, col: 6 });
  });

  it('puts the caret on a trailing empty line', () => {
    const trailing = buildLineIndex('a\n');
    expect(lineColFromIndex(2, trailing)).toEqual({ line: 2, col: 1 });
  });

  it('treats an empty document as line 1', () => {
    expect(lineColFromIndex(0, buildLineIndex(''))).toEqual({ line: 1, col: 1 });
  });

  it('resolves a line number back to an offset, clamping out-of-range input', () => {
    expect(indexOfLine(2, offsets)).toBe(4);
    expect(indexOfLine(0, offsets)).toBe(0);
    expect(indexOfLine(999, offsets)).toBe(8);
  });
});

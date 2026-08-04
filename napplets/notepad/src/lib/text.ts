/**
 * The editor's brain: byte<->text conversion, search, and line arithmetic.
 *
 * Pure functions only, no DOM. NAP-FS moves bytes as RFC 4648 padded base64 in
 * both directions -- there is no `Uint8Array` anywhere in its API -- so every
 * open and save round-trips through here.
 */

/** Notepad refuses files it cannot put in a `<textarea>` without hanging it. */
export const MAX_OPEN_BYTES = 2 * 1024 * 1024;

export type Eol = '\r\n' | '\n';

/** What Windows Notepad wrote. New files inherit it; opened files keep their own. */
export const DEFAULT_EOL: Eol = '\r\n';

/** U+FEFF. Built numerically: a raw BOM in source is invisible and easily lost. */
const BOM_CODE = 0xfeff;
const BOM = String.fromCharCode(BOM_CODE);

export type DecodedText = {
  /** Line endings normalised to `\n`, which is what a textarea's value uses. */
  text: string;
  /** The dominant line ending in the file, re-applied on save. */
  eol: Eol;
  /** Whether the file began with a UTF-8 BOM, re-emitted on save. */
  bom: boolean;
};

/* ── Bytes ───────────────────────────────────────────────────────────── */

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * The encoder NAP-FS needs and `file-browser` never had to write -- it only
 * ever creates empty files.
 *
 * Chunked because `String.fromCharCode(...bytes)` spreads every byte into an
 * argument list and blows the call stack somewhere around 100k bytes. A 2 MiB
 * file would crash it outright.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let index = 0; index < bytes.length; index += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK));
  }
  return btoa(binary);
}

export function concatBytes(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/* ── Text ────────────────────────────────────────────────────────────── */

/**
 * Decodes file bytes, or returns `null` when they are not editable text.
 *
 * `fatal: true` makes the decoder throw on malformed UTF-8 instead of littering
 * the buffer with U+FFFD, which is the difference between refusing a binary
 * file and silently corrupting it the moment the user hits Save. An embedded
 * NUL is the second binary tell -- valid UTF-8, but never a text file.
 *
 * Line endings and the BOM are recorded rather than discarded: opening a CRLF
 * file and saving it back must not rewrite every line in it.
 */
export function decodeText(bytes: Uint8Array): DecodedText | null {
  let raw: string;
  try {
    // `ignoreBOM: true` is a misleading name -- it means "do not strip the BOM",
    // which is exactly what we want. The default swallows it silently, and a BOM
    // we never saw is a BOM we would drop on the next save.
    raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    return null;
  }
  if (raw.includes('\0')) return null;

  const bom = raw.charCodeAt(0) === BOM_CODE;
  const body = bom ? raw.slice(1) : raw;

  // A file is CRLF if any of its line endings are -- mixed endings are almost
  // always a CRLF file something touched carelessly, and normalising toward LF
  // would finish the job.
  const eol: Eol = body.includes('\r\n') ? '\r\n' : '\n';

  return { text: body.replace(/\r\n/g, '\n').replace(/\r/g, '\n'), eol, bom };
}

export function encodeText(text: string, options: { eol: Eol; bom: boolean }): Uint8Array {
  const body = options.eol === '\r\n' ? text.replace(/\n/g, '\r\n') : text;
  return new TextEncoder().encode(options.bom ? `${BOM}${body}` : body);
}

/* ── Search ──────────────────────────────────────────────────────────── */

/**
 * Lowercases without moving any index.
 *
 * `String.prototype.toLowerCase()` is not length-preserving for every code
 * point (U+0130 LATIN CAPITAL LETTER I WITH DOT ABOVE lowercases to two code
 * points), and a haystack that changes length silently misaligns every match
 * offset against the original text. Folding per code point and keeping the
 * original wherever the length would change costs nothing on real input and
 * makes the offsets exact.
 */
function fold(value: string): string {
  let out = '';
  for (const ch of value) {
    const lower = ch.toLowerCase();
    out += lower.length === ch.length ? lower : ch;
  }
  return out;
}

export type FindOptions = { matchCase?: boolean; backwards?: boolean; wrap?: boolean };

/** Index of the next match, or -1. `from` is where the search starts. */
export function findNext(
  text: string,
  needle: string,
  from: number,
  options: FindOptions = {},
): number {
  if (!needle) return -1;
  const haystack = options.matchCase ? text : fold(text);
  const target = options.matchCase ? needle : fold(needle);
  const start = Math.max(0, Math.min(from, text.length));

  if (options.backwards) {
    // `lastIndexOf` clamps a negative `fromIndex` to 0 rather than giving up, so
    // searching back from the very start would match position 0 itself.
    const found = start === 0 ? -1 : haystack.lastIndexOf(target, start - 1);
    if (found !== -1) return found;
    return options.wrap ? haystack.lastIndexOf(target) : -1;
  }

  const found = haystack.indexOf(target, start);
  if (found !== -1) return found;
  return options.wrap ? haystack.indexOf(target) : -1;
}

/**
 * Replaces every occurrence, walking the original text so a replacement that
 * contains the search term is not re-matched forever.
 */
export function replaceAll(
  text: string,
  needle: string,
  replacement: string,
  options: { matchCase?: boolean } = {},
): { text: string; count: number } {
  if (!needle) return { text, count: 0 };
  const haystack = options.matchCase ? text : fold(text);
  const target = options.matchCase ? needle : fold(needle);

  let out = '';
  let cursor = 0;
  let count = 0;
  for (;;) {
    const at = haystack.indexOf(target, cursor);
    if (at === -1) break;
    out += text.slice(cursor, at) + replacement;
    cursor = at + target.length;
    count += 1;
  }
  return { text: out + text.slice(cursor), count };
}

/* ── Lines ───────────────────────────────────────────────────────────── */

/**
 * Offsets at which each line starts.
 *
 * Rebuilt once per edit, then binary-searched on every caret move. Computing
 * the line number the obvious way -- counting newlines in `text.slice(0, i)` --
 * would copy the whole buffer on every keystroke.
 */
export function buildLineIndex(text: string): number[] {
  const offsets = [0];
  for (let index = text.indexOf('\n'); index !== -1; index = text.indexOf('\n', index + 1)) {
    offsets.push(index + 1);
  }
  return offsets;
}

/** 1-based line and column for a character offset. */
export function lineColFromIndex(index: number, offsets: number[]): { line: number; col: number } {
  let low = 0;
  let high = offsets.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (offsets[mid]! <= index) low = mid;
    else high = mid - 1;
  }
  return { line: low + 1, col: index - offsets[low]! + 1 };
}

/** Character offset of a 1-based line number, clamped to the document. */
export function indexOfLine(line: number, offsets: number[]): number {
  const clamped = Math.max(1, Math.min(Math.trunc(line), offsets.length));
  return offsets[clamped - 1]!;
}

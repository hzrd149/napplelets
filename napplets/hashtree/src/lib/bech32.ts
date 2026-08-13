/**
 * bech32 decoding and NIP-19-style TLV parsing.
 *
 * Implemented locally rather than pulled from a library because `nhash` uses a
 * custom human-readable part and a TLV namespace that is deliberately *not*
 * NIP-19's (BUD-18 assigns type 5 locally so the root key cannot be confused
 * with NIP-19's relay/author/kind fields). Decoding only — this napplet never
 * mints an identifier.
 *
 * BUD-18 `nhash` uses bech32 (checksum constant 1), not bech32m. Like NIP-19,
 * the classic 90-character length limit is waived: a hash + key payload is 68
 * bytes, which does not fit inside it.
 */

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';

const CHARSET_REVERSE: readonly number[] = (() => {
  const table = new Array<number>(128).fill(-1);
  for (let i = 0; i < CHARSET.length; i += 1) table[CHARSET.charCodeAt(i)] = i;
  return table;
})();

function polymod(values: readonly number[]): number {
  const generator = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let i = 0; i < 5; i += 1) {
      if ((top >>> i) & 1) checksum ^= generator[i]!;
    }
  }
  return checksum;
}

function hrpExpand(hrp: string): number[] {
  const high: number[] = [];
  const low: number[] = [];
  for (let i = 0; i < hrp.length; i += 1) {
    const code = hrp.charCodeAt(i);
    high.push(code >> 5);
    low.push(code & 31);
  }
  return [...high, 0, ...low];
}

/** 5-bit groups to 8-bit bytes. Rejects non-zero padding and oversized remainders. */
function convertBits5to8(data: readonly number[]): Uint8Array | null {
  let accumulator = 0;
  let bits = 0;
  const out: number[] = [];
  for (const value of data) {
    accumulator = (accumulator << 5) | value;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      out.push((accumulator >> bits) & 0xff);
    }
  }
  if (bits >= 5) return null; // more than a byte of leftover padding
  if (((accumulator << (8 - bits)) & 0xff) !== 0) return null; // non-zero padding
  return new Uint8Array(out);
}

export interface Bech32Decoded {
  readonly hrp: string;
  readonly bytes: Uint8Array;
}

/** Returns `null` for anything malformed; every caller is validating user input. */
export function decodeBech32(input: string): Bech32Decoded | null {
  const hasLower = input !== input.toUpperCase();
  const hasUpper = input !== input.toLowerCase();
  if (hasLower && hasUpper) return null; // mixed case is forbidden

  const value = input.toLowerCase();
  const separator = value.lastIndexOf('1');
  if (separator < 1 || separator + 7 > value.length) return null;

  const hrp = value.slice(0, separator);
  for (let i = 0; i < hrp.length; i += 1) {
    const code = hrp.charCodeAt(i);
    if (code < 33 || code > 126) return null;
  }

  const data: number[] = [];
  for (let i = separator + 1; i < value.length; i += 1) {
    const digit = CHARSET_REVERSE[value.charCodeAt(i)] ?? -1;
    if (digit < 0) return null;
    data.push(digit);
  }

  if (polymod([...hrpExpand(hrp), ...data]) !== 1) return null;

  const bytes = convertBits5to8(data.slice(0, -6));
  return bytes === null ? null : { hrp, bytes };
}

/** 8-bit bytes to 5-bit groups, zero-padding the final group. */
function convertBits8to5(bytes: Uint8Array): number[] {
  let accumulator = 0;
  let bits = 0;
  const out: number[] = [];
  for (const byte of bytes) {
    accumulator = (accumulator << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out.push((accumulator >> bits) & 31);
    }
  }
  if (bits > 0) out.push((accumulator << (5 - bits)) & 31);
  return out;
}

/** Encoding exists only so the UI can hand back a shareable `nhash` for a subtree. */
export function encodeBech32(hrp: string, bytes: Uint8Array): string {
  const data = convertBits8to5(bytes);
  const checksum = polymod([...hrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const tail: number[] = [];
  for (let i = 0; i < 6; i += 1) tail.push((checksum >> (5 * (5 - i))) & 31);
  return `${hrp}1${[...data, ...tail].map((value) => CHARSET[value]!).join('')}`;
}

export function encodeTlv(records: readonly TlvRecord[]): Uint8Array {
  let total = 0;
  for (const record of records) total += 2 + record.value.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const record of records) {
    out[offset] = record.type;
    out[offset + 1] = record.value.length;
    out.set(record.value, offset + 2);
    offset += 2 + record.value.length;
  }
  return out;
}

/**
 * NIP-19-style TLV: one byte type, one byte length, `length` bytes of value.
 *
 * Returns records in encounter order. A type may legitimately repeat (NIP-19
 * relay hints do), so this does not collapse duplicates.
 */
export interface TlvRecord {
  readonly type: number;
  readonly value: Uint8Array;
}

export function decodeTlv(bytes: Uint8Array): TlvRecord[] | null {
  const records: TlvRecord[] = [];
  let offset = 0;
  while (offset < bytes.length) {
    if (offset + 2 > bytes.length) return null;
    const type = bytes[offset]!;
    const length = bytes[offset + 1]!;
    const start = offset + 2;
    if (start + length > bytes.length) return null;
    records.push({ type, value: bytes.slice(start, start + length) });
    offset = start + length;
  }
  return records;
}

export function findTlv(records: readonly TlvRecord[], type: number): Uint8Array | undefined {
  return records.find((record) => record.type === type)?.value;
}

export function findAllTlv(records: readonly TlvRecord[], type: number): Uint8Array[] {
  return records.filter((record) => record.type === type).map((record) => record.value);
}

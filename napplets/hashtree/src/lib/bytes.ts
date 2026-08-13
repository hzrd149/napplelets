/**
 * Byte and hex helpers.
 *
 * Blossom addresses blobs by lowercase hex SHA-256, while BUD-16 manifests carry
 * the same 32 bytes as MessagePack `bin`. Hex is the canonical form everywhere
 * outside the manifest encoding, so it doubles as the cache/map key.
 */

const HEX_ALPHABET = '0123456789abcdef';

const HEX_LOOKUP: number[] = (() => {
  const table = new Array<number>(128).fill(-1);
  for (let i = 0; i < 10; i += 1) table[0x30 + i] = i;
  for (let i = 0; i < 6; i += 1) {
    table[0x61 + i] = 10 + i; // a-f
    table[0x41 + i] = 10 + i; // A-F
  }
  return table;
})();

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 1) {
    const byte = bytes[i]!;
    out += HEX_ALPHABET[byte >> 4]! + HEX_ALPHABET[byte & 0x0f]!;
  }
  return out;
}

/** Returns `null` rather than throwing: most callers are validating user input. */
export function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const hi = HEX_LOOKUP[hex.charCodeAt(i * 2)] ?? -1;
    const lo = HEX_LOOKUP[hex.charCodeAt(i * 2 + 1)] ?? -1;
    if (hi < 0 || lo < 0) return null;
    out[i] = (hi << 4) | lo;
  }
  return out;
}

/** A 32-byte value in lowercase hex — a Blossom blob hash or a CHK key. */
export function isHash32Hex(value: string): boolean {
  return value.length === 64 && hexToBytes(value) !== null;
}

export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Bytewise comparison of UTF-8 encoded strings. BUD-16 sorts directory entries
 * by ascending bytewise order of the encoded names, which differs from
 * JavaScript's default UTF-16 string comparison for astral-plane characters.
 */
const utf8 = new TextEncoder();

export function compareUtf8(a: string, b: string): number {
  const left = utf8.encode(a);
  const right = utf8.encode(b);
  const shared = Math.min(left.length, right.length);
  for (let i = 0; i < shared; i += 1) {
    const diff = left[i]! - right[i]!;
    if (diff !== 0) return diff;
  }
  return left.length - right.length;
}

export function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size < 0) return '—';
  if (size < 1024) return `${size} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = size / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

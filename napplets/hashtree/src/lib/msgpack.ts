/**
 * Minimal, strict MessagePack decoder for BUD-16 tree nodes.
 *
 * Only decoding is implemented — this napplet is read-only and never produces a
 * manifest. The supported type set is "whatever a BUD-16 node plus a
 * JSON-compatible `m` metadata map can contain": nil, bool, int, float, str,
 * bin, array, map. Extension types, including the timestamp extension, are
 * rejected rather than skipped, because BUD-16 requires readers to fail on
 * anything they do not understand instead of guessing.
 *
 * Strictness beyond the format itself:
 *   - trailing bytes after the top-level value are an error (a manifest blob is
 *     exactly one node),
 *   - map keys must be strings (BUD-16: "a JSON-compatible map with string keys"),
 *   - duplicate map keys are an error, so a later key cannot shadow an earlier
 *     one that a differing implementation may have honoured instead,
 *   - nesting is bounded.
 *
 * Note that this decoder does NOT verify BUD-16's deterministic *encoding* rules
 * (field order, name sort order, shortest-int form). Those constrain writers so
 * manifest hashes are reproducible; a reader that enforced them would reject
 * otherwise-usable trees. Integrity comes from the SHA-256 check on the blob.
 */

export type MsgpackValue =
  | null
  | boolean
  | number
  | string
  | Uint8Array
  | MsgpackValue[]
  | { [key: string]: MsgpackValue };

export class MsgpackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MsgpackError';
  }
}

const DEFAULT_MAX_DEPTH = 16;

const utf8Decoder = new TextDecoder('utf-8', { fatal: true });

class Reader {
  private offset = 0;

  constructor(
    private readonly bytes: Uint8Array,
    private readonly maxDepth: number,
  ) {}

  get consumed(): number {
    return this.offset;
  }

  private require(count: number): number {
    const start = this.offset;
    if (start + count > this.bytes.length) {
      throw new MsgpackError(
        `truncated: needed ${count} byte(s) at offset ${start}, have ${this.bytes.length - start}`,
      );
    }
    this.offset += count;
    return start;
  }

  private u8(): number {
    return this.bytes[this.require(1)]!;
  }

  private uint(width: 1 | 2 | 4 | 8): number {
    const start = this.require(width);
    let value = 0;
    for (let i = 0; i < width; i += 1) {
      value = value * 256 + this.bytes[start + i]!;
    }
    if (!Number.isSafeInteger(value)) {
      throw new MsgpackError(`integer at offset ${start} exceeds the safe integer range`);
    }
    return value;
  }

  private int(width: 1 | 2 | 4 | 8): number {
    const start = this.require(width);
    let value = 0;
    for (let i = 0; i < width; i += 1) {
      value = value * 256 + this.bytes[start + i]!;
    }
    const limit = 2 ** (width * 8 - 1);
    const signed = value >= limit ? value - limit * 2 : value;
    if (!Number.isSafeInteger(signed)) {
      throw new MsgpackError(`integer at offset ${start} exceeds the safe integer range`);
    }
    return signed;
  }

  private float(width: 4 | 8): number {
    const start = this.require(width);
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset + start, width);
    return width === 4 ? view.getFloat32(0, false) : view.getFloat64(0, false);
  }

  private str(length: number): string {
    const start = this.require(length);
    try {
      return utf8Decoder.decode(this.bytes.subarray(start, start + length));
    } catch {
      throw new MsgpackError(`invalid UTF-8 in string at offset ${start}`);
    }
  }

  private bin(length: number): Uint8Array {
    const start = this.require(length);
    return this.bytes.slice(start, start + length);
  }

  private array(length: number, depth: number): MsgpackValue[] {
    const out = new Array<MsgpackValue>(length);
    for (let i = 0; i < length; i += 1) out[i] = this.value(depth + 1);
    return out;
  }

  private map(length: number, depth: number): { [key: string]: MsgpackValue } {
    const out: { [key: string]: MsgpackValue } = Object.create(null) as Record<
      string,
      MsgpackValue
    >;
    for (let i = 0; i < length; i += 1) {
      const keyStart = this.offset;
      const key = this.value(depth + 1);
      if (typeof key !== 'string') {
        throw new MsgpackError(`map key at offset ${keyStart} is not a string`);
      }
      if (key in out) {
        throw new MsgpackError(`duplicate map key ${JSON.stringify(key)} at offset ${keyStart}`);
      }
      out[key] = this.value(depth + 1);
    }
    return out;
  }

  value(depth = 0): MsgpackValue {
    if (depth > this.maxDepth) {
      throw new MsgpackError(`nesting deeper than ${this.maxDepth} levels`);
    }
    const start = this.offset;
    const tag = this.u8();

    if (tag <= 0x7f) return tag; // positive fixint
    if (tag >= 0xe0) return tag - 256; // negative fixint
    if (tag >= 0x80 && tag <= 0x8f) return this.map(tag & 0x0f, depth); // fixmap
    if (tag >= 0x90 && tag <= 0x9f) return this.array(tag & 0x0f, depth); // fixarray
    if (tag >= 0xa0 && tag <= 0xbf) return this.str(tag & 0x1f); // fixstr

    switch (tag) {
      case 0xc0:
        return null;
      case 0xc2:
        return false;
      case 0xc3:
        return true;
      case 0xc4:
        return this.bin(this.uint(1));
      case 0xc5:
        return this.bin(this.uint(2));
      case 0xc6:
        return this.bin(this.uint(4));
      case 0xca:
        return this.float(4);
      case 0xcb:
        return this.float(8);
      case 0xcc:
        return this.uint(1);
      case 0xcd:
        return this.uint(2);
      case 0xce:
        return this.uint(4);
      case 0xcf:
        return this.uint(8);
      case 0xd0:
        return this.int(1);
      case 0xd1:
        return this.int(2);
      case 0xd2:
        return this.int(4);
      case 0xd3:
        return this.int(8);
      case 0xd9:
        return this.str(this.uint(1));
      case 0xda:
        return this.str(this.uint(2));
      case 0xdb:
        return this.str(this.uint(4));
      case 0xdc:
        return this.array(this.uint(2), depth);
      case 0xdd:
        return this.array(this.uint(4), depth);
      case 0xde:
        return this.map(this.uint(2), depth);
      case 0xdf:
        return this.map(this.uint(4), depth);
      default:
        throw new MsgpackError(
          `unsupported MessagePack type 0x${tag.toString(16).padStart(2, '0')} at offset ${start}`,
        );
    }
  }
}

export function decodeMsgpack(
  bytes: Uint8Array,
  options: { maxDepth?: number } = {},
): MsgpackValue {
  const reader = new Reader(bytes, options.maxDepth ?? DEFAULT_MAX_DEPTH);
  const value = reader.value();
  if (reader.consumed !== bytes.length) {
    throw new MsgpackError(
      `${bytes.length - reader.consumed} trailing byte(s) after the top-level value`,
    );
  }
  return value;
}

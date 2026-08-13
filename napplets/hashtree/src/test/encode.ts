/**
 * Test-only BUD-16 canonical encoder.
 *
 * The napplet is read-only and ships no encoder, but navigation tests need real
 * manifests to navigate. Writing one here — following BUD-16's deterministic
 * encoding rules exactly — means fixtures are built the way a real producer
 * builds them, and `encode.test.ts` proves it by reproducing all four published
 * test vectors byte for byte.
 */

import { compareUtf8, concatBytes, hexToBytes } from '../lib/bytes.js';
import { sha256Hex } from '../lib/hash.js';
import { decodeNode, type TreeNode } from '../lib/manifest.js';

export type MetadataValue = string | number | boolean | null;

export interface EncodableLink {
  readonly h: Uint8Array;
  readonly k?: Uint8Array;
  readonly m?: Readonly<Record<string, MetadataValue>>;
  readonly n?: string;
  readonly s: number;
  readonly t: number;
}

export interface EncodableNode {
  readonly t: number;
  readonly l: readonly EncodableLink[];
}

const utf8 = new TextEncoder();

const byte = (...values: number[]) => new Uint8Array(values);

function uint(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`not a uint: ${value}`);
  // Rule 5: shortest MessagePack integer encoding that can represent the value.
  if (value < 0x80) return byte(value);
  if (value < 0x100) return byte(0xcc, value);
  if (value < 0x10000) return byte(0xcd, value >> 8, value & 0xff);
  if (value < 0x100000000) {
    return byte(0xce, (value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
  }
  const high = Math.floor(value / 0x100000000);
  const low = value >>> 0;
  return byte(
    0xcf,
    (high >>> 24) & 0xff,
    (high >>> 16) & 0xff,
    (high >>> 8) & 0xff,
    high & 0xff,
    (low >>> 24) & 0xff,
    (low >>> 16) & 0xff,
    (low >>> 8) & 0xff,
    low & 0xff,
  );
}

function str(value: string): Uint8Array {
  const encoded = utf8.encode(value);
  if (encoded.length < 32) return concatBytes([byte(0xa0 | encoded.length), encoded]);
  if (encoded.length < 0x100) return concatBytes([byte(0xd9, encoded.length), encoded]);
  return concatBytes([byte(0xda, encoded.length >> 8, encoded.length & 0xff), encoded]);
}

function bin(value: Uint8Array): Uint8Array {
  // Rule 6: binary values MUST use MessagePack binary types, not strings.
  if (value.length < 0x100) return concatBytes([byte(0xc4, value.length), value]);
  return concatBytes([byte(0xc5, value.length >> 8, value.length & 0xff), value]);
}

const mapHeader = (size: number): Uint8Array =>
  size < 16 ? byte(0x80 | size) : byte(0xde, size >> 8, size & 0xff);

const arrayHeader = (size: number): Uint8Array =>
  size < 16 ? byte(0x90 | size) : byte(0xdc, size >> 8, size & 0xff);

function value(input: MetadataValue): Uint8Array {
  if (input === null) return byte(0xc0);
  if (typeof input === 'boolean') return byte(input ? 0xc3 : 0xc2);
  if (typeof input === 'number') return uint(input);
  return str(input);
}

function metadata(input: Readonly<Record<string, MetadataValue>>): Uint8Array {
  // Rule 4: metadata keys in ascending bytewise order of their UTF-8 encoding.
  const keys = Object.keys(input).sort(compareUtf8);
  return concatBytes([
    mapHeader(keys.length),
    ...keys.flatMap((key) => [str(key), value(input[key]!)]),
  ]);
}

function link(input: EncodableLink): Uint8Array {
  // Rule 2: h, k, m, n, s, t — omitting absent optional fields.
  const parts: Uint8Array[] = [];
  let count = 0;
  const push = (name: string, encoded: Uint8Array) => {
    parts.push(str(name), encoded);
    count += 1;
  };

  push('h', bin(input.h));
  if (input.k !== undefined) push('k', bin(input.k));
  if (input.m !== undefined) push('m', metadata(input.m));
  if (input.n !== undefined) push('n', str(input.n));
  push('s', uint(input.s));
  push('t', uint(input.t));

  return concatBytes([mapHeader(count), ...parts]);
}

export function encodeNodeBytes(node: EncodableNode): Uint8Array {
  const links =
    node.t === 2
      ? // Rule 3: directory links sorted bytewise by UTF-8 name.
        [...node.l].sort((a, b) => compareUtf8(a.n ?? '', b.n ?? ''))
      : [...node.l];
  // Rule 1: the root map fields are encoded in the order l, t.
  return concatBytes([
    mapHeader(2),
    str('l'),
    concatBytes([arrayHeader(links.length), ...links.map(link)]),
    str('t'),
    uint(node.t),
  ]);
}

/** Convenience for fixtures: 32 identical bytes, addressed by a nibble pattern. */
export const fill = (pattern: string): Uint8Array => hexToBytes(pattern.repeat(32))!;

/**
 * An in-memory Blossom, satisfying `NodeSource` structurally.
 *
 * Records every fetch so tests can assert what was *not* fetched — laziness is
 * the whole point of the navigation layer.
 */
export class FakeBlobs {
  private readonly blobs = new Map<string, Uint8Array>();
  readonly fetched: string[] = [];

  put(bytes: Uint8Array): string {
    const hash = sha256Hex(bytes);
    this.blobs.set(hash, bytes);
    return hash;
  }

  putNode(node: EncodableNode): string {
    return this.put(encodeNodeBytes(node));
  }

  /** Fixtures are unencrypted, so `key` is accepted and ignored. */
  async bytes(hash: string, _key: string | null = null): Promise<Uint8Array> {
    this.fetched.push(hash);
    const found = this.blobs.get(hash);
    if (found === undefined) throw new Error(`fixture has no blob ${hash}`);
    return found;
  }

  async node(hash: string, key: string | null = null): Promise<TreeNode> {
    return decodeNode(await this.bytes(hash, key));
  }

  /** Distinct hashes fetched, for assertions that ignore caching behaviour. */
  get fetchedUnique(): string[] {
    return [...new Set(this.fetched)];
  }

  reset(): void {
    this.fetched.length = 0;
  }
}

/**
 * BUD-16 / BUD-17 tree node model.
 *
 * A node is one MessagePack map `{ l: [...links], t: <node type> }`. Link `t`
 * equals the node type of the manifest it points at, except `t = 0`, which
 * points at a raw Blossom blob that has no node type. That invariant is the
 * whole navigation model: you always know what a child is before fetching it.
 *
 * Everything here is pure — no fetching, no shell calls — so the BUD test
 * vectors can drive it directly.
 */

import { bytesToHex, compareUtf8 } from './bytes.js';
import { decodeMsgpack, MsgpackError, type MsgpackValue } from './msgpack.js';

/** Raw Blossom blob; has no node type of its own. */
export const LINK_BLOB = 0;
/** BUD-17 file manifest. */
export const LINK_FILE = 1;
/** BUD-16 directory manifest. */
export const LINK_DIR = 2;
/** BUD-17 directory fanout node. */
export const LINK_FANOUT = 3;

export type LinkType = 0 | 1 | 2 | 3;
export type NodeType = 1 | 2 | 3;

/**
 * `m.count` / `m.first` / `m.last` on a link inside a `t = 3` fanout node.
 *
 * These bounds are how path lookup picks a subtree without fetching siblings.
 * They are NOT authenticated — a producer can lie, and the hash check on the
 * child cannot detect it, so a bounds-implied miss means "not found in this
 * subtree", never "does not exist".
 */
export interface FanoutBounds {
  readonly count: number;
  readonly first: string;
  readonly last: string;
}

export interface TreeLink {
  /** 32-byte Blossom hash of the linked object, lowercase hex. */
  readonly hash: string;
  /** Optional client-side decryption key, lowercase hex. A bearer secret. */
  readonly key: string | null;
  /** Entry name. Present exactly on links inside a `t = 2` directory manifest. */
  readonly name: string | null;
  /** Plaintext bytes represented by this link; `0` for directories of unknown size. */
  readonly size: number;
  readonly type: LinkType;
  readonly metadata: Readonly<Record<string, MsgpackValue>> | null;
  /** Parsed `m` bounds; non-null exactly for links inside a `t = 3` node. */
  readonly fanout: FanoutBounds | null;
}

export interface TreeNode {
  readonly type: NodeType;
  readonly links: readonly TreeLink[];
}

export type ManifestErrorCode =
  | 'malformed'
  | 'unsupported-type'
  | 'invalid-link'
  | 'duplicate-name';

export class ManifestError extends Error {
  constructor(
    message: string,
    readonly code: ManifestErrorCode,
  ) {
    super(message);
    this.name = 'ManifestError';
  }
}

function isMap(
  value: MsgpackValue | undefined,
): value is { [key: string]: MsgpackValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && !isBytes(value);
}

function isBytes(value: MsgpackValue | undefined): value is Uint8Array {
  return value instanceof Uint8Array;
}

function readHash32(value: MsgpackValue | undefined, field: string): string {
  if (!isBytes(value)) {
    throw new ManifestError(`link field \`${field}\` must be MessagePack bin`, 'invalid-link');
  }
  if (value.length !== 32) {
    throw new ManifestError(
      `link field \`${field}\` must be 32 bytes, got ${value.length}`,
      'invalid-link',
    );
  }
  return bytesToHex(value);
}

function readSize(value: MsgpackValue | undefined): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ManifestError('link field `s` must be a non-negative integer', 'invalid-link');
  }
  return value;
}

function readLinkType(value: MsgpackValue | undefined): LinkType {
  if (value !== 0 && value !== 1 && value !== 2 && value !== 3) {
    // BUD-16: readers MUST return an unsupported type error and MUST NOT
    // reinterpret an unknown type as a blob or another known manifest type.
    throw new ManifestError(`unsupported link type ${String(value)}`, 'unsupported-type');
  }
  return value;
}

/** BUD-16 entry name rules. */
export function isValidEntryName(name: string): boolean {
  if (name.length === 0) return false;
  if (name === '.' || name === '..') return false;
  return !name.includes('/') && !name.includes('\0');
}

function readFanoutBounds(metadata: Readonly<Record<string, MsgpackValue>> | null): FanoutBounds {
  const count = metadata?.['count'];
  const first = metadata?.['first'];
  const last = metadata?.['last'];
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count <= 0) {
    throw new ManifestError('fanout link `m.count` must be a positive integer', 'invalid-link');
  }
  if (typeof first !== 'string' || typeof last !== 'string') {
    throw new ManifestError('fanout link `m.first` and `m.last` must be strings', 'invalid-link');
  }
  if (compareUtf8(first, last) > 0) {
    throw new ManifestError('fanout link bounds are inverted (`first` > `last`)', 'invalid-link');
  }
  return { count, first, last };
}

function decodeLink(raw: MsgpackValue, nodeType: NodeType): TreeLink {
  if (!isMap(raw)) throw new ManifestError('each entry of `l` must be a map', 'invalid-link');

  const hash = readHash32(raw['h'], 'h');
  const size = readSize(raw['s']);
  const type = readLinkType(raw['t']);

  const rawKey = raw['k'];
  const key = rawKey === undefined ? null : readHash32(rawKey, 'k');

  const rawName = raw['n'];
  if (rawName !== undefined && typeof rawName !== 'string') {
    throw new ManifestError('link field `n` must be a string', 'invalid-link');
  }
  const name = rawName ?? null;

  const rawMetadata = raw['m'];
  if (rawMetadata !== undefined && !isMap(rawMetadata)) {
    throw new ManifestError('link field `m` must be a map', 'invalid-link');
  }
  const metadata = rawMetadata ?? null;

  switch (nodeType) {
    case LINK_DIR: {
      // Links in a directory manifest are the user-visible entries, so `n` is required.
      if (name === null) {
        throw new ManifestError('directory manifest link is missing `n`', 'invalid-link');
      }
      if (!isValidEntryName(name)) {
        throw new ManifestError(`invalid entry name ${JSON.stringify(name)}`, 'invalid-link');
      }
      return { hash, key, name, size, type, metadata, fanout: null };
    }
    case LINK_FILE: {
      // BUD-17: file manifest links MUST NOT include `n`, and address either a
      // leaf chunk or another file manifest.
      if (name !== null) {
        throw new ManifestError('file manifest link must not include `n`', 'invalid-link');
      }
      if (type !== LINK_BLOB && type !== LINK_FILE) {
        throw new ManifestError(
          `file manifest link must have t = 0 or 1, got ${type}`,
          'invalid-link',
        );
      }
      return { hash, key, name: null, size, type, metadata, fanout: null };
    }
    case LINK_FANOUT: {
      // BUD-17: fanout links are internal, unnamed, and must carry entry-name bounds.
      if (name !== null) {
        throw new ManifestError('fanout node link must not include `n`', 'invalid-link');
      }
      if (type !== LINK_DIR && type !== LINK_FANOUT) {
        throw new ManifestError(
          `fanout node link must have t = 2 or 3, got ${type}`,
          'invalid-link',
        );
      }
      return { hash, key, name: null, size, type, metadata, fanout: readFanoutBounds(metadata) };
    }
  }
}

/**
 * Decode one already hash-verified, already decrypted manifest blob.
 *
 * The caller is responsible for verifying `SHA256(bytes)` against the link that
 * pointed here *before* calling this — see `blobs.ts`.
 */
export function decodeNode(bytes: Uint8Array): TreeNode {
  let root: MsgpackValue;
  try {
    root = decodeMsgpack(bytes);
  } catch (error) {
    const detail = error instanceof MsgpackError ? error.message : String(error);
    throw new ManifestError(`not a MessagePack tree node: ${detail}`, 'malformed');
  }

  if (!isMap(root)) throw new ManifestError('tree node must be a map', 'malformed');

  for (const key of Object.keys(root)) {
    if (key !== 'l' && key !== 't') {
      throw new ManifestError(`unexpected tree node field \`${key}\``, 'malformed');
    }
  }

  const rawType = root['t'];
  if (rawType !== 1 && rawType !== 2 && rawType !== 3) {
    throw new ManifestError(`unsupported node type ${String(rawType)}`, 'unsupported-type');
  }
  const type: NodeType = rawType;

  const rawLinks = root['l'];
  if (!Array.isArray(rawLinks)) {
    throw new ManifestError('tree node field `l` must be an array', 'malformed');
  }

  const links = rawLinks.map((link) => decodeLink(link, type));

  if (type === LINK_DIR) {
    const seen = new Set<string>();
    for (const link of links) {
      if (seen.has(link.name!)) {
        throw new ManifestError(
          `duplicate directory entry ${JSON.stringify(link.name)}`,
          'duplicate-name',
        );
      }
      seen.add(link.name!);
    }
  }

  return { type, links };
}

/** Total plaintext size a node represents: the sum of its link sizes. */
export function nodeSize(node: TreeNode): number {
  return node.links.reduce((total, link) => total + link.size, 0);
}

/**
 * Whether a fanout child's bounds could contain `name`.
 *
 * Bounds come from the producer and are unauthenticated, so this narrows the
 * search but never proves absence.
 */
export function boundsMayContain(bounds: FanoutBounds, name: string): boolean {
  return compareUtf8(name, bounds.first) >= 0 && compareUtf8(name, bounds.last) <= 0;
}

export interface ChunkSlice {
  readonly link: TreeLink;
  /** Absolute plaintext offset at which this link's bytes start. */
  readonly offset: number;
  /** Byte range wanted from this link, relative to its own start. */
  readonly start: number;
  readonly end: number;
}

/**
 * Map an absolute plaintext byte range onto the links of a file manifest.
 *
 * BUD-17 stores no explicit offsets: a link's offset is the prefix sum of the
 * `s` values before it. That is what makes random access possible — only the
 * subtrees whose cumulative range overlaps the request need to be fetched.
 */
export function sliceLinks(
  node: TreeNode,
  rangeStart: number,
  rangeEnd: number,
): ChunkSlice[] {
  const slices: ChunkSlice[] = [];
  let offset = 0;
  for (const link of node.links) {
    const linkEnd = offset + link.size;
    if (linkEnd > rangeStart && offset < rangeEnd) {
      slices.push({
        link,
        offset,
        start: Math.max(0, rangeStart - offset),
        end: Math.min(link.size, rangeEnd - offset),
      });
    }
    offset = linkEnd;
    if (offset >= rangeEnd) break;
  }
  return slices;
}

/** Sort directory entries the way BUD-16 requires writers to: bytewise by UTF-8 name. */
export function sortEntriesByName(links: readonly TreeLink[]): TreeLink[] {
  return [...links].sort((a, b) => compareUtf8(a.name ?? '', b.name ?? ''));
}

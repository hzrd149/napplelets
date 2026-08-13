/**
 * Navigation over a hashtree: listing, path lookup, and file assembly.
 *
 * Everything is pull-based. A directory is read when it is opened, a fanout
 * child when its bounds could contain what is being looked for, a chunk when
 * the bytes it covers are actually wanted. Nothing walks the whole tree.
 */

import { concatBytes } from './bytes.js';
import type { FetchOptions, NodeSource } from './blobs.js';
import {
  boundsMayContain,
  LINK_BLOB,
  LINK_DIR,
  LINK_FANOUT,
  LINK_FILE,
  sliceLinks,
  sortEntriesByName,
  type LinkType,
  type TreeLink,
  type TreeNode,
} from './manifest.js';

export type TreeErrorCode = 'not-a-directory' | 'not-a-file' | 'not-found' | 'too-large' | 'limit';

export class TreeError extends Error {
  constructor(
    message: string,
    readonly code: TreeErrorCode,
  ) {
    super(message);
    this.name = 'TreeError';
  }
}

/**
 * BUD-17 asks clients to bound recursion depth, manifest count, link count and
 * total bytes. A hostile or broken producer should cost a bounded amount of
 * work, not an unbounded one.
 */
const MAX_DEPTH = 32;
const MAX_ENTRIES = 100_000;
const MAX_LEAVES = 200_000;

/** A position in the tree. The root has no link of its own, hence the shared shape. */
export interface TreeTarget {
  readonly hash: string;
  readonly key: string | null;
  readonly type: LinkType;
  readonly name: string | null;
  readonly size: number;
}

export function targetFromLink(link: TreeLink): TreeTarget {
  return { hash: link.hash, key: link.key, type: link.type, name: link.name, size: link.size };
}

export function isDirectoryLink(type: LinkType): boolean {
  return type === LINK_DIR || type === LINK_FANOUT;
}

export function entryKind(link: TreeLink): 'directory' | 'file' {
  return isDirectoryLink(link.type) ? 'directory' : 'file';
}

export interface ListOptions extends FetchOptions {
  /** Called as each fanout child lands, so a large directory renders progressively. */
  readonly onPartial?: (entries: readonly TreeLink[]) => void;
}

/**
 * List a directory, flattening fanout.
 *
 * BUD-17: readers MUST flatten `t = 3` nodes and MUST NOT expose their internal
 * links as user-visible entries. Children are walked in fanout order, which is
 * already the sorted entry order, so partial results are in final order too.
 */
export async function listDirectory(
  store: NodeSource,
  target: Pick<TreeTarget, 'hash' | 'key'>,
  options: ListOptions = {},
): Promise<TreeLink[]> {
  const entries: TreeLink[] = [];

  const walk = async (hash: string, key: string | null, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) {
      throw new TreeError(`Directory nests deeper than ${MAX_DEPTH} levels.`, 'limit');
    }
    const node = await store.node(hash, key, options);

    if (node.type === LINK_DIR) {
      if (entries.length + node.links.length > MAX_ENTRIES) {
        throw new TreeError(`Directory has more than ${MAX_ENTRIES} entries.`, 'limit');
      }
      entries.push(...node.links);
      options.onPartial?.(entries);
      return;
    }

    if (node.type === LINK_FANOUT) {
      for (const child of node.links) {
        await walk(child.hash, child.key, depth + 1);
      }
      return;
    }

    throw new TreeError('This is a file, not a directory.', 'not-a-directory');
  };

  await walk(target.hash, target.key, 0);
  return sortEntriesByName(entries);
}

/**
 * Find one named entry without listing the whole directory.
 *
 * In a fanout, `m.first`/`m.last` pick the subtree to descend. Those bounds come
 * from the producer and are not authenticated, so a miss here means "not present
 * in the subtrees whose bounds admit this name" — it is not proof of absence,
 * which is why the error says so.
 */
export async function lookupEntry(
  store: NodeSource,
  target: Pick<TreeTarget, 'hash' | 'key'>,
  name: string,
  options: FetchOptions = {},
): Promise<TreeLink | null> {
  const search = async (hash: string, key: string | null, depth: number): Promise<TreeLink | null> => {
    if (depth > MAX_DEPTH) {
      throw new TreeError(`Directory nests deeper than ${MAX_DEPTH} levels.`, 'limit');
    }
    const node = await store.node(hash, key, options);

    if (node.type === LINK_DIR) {
      return node.links.find((link) => link.name === name) ?? null;
    }

    if (node.type === LINK_FANOUT) {
      for (const child of node.links) {
        if (child.fanout !== null && !boundsMayContain(child.fanout, name)) continue;
        const found = await search(child.hash, child.key, depth + 1);
        if (found !== null) return found;
      }
      return null;
    }

    throw new TreeError('This is a file, not a directory.', 'not-a-directory');
  };

  return search(target.hash, target.key, 0);
}

export interface ResolvedPath {
  /** The target the path names. */
  readonly target: TreeTarget;
  /** Every step from the root, for breadcrumbs. Index 0 is the root itself. */
  readonly trail: readonly TreeTarget[];
}

/** Walk a decoded path from the root, one segment and one fetch at a time. */
export async function resolvePath(
  store: NodeSource,
  root: Pick<TreeTarget, 'hash' | 'key'>,
  path: readonly string[],
  options: FetchOptions = {},
): Promise<ResolvedPath> {
  // BUD-18: the root hash identifies a directory manifest or a file manifest.
  const rootNode = await store.node(root.hash, root.key, options);
  let current: TreeTarget = {
    hash: root.hash,
    key: root.key,
    type: rootNode.type as LinkType,
    name: null,
    size: nodeTotal(rootNode),
  };
  const trail: TreeTarget[] = [current];

  for (const [index, segment] of path.entries()) {
    if (!isDirectoryLink(current.type)) {
      throw new TreeError(
        `${JSON.stringify(trail.at(-1)?.name ?? 'the root')} is a file, so ${JSON.stringify(segment)} cannot be inside it.`,
        'not-a-directory',
      );
    }
    const found = await lookupEntry(store, current, segment, options);
    if (found === null) {
      const where = path.slice(0, index).join('/');
      throw new TreeError(
        `No entry named ${JSON.stringify(segment)} in ${where === '' ? 'the root directory' : where}.`,
        'not-found',
      );
    }
    current = targetFromLink(found);
    trail.push(current);
  }

  return { target: current, trail };
}

function nodeTotal(node: TreeNode): number {
  return node.links.reduce((total, link) => total + link.size, 0);
}

export interface ReadFileOptions extends FetchOptions {
  readonly onProgress?: (loadedBytes: number, totalBytes: number) => void;
  readonly maxParallel?: number;
  /** Refuse to assemble more than this many bytes in memory. */
  readonly maxBytes?: number;
}

/**
 * Flatten a file manifest into its leaf chunks, in byte order.
 *
 * Intermediate `t = 1` manifests are fetched here — they are small, and a file
 * is at most two levels deep until ~59 GiB — while leaf chunks are only listed,
 * not fetched.
 */
async function collectLeaves(
  store: NodeSource,
  target: TreeTarget,
  options: FetchOptions,
): Promise<TreeLink[]> {
  const leaves: TreeLink[] = [];

  const walk = async (hash: string, key: string | null, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) {
      throw new TreeError(`File manifest nests deeper than ${MAX_DEPTH} levels.`, 'limit');
    }
    const node = await store.node(hash, key, options);
    if (node.type !== LINK_FILE) {
      throw new TreeError('Expected a file manifest.', 'not-a-file');
    }
    for (const link of node.links) {
      if (link.type === LINK_BLOB) {
        if (leaves.length >= MAX_LEAVES) {
          throw new TreeError(`File has more than ${MAX_LEAVES} chunks.`, 'limit');
        }
        leaves.push(link);
      } else {
        await walk(link.hash, link.key, depth + 1);
      }
    }
  };

  await walk(target.hash, target.key, 0);
  return leaves;
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]!, index);
    }
  });
  await Promise.all(runners);
  return results;
}

/**
 * Assemble a whole file.
 *
 * A `t = 0` target is one blob. A `t = 1` target is walked to its leaves, which
 * are fetched with bounded concurrency and concatenated in manifest order —
 * BUD-17: readers MUST recursively traverse `t = 1` links and concatenate
 * `t = 0` chunks in manifest order.
 */
export async function readFile(
  store: NodeSource,
  target: TreeTarget,
  options: ReadFileOptions = {},
): Promise<Uint8Array> {
  const maxBytes = options.maxBytes ?? Number.POSITIVE_INFINITY;
  const fetchOptions: FetchOptions = options.signal ? { signal: options.signal } : {};

  if (target.type === LINK_BLOB) {
    if (target.size > maxBytes) {
      throw new TreeError(`This file is larger than the ${maxBytes} byte limit.`, 'too-large');
    }
    const bytes = await store.bytes(target.hash, target.key, fetchOptions);
    options.onProgress?.(bytes.length, bytes.length);
    return bytes;
  }

  if (target.type !== LINK_FILE) {
    throw new TreeError('This is a directory, not a file.', 'not-a-file');
  }

  const leaves = await collectLeaves(store, target, fetchOptions);
  const total = leaves.reduce((sum, leaf) => sum + leaf.size, 0);
  if (total > maxBytes) {
    throw new TreeError(`This file is larger than the ${maxBytes} byte limit.`, 'too-large');
  }

  let loaded = 0;
  options.onProgress?.(0, total);
  const chunks = await mapWithConcurrency(leaves, options.maxParallel ?? 4, async (leaf) => {
    const bytes = await store.bytes(leaf.hash, leaf.key, fetchOptions);
    loaded += bytes.length;
    options.onProgress?.(Math.min(loaded, total), total);
    return bytes;
  });

  return concatBytes(chunks);
}

/**
 * Read a byte range without assembling the whole file — used for previewing the
 * head of a large text file. Only the chunks overlapping the range are fetched.
 */
export async function readFileRange(
  store: NodeSource,
  target: TreeTarget,
  start: number,
  end: number,
  options: FetchOptions = {},
): Promise<Uint8Array> {
  if (target.type === LINK_BLOB) {
    const bytes = await store.bytes(target.hash, target.key, options);
    return bytes.slice(start, end);
  }
  if (target.type !== LINK_FILE) {
    throw new TreeError('This is a directory, not a file.', 'not-a-file');
  }

  const node = await store.node(target.hash, target.key, options);
  const slices = sliceLinks(node, start, end);
  const parts = await Promise.all(
    slices.map(async (slice) => {
      if (slice.link.type === LINK_BLOB) {
        const bytes = await store.bytes(slice.link.hash, slice.link.key, options);
        return bytes.slice(slice.start, slice.end);
      }
      return readFileRange(
        store,
        targetFromLink(slice.link),
        slice.start,
        slice.end,
        options,
      );
    }),
  );
  return concatBytes(parts);
}

import { describe, expect, it } from 'vitest';
import { bytesToHex, hexToBytes } from './bytes.js';
import { sha256Hex } from './hash.js';
import { encodeNodeBytes, FakeBlobs, fill } from '../test/encode.js';
import {
  entryKind,
  listDirectory,
  lookupEntry,
  readFile,
  readFileRange,
  resolvePath,
  TreeError,
} from './tree.js';

describe('the test encoder reproduces the published vectors', () => {
  // If this drifts, every fixture below is meaningless -- so it is asserted first.
  it('empty directory', () => {
    const bytes = encodeNodeBytes({ t: 2, l: [] });
    expect(bytesToHex(bytes)).toBe('82a16c90a17402');
    expect(sha256Hex(bytes)).toBe(
      '0218ed9a4fbb0993757f17e5d08d089cb0c6ac851928ba1ba82d337d76c41c0c',
    );
  });

  it('single-entry directory', () => {
    const bytes = encodeNodeBytes({
      t: 2,
      l: [{ h: fill('ab'), n: 'test.txt', s: 100, t: 0 }],
    });
    expect(sha256Hex(bytes)).toBe(
      '16121fa792b3afc72ec8bfc1dc85060518b6adba1429973ecc12891165cbe67e',
    );
    expect(bytes).toHaveLength(61);
  });

  it('two-chunk file manifest', () => {
    const bytes = encodeNodeBytes({
      t: 1,
      l: [
        { h: fill('aa'), s: 100, t: 0 },
        { h: fill('bb'), s: 50, t: 0 },
      ],
    });
    expect(sha256Hex(bytes)).toBe(
      '559b726c38295aa0ecbbaef43d438cc86dd63324a0c3e9426dc5f1d0285f483f',
    );
    expect(bytes).toHaveLength(93);
  });

  it('two-child directory fanout', () => {
    const bytes = encodeNodeBytes({
      t: 3,
      l: [
        { h: fill('11'), m: { count: 2, first: 'a.txt', last: 'b.txt' }, s: 30, t: 2 },
        { h: fill('22'), m: { count: 1, first: 'c.txt', last: 'c.txt' }, s: 40, t: 2 },
      ],
    });
    expect(sha256Hex(bytes)).toBe(
      '6626ab03b5468f417d888fa25fa22b48f5bcb7dfafb88eef34c638d167afc0a3',
    );
    expect(bytes).toHaveLength(159);
  });
});

const text = (value: string) => new TextEncoder().encode(value);

/**
 * A small tree whose root directory is sharded across a fanout:
 *
 *   /                       t=3 fanout over two directory shards
 *     docs/                 t=2 directory (entry in shard A)
 *       index.html          single blob
 *       manual.txt          t=1 file manifest ("hello " + "world")
 *     zebra.txt             single blob (entry in shard B)
 *
 * Fanout children are shards of one directory, not subdirectories: flattening
 * the root must yield `docs` and `zebra.txt`, never the contents of `docs`.
 */
function buildTree() {
  const blobs = new FakeBlobs();

  const indexHtml = blobs.put(text('<h1>index</h1>'));
  const chunkA = blobs.put(text('hello '));
  const chunkB = blobs.put(text('world'));
  const zebra = blobs.put(text('striped'));

  const manual = blobs.putNode({
    t: 1,
    l: [
      { h: hexToBytes(chunkA)!, s: 6, t: 0 },
      { h: hexToBytes(chunkB)!, s: 5, t: 0 },
    ],
  });

  const docsDir = blobs.putNode({
    t: 2,
    l: [
      { h: hexToBytes(indexHtml)!, n: 'index.html', s: 14, t: 0 },
      { h: hexToBytes(manual)!, n: 'manual.txt', s: 11, t: 1 },
    ],
  });

  const shardA = blobs.putNode({
    t: 2,
    l: [{ h: hexToBytes(docsDir)!, n: 'docs', s: 25, t: 2 }],
  });

  const shardB = blobs.putNode({
    t: 2,
    l: [{ h: hexToBytes(zebra)!, n: 'zebra.txt', s: 7, t: 0 }],
  });

  const root = blobs.putNode({
    t: 3,
    l: [
      { h: hexToBytes(shardA)!, m: { count: 1, first: 'docs', last: 'docs' }, s: 25, t: 2 },
      { h: hexToBytes(shardB)!, m: { count: 1, first: 'zebra.txt', last: 'zebra.txt' }, s: 7, t: 2 },
    ],
  });

  return { blobs, root, shardA, shardB, docsDir, manual, chunkA, chunkB, indexHtml, zebra };
}

describe('listDirectory', () => {
  it('flattens fanout into user-visible entries only', async () => {
    const { blobs, root } = buildTree();
    const entries = await listDirectory(blobs, { hash: root, key: null });
    expect(entries.map((entry) => entry.name)).toEqual(['docs', 'zebra.txt']);
    // The fanout children themselves are never surfaced.
    expect(entries.every((entry) => entry.name !== null)).toBe(true);
  });

  it('reports partial results as each fanout child lands', async () => {
    const { blobs, root } = buildTree();
    const snapshots: string[][] = [];
    await listDirectory(blobs, { hash: root, key: null }, {
      onPartial: (entries) => snapshots.push(entries.map((entry) => entry.name!)),
    });
    expect(snapshots).toEqual([['docs'], ['docs', 'zebra.txt']]);
  });

  it('does not fetch file content or subdirectories while listing', async () => {
    const { blobs, root, indexHtml, chunkA, zebra, manual, docsDir } = buildTree();
    await listDirectory(blobs, { hash: root, key: null });
    for (const unopened of [indexHtml, chunkA, zebra, manual, docsDir]) {
      expect(blobs.fetched).not.toContain(unopened);
    }
  });

  it('refuses to list a file manifest', async () => {
    const { blobs, manual } = buildTree();
    await expect(listDirectory(blobs, { hash: manual, key: null })).rejects.toThrow(
      /file, not a directory/,
    );
  });

  it('sorts entries bytewise by name', async () => {
    const blobs = new FakeBlobs();
    const blob = hexToBytes(blobs.put(text('x')))!;
    const dir = blobs.putNode({
      t: 2,
      l: [
        { h: blob, n: 'b', s: 1, t: 0 },
        { h: blob, n: 'A', s: 1, t: 0 },
        { h: blob, n: 'a', s: 1, t: 0 },
      ],
    });
    const entries = await listDirectory(blobs, { hash: dir, key: null });
    expect(entries.map((entry) => entry.name)).toEqual(['A', 'a', 'b']);
  });
});

describe('lookupEntry', () => {
  it('descends only the fanout child whose bounds admit the name', async () => {
    const { blobs, root, shardA, shardB } = buildTree();
    blobs.reset();
    const found = await lookupEntry(blobs, { hash: root, key: null }, 'docs');
    expect(found?.name).toBe('docs');
    expect(blobs.fetched).toContain(shardA);
    expect(blobs.fetched).not.toContain(shardB);
  });

  it('returns null when no subtree can contain the name', async () => {
    const { blobs, root } = buildTree();
    expect(await lookupEntry(blobs, { hash: root, key: null }, 'nothing-here')).toBeNull();
  });
});

describe('resolvePath', () => {
  it('walks to a nested file and records the trail', async () => {
    const { blobs, root, manual } = buildTree();
    const resolved = await resolvePath(blobs, { hash: root, key: null }, ['docs', 'manual.txt']);
    expect(resolved.target.hash).toBe(manual);
    expect(resolved.target.type).toBe(1);
    expect(resolved.trail.map((step) => step.name)).toEqual([null, 'docs', 'manual.txt']);
  });

  it('resolves the empty path to the root', async () => {
    const { blobs, root } = buildTree();
    const resolved = await resolvePath(blobs, { hash: root, key: null }, []);
    expect(resolved.target.hash).toBe(root);
    expect(resolved.trail).toHaveLength(1);
  });

  it('explains a missing segment without claiming the entry cannot exist', async () => {
    const { blobs, root } = buildTree();
    await expect(
      resolvePath(blobs, { hash: root, key: null }, ['docs', 'nope.txt']),
    ).rejects.toThrow(expect.objectContaining({ code: 'not-found' }) as unknown as Error);
  });

  it('refuses to descend into a file', async () => {
    const { blobs, root } = buildTree();
    await expect(
      resolvePath(blobs, { hash: root, key: null }, ['docs', 'index.html', 'deeper']),
    ).rejects.toThrow(TreeError);
  });
});

describe('readFile', () => {
  it('concatenates chunks in manifest order', async () => {
    const { blobs, root } = buildTree();
    const { target } = await resolvePath(blobs, { hash: root, key: null }, ['docs', 'manual.txt']);
    const bytes = await readFile(blobs, target);
    expect(new TextDecoder().decode(bytes)).toBe('hello world');
  });

  it('reads a single-blob file directly', async () => {
    const { blobs, root } = buildTree();
    const { target } = await resolvePath(blobs, { hash: root, key: null }, ['docs', 'index.html']);
    expect(new TextDecoder().decode(await readFile(blobs, target))).toBe('<h1>index</h1>');
  });

  it('reports progress up to the manifest total', async () => {
    const { blobs, root } = buildTree();
    const { target } = await resolvePath(blobs, { hash: root, key: null }, ['docs', 'manual.txt']);
    const seen: Array<[number, number]> = [];
    await readFile(blobs, target, { onProgress: (loaded, total) => seen.push([loaded, total]) });
    expect(seen[0]).toEqual([0, 11]);
    expect(seen.at(-1)).toEqual([11, 11]);
  });

  it('refuses a file over the byte limit before fetching chunks', async () => {
    const { blobs, root, chunkA } = buildTree();
    const { target } = await resolvePath(blobs, { hash: root, key: null }, ['docs', 'manual.txt']);
    blobs.reset();
    await expect(readFile(blobs, target, { maxBytes: 4 })).rejects.toThrow(
      expect.objectContaining({ code: 'too-large' }) as unknown as Error,
    );
    expect(blobs.fetched).not.toContain(chunkA);
  });

  it('refuses to read a directory as a file', async () => {
    const { blobs, root } = buildTree();
    const { target } = await resolvePath(blobs, { hash: root, key: null }, ['docs']);
    await expect(readFile(blobs, target)).rejects.toThrow(/directory, not a file/);
  });
});

describe('readFileRange', () => {
  it('fetches only the chunks overlapping the range', async () => {
    const { blobs, root, chunkA, chunkB } = buildTree();
    const { target } = await resolvePath(blobs, { hash: root, key: null }, ['docs', 'manual.txt']);
    blobs.reset();
    const bytes = await readFileRange(blobs, target, 6, 11);
    expect(new TextDecoder().decode(bytes)).toBe('world');
    expect(blobs.fetched).toContain(chunkB);
    expect(blobs.fetched).not.toContain(chunkA);
  });

  it('slices across a chunk boundary', async () => {
    const { blobs, root } = buildTree();
    const { target } = await resolvePath(blobs, { hash: root, key: null }, ['docs', 'manual.txt']);
    const bytes = await readFileRange(blobs, target, 4, 8);
    expect(new TextDecoder().decode(bytes)).toBe('o wo');
  });
});

describe('entryKind', () => {
  it('treats both directory node types as directories', async () => {
    const { blobs, root } = buildTree();
    const entries = await listDirectory(blobs, { hash: root, key: null });
    expect(entries.map(entryKind)).toEqual(['directory', 'file']);
  });
});

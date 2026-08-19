import { describe, expect, it } from 'vitest';

import { bytesToHex } from './bytes.js';
import { FakeBlobs, fill } from '../test/encode.js';
import { inspectNode, isManifestLink, linkKind, summarizeLinks } from './inspect.js';

const blobTarget = (hash: string) => ({ hash, key: null, type: 0 as const });

describe('linkKind', () => {
  it('names every BUD-16/17 link type', () => {
    expect([0, 1, 2, 3].map((type) => linkKind(type as 0 | 1 | 2 | 3))).toEqual([
      'blob',
      'file',
      'directory',
      'fanout',
    ]);
  });

  it('treats only t = 0 as a leaf', () => {
    expect(isManifestLink(0)).toBe(false);
    expect([1, 2, 3].every((type) => isManifestLink(type as 1 | 2 | 3))).toBe(true);
  });
});

describe('inspectNode', () => {
  it('describes a raw blob without fetching it', async () => {
    const blobs = new FakeBlobs();
    // Nothing is stored under this hash: reading it would throw.
    const inspected = await inspectNode(blobs, blobTarget(bytesToHex(fill('ab'))));

    expect(blobs.fetched).toEqual([]);
    expect(inspected.nodeType).toBeNull();
    expect(inspected.kind).toBe('blob');
    expect(inspected.manifestBytes).toBeNull();
    expect(inspected.links).toEqual([]);
  });

  it('reports chunk offsets as the prefix sums a file manifest does not store', async () => {
    const blobs = new FakeBlobs();
    const hash = blobs.putNode({
      t: 1,
      l: [
        { h: fill('aa'), s: 100, t: 0 },
        { h: fill('bb'), s: 50, t: 0 },
        { h: fill('cc'), s: 25, t: 0 },
      ],
    });

    const inspected = await inspectNode(blobs, { hash, key: null, type: 1 });

    expect(inspected.nodeType).toBe(1);
    expect(inspected.links.map((link) => link.offset)).toEqual([0, 100, 150]);
    expect(inspected.totalSize).toBe(175);
    // The published two-chunk vector is 93 bytes; a third `h`/`s`/`t` link adds 43.
    expect(inspected.manifestBytes).toBe(136);
  });

  it('keeps links in manifest order, with their index as identity', async () => {
    const blobs = new FakeBlobs();
    const hash = blobs.putNode({
      t: 1,
      l: [
        { h: fill('cc'), s: 10, t: 0 },
        { h: fill('aa'), s: 20, t: 0 },
      ],
    });

    const inspected = await inspectNode(blobs, { hash, key: null, type: 1 });

    // Byte order, not sorted-for-display order: this is what is actually stored.
    expect(inspected.links.map((link) => link.hash.slice(0, 2))).toEqual(['cc', 'aa']);
    expect(inspected.links.map((link) => link.index)).toEqual([0, 1]);
  });

  it('exposes fanout bounds and does not invent offsets outside a file', async () => {
    const blobs = new FakeBlobs();
    const hash = blobs.putNode({
      t: 3,
      l: [
        { h: fill('11'), m: { count: 2, first: 'a.txt', last: 'b.txt' }, s: 30, t: 2 },
        { h: fill('22'), m: { count: 1, first: 'c.txt', last: 'c.txt' }, s: 40, t: 2 },
      ],
    });

    const inspected = await inspectNode(blobs, { hash, key: null, type: 3 });

    expect(inspected.kind).toBe('fanout');
    expect(inspected.links[0]?.fanout).toEqual({ count: 2, first: 'a.txt', last: 'b.txt' });
    expect(inspected.links.every((link) => link.offset === null)).toBe(true);
    expect(inspected.links.map((link) => link.kind)).toEqual(['directory', 'directory']);
  });

  it('lists metadata field names without dumping their values', async () => {
    const blobs = new FakeBlobs();
    const hash = blobs.putNode({
      t: 2,
      l: [{ h: fill('ab'), m: { mime: 'text/plain' }, n: 'test.txt', s: 100, t: 0 }],
    });

    const inspected = await inspectNode(blobs, { hash, key: null, type: 2 });

    expect(inspected.links[0]?.metadataKeys).toEqual(['mime']);
    expect(inspected.links[0]?.name).toBe('test.txt');
  });

  it('marks an encrypted link without exposing the key in the node summary', async () => {
    const blobs = new FakeBlobs();
    const hash = blobs.putNode({
      t: 2,
      l: [{ h: fill('ab'), k: fill('cd'), n: 'secret.txt', s: 100, t: 0 }],
    });

    const inspected = await inspectNode(blobs, { hash, key: null, type: 2 });

    expect(inspected.encrypted).toBe(false);
    // The key travels on the link, because navigating deeper needs it.
    expect(inspected.links[0]?.key).toBe(bytesToHex(fill('cd')));
  });

  it('surfaces a decode failure as an error rather than an empty node', async () => {
    const blobs = new FakeBlobs();
    const hash = blobs.put(new TextEncoder().encode('not messagepack'));

    await expect(inspectNode(blobs, { hash, key: null, type: 2 })).rejects.toThrow(
      /not a MessagePack tree node/,
    );
  });
});

describe('summarizeLinks', () => {
  it('counts by kind so a fanout reads as subtrees, not entries', async () => {
    const blobs = new FakeBlobs();
    const hash = blobs.putNode({
      t: 3,
      l: [
        { h: fill('11'), m: { count: 2, first: 'a', last: 'b' }, s: 30, t: 2 },
        { h: fill('22'), m: { count: 1, first: 'c', last: 'c' }, s: 40, t: 2 },
      ],
    });
    const inspected = await inspectNode(blobs, { hash, key: null, type: 3 });

    expect(summarizeLinks(inspected.links)).toBe('2 directories');
  });

  it('singularises and reports an empty node', () => {
    expect(summarizeLinks([])).toBe('no links');
  });
});

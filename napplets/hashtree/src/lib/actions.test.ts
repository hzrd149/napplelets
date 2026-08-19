import { describe, expect, it } from 'vitest';
import {
  bytesToBase64,
  directBlobUrl,
  directBlobUrlBlocker,
  mediaMetadataFor,
} from './actions.js';
import { DEFAULT_SETTINGS, mergeRecent, readSettings } from './session.js';
import type { TreeTarget } from './tree.js';

const SERVERS = ['https://a.example', 'https://b.example'];

const target = (overrides: Partial<TreeTarget> = {}): TreeTarget => ({
  hash: 'ab'.repeat(32),
  key: null,
  type: 0,
  name: 'photo.jpg',
  size: 100,
  ...overrides,
});

describe('directBlobUrl', () => {
  it('builds a plain Blossom URL for a single unencrypted blob', () => {
    expect(directBlobUrl(target(), SERVERS)).toBe(`https://a.example/${'ab'.repeat(32)}.jpg`);
  });

  it('omits the extension when the name has none', () => {
    expect(directBlobUrl(target({ name: 'LICENSE' }), SERVERS)).toBe(
      `https://a.example/${'ab'.repeat(32)}`,
    );
  });

  it('never exposes a URL for an encrypted blob', () => {
    expect(directBlobUrl(target({ key: 'cd'.repeat(32) }), SERVERS)).toBeNull();
    expect(directBlobUrlBlocker(target({ key: 'cd'.repeat(32) }))).toMatch(/encrypted/);
  });

  it('never exposes a URL for a chunked file, which has none', () => {
    expect(directBlobUrl(target({ type: 1 }), SERVERS)).toBeNull();
    expect(directBlobUrlBlocker(target({ type: 1 }))).toMatch(/split across chunks/);
  });

  it('is unavailable with no servers configured', () => {
    expect(directBlobUrl(target(), [])).toBeNull();
  });

  it('reports no blocker for a plain blob', () => {
    expect(directBlobUrlBlocker(target())).toBeNull();
  });
});

describe('bytesToBase64', () => {
  it('round-trips through atob', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 255, 65, 66]);
    const decoded = Uint8Array.from(atob(bytesToBase64(bytes)), (char) => char.charCodeAt(0));
    expect([...decoded]).toEqual([...bytes]);
  });

  it('handles an empty file and a payload past the chunking threshold', () => {
    expect(bytesToBase64(new Uint8Array())).toBe('');
    const large = new Uint8Array(0x8000 * 2 + 5).fill(7);
    expect(atob(bytesToBase64(large))).toHaveLength(large.length);
  });
});

describe('mediaMetadataFor', () => {
  it('distinguishes audio from video', () => {
    expect(mediaMetadataFor('song.mp3', 'my tree')).toMatchObject({
      title: 'song.mp3',
      album: 'my tree',
      mediaType: 'audio',
    });
    expect(mediaMetadataFor('clip.webm', 'my tree').mediaType).toBe('video');
  });
});

describe('readSettings', () => {
  it('reads a well-formed config', () => {
    expect(
      readSettings({
        blossomServers: ['cdn.example.com'],
        useUserServerList: false,
        useAuthorServerList: false,
        maxParallelChunks: 8,
        maxCacheBytes: 64,
        autoPreview: true,
      }),
    ).toEqual({
      blossomServers: ['https://cdn.example.com'],
      useUserServerList: false,
      useAuthorServerList: false,
      maxParallelChunks: 8,
      maxCacheBytes: 64 * 1024 * 1024,
      autoPreview: true,
    });
  });

  it("defaults to using the user's own BUD-03 servers", () => {
    expect(readSettings({}).useUserServerList).toBe(true);
    expect(readSettings({ useUserServerList: 'no' }).useUserServerList).toBe(true);
    expect(readSettings({ useUserServerList: false }).useUserServerList).toBe(false);
  });

  it('falls back to the defaults rather than leaving nothing to fetch from', () => {
    expect(readSettings({ blossomServers: [] }).blossomServers).toEqual(
      DEFAULT_SETTINGS.blossomServers,
    );
    expect(readSettings({ blossomServers: ['not a url', ''] }).blossomServers).toEqual(
      DEFAULT_SETTINGS.blossomServers,
    );
    expect(readSettings({}).blossomServers).toEqual(DEFAULT_SETTINGS.blossomServers);
  });

  it('clamps out-of-range numbers instead of trusting them', () => {
    expect(readSettings({ maxParallelChunks: 9999 }).maxParallelChunks).toBe(16);
    expect(readSettings({ maxParallelChunks: 0 }).maxParallelChunks).toBe(1);
    expect(readSettings({ maxParallelChunks: 'four' }).maxParallelChunks).toBe(4);
    expect(readSettings({ maxCacheBytes: 4 }).maxCacheBytes).toBe(8 * 1024 * 1024);
  });
});

describe('mergeRecent', () => {
  const entry = (reference: string) => ({ reference, label: reference, openedAt: 1 });

  it('puts the newest first and de-duplicates by reference', () => {
    const merged = mergeRecent([entry('a'), entry('b')], entry('b'));
    expect(merged.map((item) => item.reference)).toEqual(['b', 'a']);
  });

  it('caps the list', () => {
    const many = Array.from({ length: 12 }, (_, index) => entry(`ref-${index}`));
    expect(mergeRecent(many, entry('new'))).toHaveLength(8);
  });
});

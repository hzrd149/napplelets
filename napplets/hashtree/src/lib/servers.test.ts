import { describe, expect, it } from 'vitest';
import type { NostrEvent } from '@napplet/sdk';
import { mergeServers, normalizeServer, readServerList, ServerRanking } from './servers.js';
import { classifyCapabilities, REQUIREMENTS } from './nap.js';
import { mimeForName, previewKindFor, isTimedMedia, extensionOf } from './mime.js';

describe('normalizeServer', () => {
  it('assumes https when no scheme is given', () => {
    expect(normalizeServer('cdn.example.com')).toBe('https://cdn.example.com');
  });

  it('strips trailing slashes', () => {
    expect(normalizeServer('https://cdn.example.com/')).toBe('https://cdn.example.com');
    expect(normalizeServer('https://cdn.example.com/base/')).toBe('https://cdn.example.com/base');
  });

  it('rejects unusable entries', () => {
    expect(normalizeServer('')).toBeNull();
    expect(normalizeServer('   ')).toBeNull();
    expect(normalizeServer('wss://relay.example.com')).toBeNull();
  });
});

describe('mergeServers', () => {
  it('keeps configured servers first and de-duplicates', () => {
    expect(
      mergeServers(['https://a.example', 'b.example'], ['https://b.example/', 'https://c.example']),
    ).toEqual(['https://a.example', 'https://b.example', 'https://c.example']);
  });
});

describe('readServerList', () => {
  it('reads BUD-03 server tags in published order', () => {
    const event = {
      kind: 10063,
      tags: [
        ['server', 'https://one.example'],
        ['other', 'ignored'],
        ['server', 'two.example'],
      ],
    } as unknown as NostrEvent;
    expect(readServerList(event)).toEqual(['https://one.example', 'https://two.example']);
  });
});

describe('ServerRanking', () => {
  it('moves a working server ahead of a failing one', () => {
    const ranking = new ServerRanking();
    const servers = ['https://a.example', 'https://b.example'];
    ranking.failed('https://a.example');
    ranking.succeeded('https://b.example');
    expect(ranking.order(servers)).toEqual(['https://b.example', 'https://a.example']);
  });

  it('leaves an untried list in its configured order', () => {
    const servers = ['https://a.example', 'https://b.example'];
    expect(new ServerRanking().order(servers)).toEqual(servers);
  });
});

describe('classifyCapabilities', () => {
  it('treats only resource as essential', () => {
    const report = classifyCapabilities(REQUIREMENTS, () => false);
    expect(report.missingEssential.map((item) => item.domain)).toEqual(['resource']);
    expect(report.missingDegraded.length).toBeGreaterThan(0);
  });

  it('reports nothing missing when every domain is present', () => {
    const report = classifyCapabilities(REQUIREMENTS, () => true);
    expect(report.missingEssential).toEqual([]);
    expect(report.missingDegraded).toEqual([]);
  });
});

describe('mime', () => {
  it('maps known extensions', () => {
    expect(mimeForName('photo.JPG')).toBe('image/jpeg');
    expect(mimeForName('clip.webm')).toBe('video/webm');
    expect(mimeForName('song.mp3')).toBe('audio/mpeg');
    expect(mimeForName('notes.md')).toBe('text/markdown');
  });

  it('falls back to octet-stream for unknown or absent extensions', () => {
    expect(mimeForName('README')).toBe('application/octet-stream');
    expect(mimeForName('archive.weird')).toBe('application/octet-stream');
    expect(extensionOf('.hidden')).toBeNull();
    expect(extensionOf('trailing.')).toBeNull();
  });

  it('classifies preview kinds', () => {
    expect(previewKindFor('a.png')).toBe('image');
    expect(previewKindFor('a.mp4')).toBe('video');
    expect(previewKindFor('a.flac')).toBe('audio');
    expect(previewKindFor('a.json')).toBe('text');
    expect(previewKindFor('a.pdf')).toBe('pdf');
    expect(previewKindFor('a.zip')).toBe('none');
  });

  it('does not render SVG, which can carry script', () => {
    expect(previewKindFor('logo.svg')).toBe('none');
  });

  it('flags timed media for transport controls', () => {
    expect(isTimedMedia('a.mp3')).toBe(true);
    expect(isTimedMedia('a.mp4')).toBe(true);
    expect(isTimedMedia('a.png')).toBe(false);
  });
});

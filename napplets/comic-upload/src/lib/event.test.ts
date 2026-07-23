import { describe, expect, it } from 'vitest';
import { buildAddress, buildComicEvent, buildIndexTags, buildIssueValue } from './event';
import type { ComicMetadata } from './comic';

const metadata: ComicMetadata = {
  Publisher: ['DC Comics'],
  Series: ['Batman'],
  Number: ['001'],
  Volume: ['2016'],
  Title: ['I Am Gotham, Part One'],
  LanguageISO: ['en'],
  Genre: ['Superhero', 'Action'],
  Writer: ['Tom King'],
  Manga: ['No'],
  BlackAndWhite: ['No'],
};

describe('comic event builder', () => {
  it('builds metadata-derived address and composite issue value', () => {
    expect(buildAddress(metadata)).toBe('cbz:dc-comics:batman:2016:1:en');
    expect(buildIssueValue(metadata)).toBe('dc-comics|batman|2016|1|en');
  });

  it('builds normalized index tags without display values', () => {
    expect(buildIndexTags(metadata)).toContainEqual(['c', 'series:batman']);
    expect(buildIndexTags(metadata)).toContainEqual(['c', 'number:1']);
    expect(buildIndexTags(metadata)).toContainEqual(['c', 'genre:superhero']);
    expect(buildIndexTags(metadata)).toContainEqual(['c', 'genre:action']);
    expect(buildIndexTags(metadata)).toContainEqual(['c', 'issue:dc-comics|batman|2016|1|en']);
  });

  it('requires thumbnail and cbz upload data in the event tags', () => {
    const event = buildComicEvent(
      {
        metadata,
        content: 'Custom description',
        cbz: {
          url: 'https://cdn.example/batman.cbz',
          sha256: 'a'.repeat(64),
          size: 1234,
        },
        thumbnail: {
          url: 'https://cdn.example/thumb.jpg',
          sha256: 'b'.repeat(64),
        },
      },
      123,
    );

    expect(event.kind).toBe(35641);
    expect(event.content).toBe('Custom description');
    expect(event.tags).toContainEqual(['thumb', 'https://cdn.example/thumb.jpg', 'b'.repeat(64)]);
    expect(event.tags).toContainEqual(['Genre', 'Superhero', 'Action']);
    expect(event.tags).not.toContainEqual(['t', 'comic']);
  });
});

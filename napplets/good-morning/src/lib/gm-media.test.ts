import { describe, it, expect } from 'vitest';
import type { NostrEvent } from '@hyprgate/types';
import { firstNoteImageSource, buildGalleryItems } from './gm-media';

function note(content: string, id = 'a'): NostrEvent {
  return { id, pubkey: 'p', created_at: 0, kind: 1, tags: [], content, sig: '' };
}

describe('firstNoteImageSource', () => {
  it('returns the first inline image URL', () => {
    expect(firstNoteImageSource('gm https://example.com/sun.jpg')).toBe(
      'https://example.com/sun.jpg',
    );
  });

  it('returns the first image when several are present', () => {
    const content = 'gm https://a.com/1.png and https://a.com/2.webp';
    expect(firstNoteImageSource(content)).toBe('https://a.com/1.png');
  });

  it('picks up a blossom resource pointer', () => {
    const sha = 'a'.repeat(64);
    expect(firstNoteImageSource(`gm blossom:sha256:${sha}`)).toBe(`blossom:sha256:${sha}`);
  });

  it('ignores non-image URLs and video', () => {
    expect(firstNoteImageSource('gm https://example.com/clip.mp4')).toBeNull();
    expect(firstNoteImageSource('gm https://example.com/page')).toBeNull();
  });

  it('returns null for a text-only note', () => {
    expect(firstNoteImageSource('good morning frens')).toBeNull();
  });
});

describe('buildGalleryItems', () => {
  it('keeps only notes that carry an image, tagged with the first image', () => {
    const notes = [
      note('gm https://a.com/1.jpg', '1'),
      note('gm no image here', '2'),
      note('gm https://a.com/3.png too https://a.com/other.gif', '3'),
    ];
    const items = buildGalleryItems(notes);
    expect(items.map((i) => i.note.id)).toEqual(['1', '3']);
    expect(items.map((i) => i.imageSource)).toEqual(['https://a.com/1.jpg', 'https://a.com/3.png']);
  });
});

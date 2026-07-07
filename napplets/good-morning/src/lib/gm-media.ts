// Extract the first displayable image from a GM note for the gallery view.
//
// Reuses the shared @hyprgate/utils content parser so the napplet agrees with
// the note renderer on what counts as an image: an inline image URL (media,
// mediaType 'image') or a resource pointer (blossom:sha256:… / NAP-RESOURCE
// image). The returned `source` is fed straight into the `resourceImageBatch`
// action, which knows how to resolve both a plain URL and a resource pointer.

import { extractNoteContentEmbeds } from '@hyprgate/utils/note-content';
import type { NostrEvent } from '@hyprgate/types';

/**
 * The first image source in a note's content, or null when it has none.
 * `source` is the value to hand to the `resourceImageBatch` image action.
 */
export function firstNoteImageSource(content: string): string | null {
  const embeds = extractNoteContentEmbeds(content, 1, {
    includeProfiles: false,
    includeEvents: false,
    includeAddresses: false,
    includeImageUrls: true,
    includeVideoUrls: false,
    includeResources: true,
  });
  const first = embeds[0];
  return first ? first.source : null;
}

/** A GM note paired with its first image source (only notes that have one). */
export interface GMGalleryItem {
  note: NostrEvent;
  imageSource: string;
}

/** Keep only the notes that carry an image, tagged with their first image. */
export function buildGalleryItems(notes: NostrEvent[]): GMGalleryItem[] {
  const items: GMGalleryItem[] = [];
  for (const note of notes) {
    const imageSource = firstNoteImageSource(note.content);
    if (imageSource) items.push({ note, imageSource });
  }
  return items;
}

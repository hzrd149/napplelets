<script lang="ts">
  import { inc as ipc } from '@napplet/sdk';
  import { resourceImageBatch as resourceImage } from '@hyprgate/utils';
  import type { GMThread } from '../lib/gm-store';
  import { buildGalleryItems } from '../lib/gm-media';
  import { createGMNoteOpenPayload, NOTE_VIEWER_OPEN_TOPIC } from '../lib/gm-actions';

  interface Props {
    /** The GM threads to show as a gallery (already filtered by the inbox). */
    threads: GMThread[];
  }

  let { threads }: Props = $props();

  // Only GMs that carry an image become gallery tiles; the note content rides
  // along as the alt/caption under each one.
  let items = $derived(buildGalleryItems(threads.map((t) => t.note)));

  // Open the note in the shell's note viewer (same intent the list rows emit).
  function openNote(event: GMThread['note']): void {
    const payload = createGMNoteOpenPayload(event);
    if (!payload) return;
    ipc.emit(NOTE_VIEWER_OPEN_TOPIC, [], JSON.stringify(payload));
  }
</script>

{#if items.length === 0}
  <div class="p-4 text-text-muted font-mono text-sm">no GM images to show today</div>
{:else}
  <div class="gm-gallery">
    {#each items as item (item.note.id)}
      <figure class="gm-tile">
        <button
          type="button"
          class="gm-tile-image"
          onclick={() => openNote(item.note)}
          data-gm-note-id={item.note.id}
          aria-label="Open GM note"
        >
          <img use:resourceImage={item.imageSource} alt={item.note.content} loading="lazy" />
        </button>
        <figcaption class="gm-tile-caption" title={item.note.content}>
          {item.note.content}
        </figcaption>
      </figure>
    {/each}
  </div>
{/if}

<style>
  .gm-gallery {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 12px;
    padding: 12px;
  }

  .gm-tile {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .gm-tile-image {
    display: block;
    width: 100%;
    aspect-ratio: 1 / 1;
    padding: 0;
    border: 1px solid var(--hg-border-dim, #3a3a3a);
    border-radius: 6px;
    overflow: hidden;
    background: var(--hg-bg-surface, #1a1a1a);
    cursor: pointer;
    transition:
      border-color 120ms,
      transform 120ms;
  }

  .gm-tile-image:hover {
    border-color: var(--hg-accent-green, #9be564);
    transform: translateY(-1px);
  }

  .gm-tile-image img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .gm-tile-caption {
    font-size: 11px;
    line-height: 1.4;
    font-family: var(--hg-font-mono, monospace);
    color: var(--hg-text-muted, #b8b1a4);
    /* Clamp to a couple of lines so tall notes don't stretch the tile. */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    word-break: break-word;
  }
</style>

<script lang="ts">
  import * as nip19 from 'nostr-tools/nip19';
  import { inc as ipc } from '@napplet/sdk';
  import { resourceImageBatch as resourceImage } from '../lib/resource-image';
  import type { GMThread } from '../lib/gm-store';
  import type { ProfileContent } from '../lib/profile-metadata';
  import { buildGalleryItems } from '../lib/gm-media';
  import { createGMNoteOpenPayload, NOTE_VIEWER_OPEN_TOPIC } from '../lib/gm-actions';
  import { isNapDomainPresent } from '../lib/runtime-domain';

  interface Props {
    /** The GM threads to show as a gallery (already filtered by the inbox). */
    threads: GMThread[];
    /** Author profile metadata, keyed by pubkey, for the floating avatars. */
    profiles: Map<string, ProfileContent>;
  }

  let { threads, profiles }: Props = $props();
  const resourceAvailable = isNapDomainPresent('resource');

  // Only GMs that carry an image become gallery tiles; the note content rides
  // along as the alt/caption under each one.
  let items = $derived(buildGalleryItems(threads.map((t) => t.note)));

  // note.id → isRead, so each tile can show the "responded" check for a GM we
  // already replied to (mirrors the big check in the list row).
  let readByNoteId = $derived(new Map(threads.map((t) => [t.note.id, t.isRead])));

  function shortenPubkey(pubkey: string): string {
    try {
      return nip19.npubEncode(pubkey).slice(0, 16) + '...';
    } catch {
      return pubkey.slice(0, 12) + '...';
    }
  }

  function authorName(pubkey: string): string {
    const profile = profiles.get(pubkey);
    return profile?.display_name ?? profile?.name ?? shortenPubkey(pubkey);
  }

  function avatarUrl(pubkey: string): string | null {
    return profiles.get(pubkey)?.picture ?? null;
  }

  function avatarFallback(pubkey: string): string {
    const profile = profiles.get(pubkey);
    const name = profile?.name ?? profile?.display_name ?? '';
    return name.slice(0, 2).toUpperCase() || pubkey.slice(0, 2).toUpperCase();
  }

  // Open the note in the shell's note viewer (same intent the list rows emit).
  function openNote(event: GMThread['note']): void {
    const payload = createGMNoteOpenPayload(event);
    if (!payload) return;
    ipc.emit(NOTE_VIEWER_OPEN_TOPIC, [], JSON.stringify(payload));
  }
</script>

{#if items.length === 0}
  <div class="p-4 text-base-content/60 font-mono text-sm">no GM images to show today</div>
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
          {#if resourceAvailable}
            <img use:resourceImage={item.imageSource} alt={item.note.content} loading="lazy" />
          {:else}
            <span class="gm-tile-unavailable">media unavailable</span>
          {/if}

          <!-- Author avatar floating in the upper-left corner (decorative — the
               whole tile opens the note). -->
          <span
            class="gm-tile-avatar"
            title={authorName(item.note.pubkey)}
            data-gm-author-pubkey={item.note.pubkey}
          >
            {#if resourceAvailable && avatarUrl(item.note.pubkey) != null}
              <img
                use:resourceImage={avatarUrl(item.note.pubkey)}
                alt={authorName(item.note.pubkey)}
                loading="lazy"
              />
            {:else}
              <span class="gm-tile-avatar-fallback">{avatarFallback(item.note.pubkey)}</span>
            {/if}
          </span>

          <!-- Responded check in the lower-right corner when we've GM'd back. -->
          {#if readByNoteId.get(item.note.id)}
            <span
              class="gm-tile-check"
              title="You replied with a GM"
              aria-label="Responded with a GM"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="3"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
          {/if}
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
    position: relative;
    display: block;
    width: 100%;
    aspect-ratio: 1 / 1;
    padding: 0;
    border: 1px solid var(--color-base-300, #2b2519);
    border-radius: 6px;
    overflow: hidden;
    background: var(--color-base-200, #1f1b13);
    cursor: pointer;
    transition:
      border-color 120ms,
      transform 120ms;
  }

  .gm-tile-unavailable {
    display: grid;
    width: 100%;
    height: 100%;
    place-items: center;
    color: color-mix(in srgb, var(--color-base-content, #f5f1e8) 60%, transparent);
    font-size: 0.75rem;
  }

  /* Overlays ride above the image but never intercept the tile's click. */
  .gm-tile-avatar,
  .gm-tile-check {
    position: absolute;
    z-index: 1;
    pointer-events: none;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .gm-tile-avatar {
    top: 6px;
    left: 6px;
    width: 28px;
    height: 28px;
    border-radius: 9999px;
    border: 2px solid var(--color-base-100, #14110c);
    background: var(--color-base-200, #1f1b13);
    box-shadow: 0 1px 3px rgb(0 0 0 / 45%);
  }

  .gm-tile-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .gm-tile-avatar-fallback {
    font-size: 10px;
    font-family: var(--gm-font-body, monospace);
    color: color-mix(in srgb, var(--color-base-content, #f5f1e8) 60%, transparent);
  }

  .gm-tile-check {
    right: 6px;
    bottom: 6px;
    width: 24px;
    height: 24px;
    border-radius: 9999px;
    color: var(--color-primary-content, #111827);
    background: var(--color-primary, #9be564);
    box-shadow: 0 1px 3px rgb(0 0 0 / 45%);
  }

  .gm-tile-image:hover {
    border-color: var(--color-primary, #9be564);
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
    font-family: var(--gm-font-body, monospace);
    color: color-mix(in srgb, var(--color-base-content, #f5f1e8) 60%, transparent);
    /* Clamp to a couple of lines so tall notes don't stretch the tile. */
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    word-break: break-word;
  }
</style>

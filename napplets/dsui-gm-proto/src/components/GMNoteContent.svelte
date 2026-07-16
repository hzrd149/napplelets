<script lang="ts">
  import { inc as ipc } from '@napplet/sdk';
  import { isCanonicalHexPubkey } from '../lib/intent-topics';
  import { parseNoteContent } from '../lib/note-content';
  import {
    resourceImageBatch as resourceImage,
    resourceVideoBatch as resourceVideo,
  } from '../lib/resource-image';
  import { createGMReferenceOpenPayload, NOTE_VIEWER_OPEN_TOPIC } from '../lib/gm-actions';
  import { openExternalLink } from '../lib/link-client';
  import { isNapDomainPresent } from '../lib/runtime-domain';

  interface Props {
    content: string;
    emojiTags?: string[][];
    profileLabel?: (pubkey: string) => string;
  }

  let { content, emojiTags = [], profileLabel }: Props = $props();
  const resourceAvailable = isNapDomainPresent('resource');
  let blocks = $derived(parseNoteContent(content, emojiTags));

  function openProfile(pubkey: string): void {
    if (!isCanonicalHexPubkey(pubkey)) return;
    ipc.emit('profile:open', [], JSON.stringify({ pubkey }));
  }

  function handleLinkClick(event: MouseEvent, url: string): void {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    // Link opening is degradable. Preserve the sandbox when NAP-LINK is
    // unavailable instead of navigating the iframe directly to the URL.
    void openExternalLink(url);
  }

  function openReference(source: string): void {
    const payload = createGMReferenceOpenPayload(source);
    if (!payload) return;
    ipc.emit(NOTE_VIEWER_OPEN_TOPIC, [], JSON.stringify(payload));
  }
</script>

<span class="gm-note-content">
  {#each blocks as block, index (`${index}:${block.type}:${block.value}`)}
    {#if block.type === 'text'}
      {block.value}
    {:else if block.type === 'profile'}
      <button type="button" class="gm-inline-link" onclick={() => openProfile(block.value)}>
        @{profileLabel?.(block.value) ?? block.source.replace(/^nostr:/, '').slice(0, 16)}
      </button>
    {:else if block.type === 'event' || block.type === 'address'}
      <button type="button" class="gm-inline-link" onclick={() => openReference(block.source)}>
        {block.source.replace(/^nostr:/, '').slice(0, 24)}...
      </button>
    {:else if block.type === 'url'}
      <a
        class="gm-inline-link"
        href={block.value}
        onclick={(event) => handleLinkClick(event, block.value)}
      >
        {block.value}
      </a>
    {:else if block.type === 'media' && block.mediaType === 'image'}
      {#if resourceAvailable}
        <span class="gm-inline-resource">
          <img use:resourceImage={block.value} alt="Good morning media" loading="lazy" />
        </span>
      {:else}
        <span class="text-base-content/60">[media unavailable]</span>
      {/if}
    {:else if block.type === 'media' && block.mediaType === 'video'}
      {#if resourceAvailable}
        <span class="gm-inline-resource">
          <video use:resourceVideo={block.value} controls preload="auto"></video>
        </span>
      {:else}
        <span class="text-base-content/60">[media unavailable]</span>
      {/if}
    {:else if block.type === 'resource'}
      {#if resourceAvailable}
        <span class="gm-inline-resource">
          <img use:resourceImage={block.source} alt="GM attachment" loading="lazy" />
        </span>
      {:else}
        <span class="text-base-content/60">[attachment unavailable]</span>
      {/if}
    {:else if block.type === 'emoji'}
      {#if resourceAvailable}
        <img
          class="gm-inline-emoji"
          use:resourceImage={block.imageUrl}
          alt={block.source}
          loading="lazy"
        />
      {:else}
        {block.source}
      {/if}
    {:else}
      {block.source}
    {/if}
  {/each}
</span>

<style>
  .gm-note-content {
    white-space: pre-wrap;
  }

  .gm-inline-link {
    color: var(--color-primary, #9be564);
    background: transparent;
    border: none;
    padding: 0;
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
    overflow-wrap: anywhere;
  }

  .gm-inline-resource {
    display: block;
    margin-top: 6px;
  }

  .gm-inline-resource img,
  .gm-inline-resource video {
    max-width: min(100%, 360px);
    max-height: 260px;
    border-radius: 6px;
    border: 1px solid var(--color-base-300, #2b2519);
    object-fit: contain;
  }

  .gm-inline-emoji {
    display: inline-block;
    width: 1.25em;
    height: 1.25em;
    vertical-align: -0.2em;
    object-fit: contain;
  }
</style>

<script lang="ts">
  import { inc as ipc, link } from '@napplet/sdk';
  import { isCanonicalHexPubkey } from '../lib/intent-topics';
  import { parseNoteContent } from '../lib/note-content';
  import { resourceImageBatch as resourceImage } from '../lib/resource-image';
  import { createGMReferenceOpenPayload, NOTE_VIEWER_OPEN_TOPIC } from '../lib/gm-actions';

  interface Props {
    content: string;
    emojiTags?: string[][];
    profileLabel?: (pubkey: string) => string;
  }

  let { content, emojiTags = [], profileLabel }: Props = $props();
  let blocks = $derived(parseNoteContent(content, emojiTags));

  function openProfile(pubkey: string): void {
    if (!isCanonicalHexPubkey(pubkey)) return;
    ipc.emit('profile:open', [], JSON.stringify({ pubkey }));
  }

  // NAP-LINK: route external links through the shell-owned opener so the new
  // browsing context does not inherit this napplet's origin.
  async function openLink(url: string): Promise<boolean> {
    const result = await link.open(url);
    return result.status === 'opened';
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
    void openLink(url);
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
      <a
        class="gm-inline-link"
        href={block.value}
        onclick={(event) => handleLinkClick(event, block.value)}
      >
        {block.value}
      </a>
    {:else if block.type === 'resource'}
      <span class="gm-inline-resource">
        <img use:resourceImage={block.source} alt="GM attachment" loading="lazy" />
      </span>
    {:else if block.type === 'emoji'}
      <img
        class="gm-inline-emoji"
        use:resourceImage={block.imageUrl}
        alt={block.source}
        loading="lazy"
      />
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
    color: var(--hg-accent-green, #9be564);
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

  .gm-inline-resource img {
    max-width: min(100%, 360px);
    max-height: 260px;
    border-radius: 6px;
    border: 1px solid var(--hg-border-dim, #3a3a3a);
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

<script lang="ts">
  import { format } from 'timeago.js';
  import * as nip19 from 'nostr-tools/nip19';
  import { inc as ipc } from '@napplet/sdk';
  import { isCanonicalHexPubkey } from '../lib/intent-topics';
  import { pubkeyColorStyle } from '../lib/pubkey-color';
  import { resourceImageBatch as resourceImage } from '../lib/resource-image';
  import { isNapDomainPresent } from '../lib/runtime-domain';
  import type { NostrEvent } from '../lib/nostr';
  import type { ProfileContent } from '../lib/profile-metadata';
  import {
    createGMNoteOpenPayload,
    createGMReplyComposePayload,
    publishQuickGM,
    COMPOSER_OPEN_TOPIC,
    NOTE_VIEWER_OPEN_TOPIC,
  } from '../lib/gm-actions';
  import GMNoteContent from './GMNoteContent.svelte';

  interface Props {
    event: NostrEvent;
    /** True when the user has already GM-replied to this note (shows the ✓). */
    isRead: boolean;
    profile?: ProfileContent;
    profiles: Map<string, ProfileContent>;
  }

  let { event, isRead, profile, profiles }: Props = $props();
  const resourceAvailable = isNapDomainPresent('resource');

  type QuickState = 'idle' | 'sending' | 'sent' | 'error';
  let quickState = $state<QuickState>('idle');

  function shortenPubkey(pubkey: string): string {
    try {
      return nip19.npubEncode(pubkey).slice(0, 16) + '...';
    } catch {
      return pubkey.slice(0, 12) + '...';
    }
  }

  let authorName = $derived.by(
    () => profile?.display_name ?? profile?.name ?? shortenPubkey(event.pubkey),
  );
  let avatarUrl = $derived.by(() => profile?.picture ?? null);
  let avatarFallback = $derived.by(() => {
    const name = profile?.name ?? profile?.display_name ?? '';
    return name.slice(0, 2).toUpperCase() || event.pubkey.slice(0, 2).toUpperCase();
  });
  let relativeTime = $derived.by(() => format(event.created_at * 1000));

  // Open the thread in the note viewer.
  function openNote(): void {
    const payload = createGMNoteOpenPayload(event);
    if (!payload) return;
    ipc.emit(NOTE_VIEWER_OPEN_TOPIC, [], JSON.stringify(payload));
  }

  // Publish a one-tap "GM" reply directly. The user's own-replies subscription
  // then streams it back and flips isRead → the big check appears.
  async function quickGM(): Promise<void> {
    if (quickState === 'sending' || isRead) return;
    quickState = 'sending';
    try {
      await publishQuickGM(event);
      quickState = 'sent';
    } catch (error) {
      console.error('[dsui-gm-proto] Quick GM publish failed:', error);
      quickState = 'error';
    }
  }

  // Open the composer napplet so the user can write their own reply.
  function openComposer(): void {
    ipc.emit(COMPOSER_OPEN_TOPIC, [], JSON.stringify(createGMReplyComposePayload(event)));
  }

  function openProfile(): void {
    if (!isCanonicalHexPubkey(event.pubkey)) return;
    ipc.emit('profile:open', [], JSON.stringify({ pubkey: event.pubkey }));
  }

  function profileLabel(pubkey: string): string {
    const referenced = profiles.get(pubkey);
    return referenced?.display_name ?? referenced?.name ?? shortenPubkey(pubkey);
  }

  // Already greeted (via Quick GM, the composer, or the note viewer) → no need to
  // GM again. isRead is derived from the user's own GM replies in the store.
  let quickDisabled = $derived(quickState === 'sending' || isRead);

  let quickLabel = $derived.by(() => {
    if (quickState === 'sending') return 'sending…';
    if (isRead || quickState === 'sent') return 'GM sent ✓';
    if (quickState === 'error') return 'retry GM';
    return 'Quick GM';
  });
</script>

<div
  class="gm-row flex gap-2 p-2 border-b border-base-300 transition-colors {isRead
    ? 'opacity-80'
    : 'bg-primary/5'}"
  data-gm-note-id={event.id}
  data-gm-is-read={isRead}
>
  <!-- Left column: avatar at top, big green check pinned to the bottom -->
  <div class="flex flex-col items-center flex-shrink-0">
    <button
      type="button"
      class="avatar avatar-placeholder w-8 h-8 rounded-full overflow-hidden cursor-pointer bg-base-200 border border-base-300 flex items-center justify-center"
      onclick={openProfile}
      aria-label="Open profile for {authorName}"
    >
      {#if resourceAvailable && avatarUrl != null}
        <img
          use:resourceImage={avatarUrl}
          alt={authorName}
          class="w-full h-full object-cover"
          loading="lazy"
        />
      {:else}
        <span class="text-base-content/60 text-xs font-mono">{avatarFallback}</span>
      {/if}
    </button>

    <div class="flex-1"></div>

    {#if isRead}
      <span
        class="gm-check mt-2 w-7 h-7 rounded-full bg-primary text-primary-content flex items-center justify-center"
        title="You replied with a GM"
        aria-label="Responded with a GM"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
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
  </div>

  <!-- Right column -->
  <div class="flex-1 min-w-0">
    <div class="flex items-baseline gap-2 mb-1">
      <button
        type="button"
        class="text-sm font-semibold font-mono truncate hover:underline cursor-pointer bg-transparent border-none p-0"
        style={pubkeyColorStyle(event.pubkey)}
        onclick={openProfile}
        data-gm-author-pubkey={event.pubkey}
      >
        {authorName}
      </button>
      <span class="text-base-content/60 text-xs flex-shrink-0">{relativeTime}</span>
    </div>

    <div class="text-base-content text-sm leading-relaxed break-words">
      <GMNoteContent content={event.content} emojiTags={event.tags} {profileLabel} />
    </div>

    <!-- Actions -->
    <div class="flex flex-wrap gap-2 mt-2">
      <button type="button" class="btn btn-xs" onclick={openNote} data-gm-action="open">
        Open
      </button>
      <button
        type="button"
        class="btn btn-xs btn-primary"
        onclick={quickGM}
        disabled={quickDisabled}
        data-gm-action="quick-gm"
        data-gm-quick-state={quickState}
      >
        {quickLabel}
      </button>
      <button type="button" class="btn btn-xs" onclick={openComposer} data-gm-action="reply">
        GM Reply
      </button>
    </div>
  </div>
</div>

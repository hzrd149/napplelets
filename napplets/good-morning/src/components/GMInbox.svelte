<script lang="ts">
  import { onMount } from 'svelte';
  import type { NostrEvent } from '@hyprgate/types';
  import type { Subscription } from '@napplet/sdk';
  import { createGMStore, buildGMThreads, type GMThread } from '../lib/gm-store';
  import { subscribeProfileMetadata, type ProfileContent } from '../lib/profile-metadata';
  import GMRow from './GMRow.svelte';
  import GMGallery from './GMGallery.svelte';

  interface Props {
    /** The logged-in user's pubkey. Null renders the empty state. */
    pubkey: string | null;
  }

  let { pubkey }: Props = $props();

  const PROFILE_METADATA_BATCH_MS = 250;

  // ── Reactive copies of the plain (non-rune) store state ──────────────────
  // syncState is the store's notify callback: every store mutation copies its
  // Maps into fresh references so Svelte's referential check re-renders.
  let gmNotes = $state(new Map<string, NostrEvent>());
  let userReplies = $state(new Map<string, NostrEvent>());
  let contactCount = $state(0);
  let contactsLoaded = $state(false);
  let scanning = $state(false);

  function syncState(): void {
    const s = store.state;
    gmNotes = new Map(s.gmNotes);
    userReplies = new Map(s.userReplies);
    contactCount = s.contactCount;
    contactsLoaded = s.contactsLoaded;
    scanning = s.scanning;
    loadMissingProfiles([...s.gmNotes.values()]);
  }

  const store = createGMStore(syncState);

  let threads = $derived<GMThread[]>(buildGMThreads(gmNotes, userReplies));
  let pendingCount = $derived(threads.filter((t) => !t.isRead).length);
  let repliedCount = $derived(threads.length - pendingCount);

  // ── Replied/unreplied filter ──────────────────────────────────────────────
  type GMFilter = 'all' | 'unreplied' | 'replied';
  let filter = $state<GMFilter>('all');

  const FILTERS: { id: GMFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'unreplied', label: 'Unreplied' },
    { id: 'replied', label: 'Replied' },
  ];

  function filterCount(id: GMFilter): number {
    if (id === 'replied') return repliedCount;
    if (id === 'unreplied') return pendingCount;
    return threads.length;
  }

  let visibleThreads = $derived<GMThread[]>(
    filter === 'all'
      ? threads
      : filter === 'replied'
        ? threads.filter((t) => t.isRead)
        : threads.filter((t) => !t.isRead),
  );

  // ── List / gallery view toggle ────────────────────────────────────────────
  // The gallery view shows each GM's first image with the note content as the
  // caption/alt underneath — a way to browse the day's GMs as an image wall.
  type GMView = 'list' | 'gallery';
  let view = $state<GMView>('list');

  const VIEWS: { id: GMView; label: string }[] = [
    { id: 'list', label: 'List' },
    { id: 'gallery', label: 'Gallery' },
  ];

  // ── Profile metadata (same batched pattern as the feed napplet) ───────────
  let profileMap = $state(new Map<string, ProfileContent>());
  const loadingPubkeys = new Set<string>();
  const profileSubscriptions = new Set<Subscription>();
  const queuedProfilePubkeys = new Set<string>();
  let profileBatchTimer: ReturnType<typeof setTimeout> | null = null;

  function loadMissingProfiles(events: NostrEvent[]): void {
    const missing = events
      .map((event) => event.pubkey)
      .filter((pk) => pk.length > 0 && !loadingPubkeys.has(pk) && !profileMap.has(pk));
    if (missing.length === 0) return;

    for (const pk of missing) queuedProfilePubkeys.add(pk);
    if (profileBatchTimer !== null) return;

    profileBatchTimer = setTimeout(() => {
      profileBatchTimer = null;
      flushProfileMetadataBatch();
    }, PROFILE_METADATA_BATCH_MS);
  }

  function flushProfileMetadataBatch(): void {
    const missing = [...queuedProfilePubkeys].filter(
      (pk) => !loadingPubkeys.has(pk) && !profileMap.has(pk),
    );
    queuedProfilePubkeys.clear();
    if (missing.length === 0) return;

    for (const pk of missing) loadingPubkeys.add(pk);

    try {
      const subscription = subscribeProfileMetadata(missing, (pk, metadata) => {
        // Immutable Map at the Svelte boundary so rows drop the npub fallback
        // once metadata arrives.
        profileMap = new Map(profileMap).set(pk, metadata);
        loadingPubkeys.delete(pk);
      });
      profileSubscriptions.add(subscription);
    } catch {
      for (const pk of missing) loadingPubkeys.delete(pk);
    }
  }

  // Drive (re)initialization off pubkey. store.setPubkey is idempotent for an
  // unchanged pubkey and resets cleanly on an identity switch.
  $effect(() => {
    store.setPubkey(pubkey);
  });

  onMount(() => {
    return () => {
      if (profileBatchTimer !== null) {
        clearTimeout(profileBatchTimer);
        profileBatchTimer = null;
      }
      for (const subscription of profileSubscriptions) subscription.close();
      profileSubscriptions.clear();
      store.destroy();
    };
  });
</script>

<div
  class="gm-inbox flex flex-col h-full bg-bg-base"
  data-gm-contact-count={contactCount}
  data-gm-pending={pendingCount}
  data-gm-thread-count={threads.length}
  data-gm-filter={filter}
  data-gm-view={view}
  data-gm-visible-count={visibleThreads.length}
>
  <!-- Header -->
  <div class="flex items-center gap-2 px-3 py-2 border-b border-border-dim flex-shrink-0">
    <span class="text-sm font-semibold font-mono text-accent-green">GM</span>
    <span class="text-text-muted text-xs">{contactCount} contacts</span>
    <div class="flex-1"></div>

    <!-- List / gallery view toggle (radio group) -->
    <div class="gm-filter flex" role="radiogroup" aria-label="View mode">
      {#each VIEWS as option (option.id)}
        <button
          type="button"
          role="radio"
          aria-checked={view === option.id}
          class="gm-filter-btn {view === option.id ? 'is-active' : ''}"
          data-gm-view-option={option.id}
          onclick={() => (view = option.id)}
        >
          {option.label}
        </button>
      {/each}
    </div>

    <!-- Replied / unreplied filter (radio group) -->
    <div class="gm-filter flex" role="radiogroup" aria-label="Filter GMs">
      {#each FILTERS as option (option.id)}
        <button
          type="button"
          role="radio"
          aria-checked={filter === option.id}
          class="gm-filter-btn {filter === option.id ? 'is-active' : ''}"
          data-gm-filter-option={option.id}
          onclick={() => (filter = option.id)}
        >
          {option.label}
          <span class="gm-filter-count">{filterCount(option.id)}</span>
        </button>
      {/each}
    </div>
  </div>

  <!-- Inbox -->
  <div class="flex-1 overflow-y-auto">
    {#if !contactsLoaded}
      <div class="p-4 text-text-muted font-mono text-sm animate-pulse">loading contacts…</div>
    {:else if threads.length === 0 && scanning}
      <div class="p-4 text-text-muted font-mono text-sm animate-pulse">scanning for GMs…</div>
    {:else if threads.length === 0}
      <div class="p-4 text-text-muted font-mono text-sm">no GMs from your contacts today</div>
    {:else if visibleThreads.length === 0}
      <div class="p-4 text-text-muted font-mono text-sm">
        {filter === 'replied' ? 'no replied GMs yet' : 'no unreplied GMs — all caught up'}
      </div>
    {:else if view === 'gallery'}
      <GMGallery threads={visibleThreads} profiles={profileMap} />
    {:else}
      {#each visibleThreads as thread (thread.note.id)}
        <GMRow
          event={thread.note}
          isRead={thread.isRead}
          profile={profileMap.get(thread.note.pubkey)}
          profiles={profileMap}
        />
      {/each}
    {/if}
  </div>
</div>

<style>
  .gm-filter {
    border: 1px solid var(--hg-border-dim, #3a3a3a);
    border-radius: 4px;
    overflow: hidden;
  }

  .gm-filter-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 8px;
    font-size: 11px;
    font-family: var(--hg-font-mono, monospace);
    color: var(--hg-text-muted, #b8b1a4);
    background: transparent;
    border: none;
    border-left: 1px solid var(--hg-border-dim, #3a3a3a);
    cursor: pointer;
    transition:
      color 120ms,
      background 120ms;
  }

  .gm-filter-btn:first-child {
    border-left: none;
  }

  .gm-filter-btn:hover {
    color: var(--hg-text-primary, #f5f1e8);
  }

  .gm-filter-btn.is-active {
    color: var(--hg-accent-green, #9be564);
    background: color-mix(in srgb, var(--hg-accent-green, #9be564) 14%, transparent);
  }

  .gm-filter-count {
    font-size: 10px;
    opacity: 0.75;
  }
</style>

// napplets/good-morning/src/lib/gm-store.ts
//
// The GM inbox state machine. Mirrors gm-protocol's GMProvider, ported to the
// hyprgate napplet runtime (NAP-OUTBOX routing instead of an NPool):
//
//   1. Load the user's contacts from their newest kind-3 (follow list).
//   2. Subscribe to kind-1 notes from those contacts since local midnight; keep
//      the ones that `containsGM` — these are the inbox candidates.
//   3. Subscribe to the user's OWN kind-1 notes since midnight; a GM that carries
//      an `e` tag is a GM reply. A root inbox note is "read" (✓) when any of the
//      user's GM replies e-tags it.
//
// Kept as plain mutable TS (no Svelte runes) so it is unit-testable without the
// Svelte compiler; the component bridges state into `$state` via the notify
// callback (the canonical feed-store / profile-store pattern).

import type { Subscription } from '@napplet/sdk';
import type { NostrEvent } from '@hyprgate/types';
import { containsGM } from './gm-detection';
import { subscribeForPayload } from './gm-origin';

const KIND_CONTACTS = 3;
const KIND_TEXT_NOTE = 1;
/** Relay author-array cap — match gm-protocol's batching of follows. */
const AUTHOR_BATCH_SIZE = 500;

export interface GMThread {
  /** The root GM note (a contact's GM with no `e` tag). */
  note: NostrEvent;
  /** True when the user has already replied with a GM that e-tags this note. */
  isRead: boolean;
}

export interface GMStoreState {
  /** Contacts' GM notes (roots AND replies), keyed by event id. */
  gmNotes: Map<string, NostrEvent>;
  /** The user's own GM replies (kind-1, contains GM, has an `e` tag), by id. */
  userReplies: Map<string, NostrEvent>;
  contactCount: number;
  contactsLoaded: boolean;
  /** True while the initial scan of contacts' notes is in flight. */
  scanning: boolean;
  pubkey: string | null;
  error: string | null;
}

export interface GMStore {
  readonly state: GMStoreState;
  /** (Re)initialize for a pubkey. Safe to call again on identity change. */
  setPubkey(pubkey: string | null): void;
  destroy(): void;
}

// ── Pure helpers (exported for unit tests) ──────────────────────────────────

/** Local-midnight epoch seconds — the inbox window start (matches gm-protocol). */
export function startOfTodaySeconds(now: Date = new Date()): number {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return Math.floor(midnight.getTime() / 1000);
}

/** True when the event carries at least one `e` tag (i.e. it is a reply). */
export function hasETag(event: NostrEvent): boolean {
  return event.tags.some((tag) => tag[0] === 'e');
}

/** Extract the followed pubkeys (`p` tags) from a kind-3 contact list event. */
export function contactsFromKind3(event: NostrEvent): string[] {
  return event.tags
    .filter((tag): tag is [string, string, ...string[]] =>
      tag[0] === 'p' && typeof tag[1] === 'string' && tag[1].length > 0)
    .map((tag) => tag[1]);
}

/** Split an array into fixed-size chunks. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Build the inbox from contacts' GM notes + the user's GM replies.
 *
 * Roots = GM notes WITHOUT an `e` tag (a GM reply is not its own inbox row).
 * `isRead` = any of the user's GM replies has an `e` tag whose value equals the
 * root's id (plain e-tag value match, as in gm-protocol's Index page). Sorted
 * newest-first.
 */
export function buildGMThreads(
  gmNotes: Map<string, NostrEvent>,
  userReplies: Map<string, NostrEvent>,
): GMThread[] {
  const repliedRootIds = new Set<string>();
  for (const reply of userReplies.values()) {
    for (const tag of reply.tags) {
      if (tag[0] === 'e' && typeof tag[1] === 'string') repliedRootIds.add(tag[1]);
    }
  }

  return [...gmNotes.values()]
    .filter((note) => !hasETag(note))
    .map((note) => ({ note, isRead: repliedRootIds.has(note.id) }))
    .sort((a, b) => b.note.created_at - a.note.created_at);
}

// ── Store factory ───────────────────────────────────────────────────────────

export function createGMStore(notify: () => void): GMStore {
  const state: GMStoreState = {
    gmNotes: new Map(),
    userReplies: new Map(),
    contactCount: 0,
    contactsLoaded: false,
    scanning: false,
    pubkey: null,
    error: null,
  };

  let contactsSub: Subscription | null = null;
  let ownRepliesSub: Subscription | null = null;
  let gmBatchSubs: Subscription[] = [];

  // The inbox window is pinned at init (gm-protocol computes it once at mount
  // too); a window left open across midnight keeps yesterday's `since`.
  let since = startOfTodaySeconds();
  let bestContactsCreatedAt = 0;
  let pendingBatchEose = 0;

  function closeGmBatches(): void {
    for (const sub of gmBatchSubs) sub.close();
    gmBatchSubs = [];
  }

  function closeAll(): void {
    contactsSub?.close();
    contactsSub = null;
    ownRepliesSub?.close();
    ownRepliesSub = null;
    closeGmBatches();
  }

  function restartGmNotesSubscription(contactPubkeys: string[]): void {
    closeGmBatches();

    if (contactPubkeys.length === 0) {
      state.scanning = false;
      notify();
      return;
    }

    const batches = chunk(contactPubkeys, AUTHOR_BATCH_SIZE);
    pendingBatchEose = batches.length;
    state.scanning = true;
    notify();

    for (const batch of batches) {
      const sub = subscribeForPayload(
        { filters: [{ kinds: [KIND_TEXT_NOTE], authors: batch, since }], origin: 'outbox' },
        {
          onEvent: (event) => {
            if (event.kind !== KIND_TEXT_NOTE) return;
            if (!containsGM(event.content)) return;
            if (state.gmNotes.has(event.id)) return;
            state.gmNotes.set(event.id, event);
            notify();
          },
          onEose: () => {
            // Do NOT close on EOSE — the outbox subscription stays live so GMs
            // that land after the initial burst still stream into the inbox.
            if (pendingBatchEose > 0) pendingBatchEose -= 1;
            if (pendingBatchEose === 0 && state.scanning) {
              state.scanning = false;
              notify();
            }
          },
        },
      );
      gmBatchSubs.push(sub);
    }
  }

  function subscribeOwnReplies(pubkey: string): void {
    ownRepliesSub = subscribeForPayload(
      { filters: [{ kinds: [KIND_TEXT_NOTE], authors: [pubkey], since }], origin: 'outbox' },
      {
        onEvent: (event) => {
          if (event.kind !== KIND_TEXT_NOTE) return;
          // A GM reply = a GM that e-tags the note it answers.
          if (!containsGM(event.content) || !hasETag(event)) return;
          if (state.userReplies.has(event.id)) return;
          state.userReplies.set(event.id, event);
          notify();
        },
        onEose: () => { /* stay live for replies published while the inbox is open */ },
      },
    );
  }

  function subscribeContacts(pubkey: string): void {
    contactsSub = subscribeForPayload(
      { filters: [{ kinds: [KIND_CONTACTS], authors: [pubkey], limit: 5 }], origin: 'outbox' },
      {
        onEvent: (event) => {
          // Track the newest kind-3 (replaceable): a stale copy from one relay
          // must not clobber a fresher follow list from another.
          if (event.kind !== KIND_CONTACTS || event.created_at <= bestContactsCreatedAt) return;
          bestContactsCreatedAt = event.created_at;
          const contactPubkeys = contactsFromKind3(event);
          state.contactCount = contactPubkeys.length;
          state.contactsLoaded = true;
          notify();
          restartGmNotesSubscription(contactPubkeys);
        },
        onEose: () => {
          // No follow list found → settle the empty state so the UI stops
          // showing a perpetual "loading".
          if (!state.contactsLoaded) {
            state.contactsLoaded = true;
            state.scanning = false;
            notify();
          }
        },
      },
    );
  }

  function reset(): void {
    closeAll();
    state.gmNotes = new Map();
    state.userReplies = new Map();
    state.contactCount = 0;
    state.contactsLoaded = false;
    state.scanning = false;
    state.error = null;
    bestContactsCreatedAt = 0;
    pendingBatchEose = 0;
    since = startOfTodaySeconds();
  }

  function setPubkey(pubkey: string | null): void {
    if (pubkey === state.pubkey) return;
    reset();
    state.pubkey = pubkey;
    if (!pubkey) {
      notify();
      return;
    }
    state.scanning = true;
    notify();
    subscribeContacts(pubkey);
    subscribeOwnReplies(pubkey);
  }

  function destroy(): void {
    closeAll();
  }

  return {
    get state() {
      return state;
    },
    setPubkey,
    destroy,
  };
}

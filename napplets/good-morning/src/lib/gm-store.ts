// napplets/good-morning/src/lib/gm-store.ts
//
// The GM inbox state machine. Mirrors gm-protocol's GMProvider, ported to the
// hyprgate napplet runtime:
//
//   1. Load the user's contacts from the runtime via NAP-IDENTITY
//      (identity.getFollows()) — the shell owns resolving the newest kind-3, so
//      the napplet never fetches the follow list itself.
//   2. Subscribe (NAP-OUTBOX) to kind-1 notes from those contacts since local
//      midnight; keep the ones that `containsGM` — these are the inbox candidates.
//   3. Subscribe (NAP-OUTBOX) to the user's OWN kind-1 notes since midnight; a GM
//      that carries an `e` tag is a GM reply. A root inbox note is "read" (✓) when
//      any of the user's GM replies e-tags it.
//
// Kept as plain mutable TS (no Svelte runes) so it is unit-testable without the
// Svelte compiler; the component bridges state into `$state` via the notify
// callback (the canonical feed-store / profile-store pattern).

import { identity, type Subscription } from '@napplet/sdk';
import type { NostrEvent } from '@hyprgate/types';
import { containsGM } from './gm-detection';
import { subscribeForPayload } from './gm-origin';

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

  let ownRepliesSub: Subscription | null = null;
  let gmBatchSubs: Subscription[] = [];

  // The inbox window is pinned at init (gm-protocol computes it once at mount
  // too); a window left open across midnight keeps yesterday's `since`.
  let since = startOfTodaySeconds();
  let pendingBatchScans = 0;
  // Bumped on every teardown so an in-flight identity.getFollows() resolving
  // after a reset/destroy or identity switch is discarded instead of mutating
  // stale state (there is no subscription handle to close on an async query).
  let contactsLoadToken = 0;

  function closeGmBatches(): void {
    for (const sub of gmBatchSubs) sub.close();
    gmBatchSubs = [];
  }

  function closeAll(): void {
    contactsLoadToken += 1;
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
    pendingBatchScans = batches.length;
    state.scanning = true;
    notify();

    for (const batch of batches) {
      const sub = subscribeForPayload(
        {
          filters: [{ kinds: [KIND_TEXT_NOTE], authors: batch, since }],
          origin: 'outbox',
          // Explicit author hint = this batch of contacts, so the shell resolves
          // their write relays for outbox routing (NAP-OUTBOX).
          authors: batch,
        },
        {
          onEvent: (event) => {
            // Why an incoming note does or doesn't reach the inbox — this is the
            // key filter to watch when notes stream in but none render.
            if (event.kind !== KIND_TEXT_NOTE) return;
            if (!containsGM(event.content)) return;
            if (state.gmNotes.has(event.id)) return;
            state.gmNotes.set(event.id, event);
            notify();
          },
          onScanSettled: () => {
            // The initial one-shot scan for this batch settled; the outbox tail
            // stays live so GMs that land after the burst still stream in. The
            // inbox flips out of "scanning" once every batch's scan has settled.
            if (pendingBatchScans > 0) pendingBatchScans -= 1;
            if (pendingBatchScans === 0 && state.scanning) {
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
      {
        filters: [{ kinds: [KIND_TEXT_NOTE], authors: [pubkey], since }],
        origin: 'outbox',
        // Route the user's own notes via their write relays (NAP-OUTBOX).
        authors: [pubkey],
      },
      {
        onEvent: (event) => {
          if (event.kind !== KIND_TEXT_NOTE) return;
          // A GM reply = a GM that e-tags the note it answers.
          if (!containsGM(event.content) || !hasETag(event)) return;
          if (state.userReplies.has(event.id)) return;
          state.userReplies.set(event.id, event);
          notify();
        },
        onScanSettled: () => {
          /* stay live for replies published while the inbox is open */
        },
      },
    );
  }

  async function loadContacts(): Promise<void> {
    // The runtime owns the follow list: NAP-IDENTITY resolves the user's newest
    // kind-3 for us, so the napplet never fetches or de-dupes it over the relays.
    const token = contactsLoadToken;
    let contactPubkeys: string[];
    try {
      contactPubkeys = await identity.getFollows();
    } catch (err) {
      // Identity query failed → settle so the UI stops showing "loading
      // contacts…" and surfaces the failure instead of hanging.
      if (token !== contactsLoadToken) return;
      state.contactsLoaded = true;
      state.scanning = false;
      state.error = err instanceof Error ? err.message : 'failed to load contacts';
      notify();
      return;
    }
    // Stale resolve (reset/destroy or identity switch happened mid-flight).
    if (token !== contactsLoadToken) return;
    state.contactCount = contactPubkeys.length;
    state.contactsLoaded = true;
    notify();
    // restartGmNotesSubscription settles `scanning` to false for an empty
    // follow list, matching the old "no follow list found" behavior.
    restartGmNotesSubscription(contactPubkeys);
  }

  function reset(): void {
    closeAll();
    state.gmNotes = new Map();
    state.userReplies = new Map();
    state.contactCount = 0;
    state.contactsLoaded = false;
    state.scanning = false;
    state.error = null;
    pendingBatchScans = 0;
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
    void loadContacts();
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

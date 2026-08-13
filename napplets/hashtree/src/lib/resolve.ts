/**
 * Root resolution: a `TreeRef` in, a root manifest hash (and maybe a key) out.
 *
 * The immutable form needs nothing. The mutable form reads the author's latest
 * kind 30064 event over NAP-OUTBOX. Kind 30064 is what BUD-18 specifies but is
 * *not* registered in NIP-01 — the table jumps 30063 to 30078 — so treat it as
 * provisional. Kind 30078 is read too, for older publishers.
 */

import { outbox } from '@napplet/sdk';
import type { NostrEvent } from '@napplet/sdk';
import { isHash32Hex } from './bytes.js';
import { HASHTREE_KIND, LEGACY_HASHTREE_KIND, type MutableRef, type TreeRef } from './refs.js';

/**
 * How the root key is published, per BUD-18's three visibility scopes.
 *
 * `public` covers both "no key at all" and a `key` tag in the clear. v1 resolves
 * only those: `link-private` needs the `encryptedKey` XOR `link_key` scheme and
 * `owner-private` needs NIP-44 decryption to self, and BUD-18 never names the
 * NIP-44 counterparty.
 */
export type RootVisibility = 'public' | 'link-private' | 'owner-private';

export type ResolveErrorCode =
  | 'outbox-unavailable'
  | 'not-found'
  | 'invalid-event'
  | 'unsupported-visibility';

export class ResolveError extends Error {
  constructor(
    message: string,
    readonly code: ResolveErrorCode,
  ) {
    super(message);
    this.name = 'ResolveError';
  }
}

export interface RootEventSummary {
  readonly id: string;
  readonly kind: number;
  readonly pubkey: string;
  readonly createdAt: number;
}

export interface ResolvedRoot {
  readonly rootHash: string;
  readonly rootKey: string | null;
  readonly visibility: RootVisibility;
  readonly source: 'nhash' | 'event';
  readonly event: RootEventSummary | null;
  /** Non-fatal observations worth showing next to the tree. */
  readonly warnings: readonly string[];
}

const tagValue = (event: NostrEvent, name: string): string | undefined =>
  event.tags.find((tag) => tag[0] === name)?.[1];

/**
 * Read the root pointer out of a candidate event.
 *
 * Pure, so the tag handling is unit-testable without a shell. Returns a string
 * describing the problem instead of throwing, because callers evaluate several
 * candidates and want to skip bad ones rather than abort.
 */
export function readRootEvent(
  event: NostrEvent,
): { hash: string; key: string | null; visibility: RootVisibility; warnings: string[] } | string {
  const rawHash = tagValue(event, 'hash');
  if (rawHash === undefined) return 'event has no `hash` tag';
  const hash = rawHash.toLowerCase();
  if (!isHash32Hex(hash)) return '`hash` tag is not a 32 byte hex hash';

  const warnings: string[] = [];
  if (rawHash !== hash) warnings.push('The `hash` tag is not lowercase, as BUD-18 requires.');

  const rawKey = tagValue(event, 'key');
  if (rawKey !== undefined) {
    const key = rawKey.toLowerCase();
    if (!isHash32Hex(key)) return '`key` tag is not a 32 byte hex key';
    return { hash, key, visibility: 'public', warnings };
  }

  if (tagValue(event, 'encryptedKey') !== undefined) {
    return { hash, key: null, visibility: 'link-private', warnings };
  }
  if (tagValue(event, 'selfEncryptedKey') !== undefined) {
    return { hash, key: null, visibility: 'owner-private', warnings };
  }

  return { hash, key: null, visibility: 'public', warnings };
}

/**
 * Pick the winning replaceable event.
 *
 * Newest `created_at` wins. On a tie BUD-18 says to take the lexicographically
 * *greatest* event id, which contradicts NIP-01 (lowest id) and the reference
 * implementation; NIP-01 wins here, since disagreeing with every other client
 * about which root is current is worse than disagreeing with a draft. Kind 30064
 * is preferred over the legacy 30078 at equal timestamps.
 */
export function pickLatestRootEvent(events: readonly NostrEvent[]): NostrEvent | null {
  let best: NostrEvent | null = null;
  for (const event of events) {
    if (best === null) {
      best = event;
      continue;
    }
    if (event.created_at !== best.created_at) {
      if (event.created_at > best.created_at) best = event;
      continue;
    }
    if (event.kind !== best.kind) {
      if (event.kind === HASHTREE_KIND) best = event;
      continue;
    }
    if (event.id < best.id) best = event;
  }
  return best;
}

/** Keep only events that really are this tree's root, whatever the relay returned. */
export function filterCandidates(events: readonly NostrEvent[], ref: MutableRef): NostrEvent[] {
  return events.filter(
    (event) =>
      event.pubkey === ref.pubkey &&
      (event.kind === HASHTREE_KIND || event.kind === LEGACY_HASHTREE_KIND) &&
      tagValue(event, 'd') === ref.treeName,
  );
}

async function resolveMutable(ref: MutableRef): Promise<ResolvedRoot> {
  if (typeof outbox?.query !== 'function') {
    throw new ResolveError(
      'This shell does not provide NAP-OUTBOX, so npub and naddr references cannot be resolved. An nhash reference works without it.',
      'outbox-unavailable',
    );
  }

  const result = await outbox.query(
    [
      {
        kinds: [HASHTREE_KIND, LEGACY_HASHTREE_KIND],
        authors: [ref.pubkey],
        '#d': [ref.treeName],
      },
    ],
    {
      authors: [ref.pubkey],
      ...(ref.relays.length > 0 ? { relays: [...ref.relays] } : {}),
    },
  );

  const candidates = filterCandidates(
    result.events.map((item) => item.event),
    ref,
  );
  const winner = pickLatestRootEvent(candidates);

  if (winner === null) {
    throw new ResolveError(
      result.incomplete === true
        ? `No kind ${HASHTREE_KIND} event found for this tree, but the relay query came back incomplete — the root may exist on a relay that was not reached.`
        : `No kind ${HASHTREE_KIND} event named ${JSON.stringify(ref.treeName)} was found for this author.`,
      'not-found',
    );
  }

  const parsed = readRootEvent(winner);
  if (typeof parsed === 'string') {
    throw new ResolveError(`The root event is unusable: ${parsed}.`, 'invalid-event');
  }

  if (parsed.visibility !== 'public') {
    throw new ResolveError(
      parsed.visibility === 'link-private'
        ? 'This tree is link-private: its root key is published as `encryptedKey` and has to be combined with a link key. That scope is not implemented yet.'
        : 'This tree is owner-private: its root key is NIP-44 encrypted to the author and only they can open it.',
      'unsupported-visibility',
    );
  }

  const warnings = [...parsed.warnings];
  if (winner.kind === LEGACY_HASHTREE_KIND) {
    warnings.push(`Resolved from the legacy kind ${LEGACY_HASHTREE_KIND} event.`);
  }
  if (result.incomplete === true) {
    warnings.push('Some relays did not answer, so a newer root may exist.');
  }
  if (ref.linkKey !== null) {
    warnings.push('The reference carries a link key, but this root is public — the key was ignored.');
  }

  return {
    rootHash: parsed.hash,
    rootKey: parsed.key,
    visibility: 'public',
    source: 'event',
    event: {
      id: winner.id,
      kind: winner.kind,
      pubkey: winner.pubkey,
      createdAt: winner.created_at,
    },
    warnings,
  };
}

export async function resolveRoot(ref: TreeRef): Promise<ResolvedRoot> {
  if (ref.kind === 'immutable') {
    return {
      rootHash: ref.rootHash,
      rootKey: ref.rootKey,
      visibility: 'public',
      source: 'nhash',
      event: null,
      warnings: [],
    };
  }
  return resolveMutable(ref);
}

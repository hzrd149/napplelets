/**
 * Which Blossom servers to try, and in what order.
 *
 * This is the one genuinely under-specified part of the stack. BUD-10 gives
 * `blossom:` URIs an `xs=` server hint and an `as=` author hint that resolves
 * through a BUD-03 kind 10063 list, but BUD-18's `htree://` has neither, and it
 * never says to use the root author's server list. So a resolver has to assemble
 * its own candidate set, from three sources, in this order:
 *
 *   1. The signed-in user's own BUD-03 kind 10063 list. These are the servers
 *      they mirror to and already trust, so they are the most likely to hold —
 *      and to keep serving — anything they browse. Tried first.
 *   2. The configured servers, as a fallback for a user with no published list.
 *   3. For a mutable (`naddr`/npub) root, the root author's published list,
 *      because that is where *their* blobs most likely are.
 *
 * Every list is only ever a guess about location: a blob is content-addressed,
 * so a wrong guess costs a failed fetch, never a wrong result.
 */

import { identity, outbox } from '@napplet/sdk';
import type { NostrEvent } from '@napplet/sdk';
import { hasMethod } from './nap.js';

/** BUD-03 User Server List. */
export const SERVER_LIST_KIND = 10063;

export const DEFAULT_BLOSSOM_SERVERS: readonly string[] = [
  'https://blossom.primal.net',
  'https://cdn.iris.to',
];

/** `https://host` with no trailing slash, or null when unusable. */
export function normalizeServer(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
}

export function normalizeServers(raw: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    const normalized = normalizeServer(entry);
    if (normalized !== null && !seen.has(normalized)) {
      seen.add(normalized);
      out.push(normalized);
    }
  }
  return out;
}

/** Pure: pull `server` tags out of a kind 10063 event, in published order. */
export function readServerList(event: NostrEvent): string[] {
  return normalizeServers(
    event.tags.filter((tag) => tag[0] === 'server').map((tag) => tag[1] ?? ''),
  );
}

const HEX_PUBKEY = /^[0-9a-f]{64}$/;

/** The BUD-03 servers published by one pubkey, newest list wins. */
export async function fetchServerList(
  pubkey: string,
  relays: readonly string[],
): Promise<string[]> {
  if (typeof outbox?.query !== 'function') return [];
  try {
    const result = await outbox.query([{ kinds: [SERVER_LIST_KIND], authors: [pubkey] }], {
      authors: [pubkey],
      ...(relays.length > 0 ? { relays: [...relays] } : {}),
    });
    const events = result.events
      .map((item) => item.event)
      .filter((event) => event.pubkey === pubkey && event.kind === SERVER_LIST_KIND)
      .sort((a, b) => b.created_at - a.created_at);
    return events.length === 0 ? [] : readServerList(events[0]!);
  } catch {
    // A missing server list is not an error; the configured servers still apply.
    return [];
  }
}

/** The tree author's BUD-03 servers, for a mutable root. */
export async function fetchAuthorServers(
  pubkey: string,
  relays: readonly string[],
): Promise<string[]> {
  return fetchServerList(pubkey, relays);
}

/**
 * The signed-in user's own BUD-03 servers.
 *
 * NAP-IDENTITY only ever hands out the public key — no signer access is needed
 * or asked for here, and the kind 10063 list is public anyway. Resolves to an
 * empty list when no user is connected, when the shell withholds NAP-IDENTITY,
 * or when the user has published no list; all three are ordinary states, not
 * errors, so the configured servers just carry the fetch on their own.
 */
export async function fetchUserServers(): Promise<string[]> {
  if (!hasMethod('identity', 'getPublicKey')) return [];
  try {
    // "" when no user or signer is connected.
    const pubkey = (await identity.getPublicKey()).toLowerCase();
    if (!HEX_PUBKEY.test(pubkey)) return [];
    // No relay hint: the outbox model already routes an author query to that
    // author's own write relays, which is exactly where their 10063 lives.
    return await fetchServerList(pubkey, []);
  } catch {
    return [];
  }
}

/**
 * Keep the user's server list current, including across a shell-side account
 * switch. Delivers an immediate first result, then one per identity change.
 *
 * Returns an unsubscribe function. Late results from a superseded identity are
 * dropped rather than overwriting a newer list.
 */
export function subscribeUserServers(onServers: (servers: string[]) => void): () => void {
  let token = 0;
  let closed = false;

  const refresh = (): void => {
    const current = ++token;
    void fetchUserServers().then((servers) => {
      if (!closed && current === token) onServers(servers);
    });
  };

  refresh();

  if (!hasMethod('identity', 'onChanged')) {
    return () => {
      closed = true;
    };
  }

  try {
    const subscription = identity.onChanged(() => refresh());
    return () => {
      closed = true;
      try {
        subscription.close();
      } catch {
        // Ignore: the shell may already have torn the subscription down.
      }
    };
  } catch {
    return () => {
      closed = true;
    };
  }
}

/**
 * Build the ordered candidate list for a blob fetch, best guess first.
 *
 * The URL of a blob is public — only the decryption key is secret — so trying
 * several servers leaks nothing beyond which hash is wanted, which the server
 * would learn anyway.
 */
export function mergeServers(...groups: readonly (readonly string[])[]): string[] {
  return normalizeServers(groups.flatMap((group) => [...group]));
}

/**
 * Tracks which servers have actually worked so later fetches start with them.
 *
 * Deliberately simple: a server that served a verified blob moves to the front,
 * one that failed moves to the back. No latency modelling — the win here is
 * skipping a dead host on the second fetch, not micro-optimising the first.
 */
export class ServerRanking {
  private readonly scores = new Map<string, number>();

  order(servers: readonly string[]): string[] {
    return [...servers].sort((a, b) => (this.scores.get(b) ?? 0) - (this.scores.get(a) ?? 0));
  }

  succeeded(server: string): void {
    this.scores.set(server, Math.min(8, (this.scores.get(server) ?? 0) + 1));
  }

  failed(server: string): void {
    this.scores.set(server, Math.max(-8, (this.scores.get(server) ?? 0) - 1));
  }
}

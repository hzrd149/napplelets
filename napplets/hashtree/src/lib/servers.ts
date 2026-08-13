/**
 * Which Blossom servers to try, and in what order.
 *
 * This is the one genuinely under-specified part of the stack. BUD-10 gives
 * `blossom:` URIs an `xs=` server hint and an `as=` author hint that resolves
 * through a BUD-03 kind 10063 list, but BUD-18's `htree://` has neither, and it
 * never says to use the root author's server list. So the configured servers are
 * the baseline, and for a mutable root we additionally *offer* the author's
 * published list, because that is where their blobs most likely are.
 */

import { outbox } from '@napplet/sdk';
import type { NostrEvent } from '@napplet/sdk';

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

export async function fetchAuthorServers(pubkey: string, relays: readonly string[]): Promise<string[]> {
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

/**
 * Build the ordered candidate list for a blob fetch.
 *
 * The URL of a blob is public — only the decryption key is secret — so trying
 * several servers leaks nothing beyond which hash is wanted, which the server
 * would learn anyway.
 */
export function mergeServers(
  configured: readonly string[],
  authorServers: readonly string[],
): string[] {
  return normalizeServers([...configured, ...authorServers]);
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

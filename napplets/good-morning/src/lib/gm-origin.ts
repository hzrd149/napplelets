// napplets/good-morning/src/lib/gm-origin.ts
// The single origin-routing seam for the GM inbox, adapted from the feed
// napplet's feed-origin.ts (Phase 88, FEED-02). Kept deliberately close to that
// implementation so relay-routing behaviour stays consistent across napplets.
//
// subscribeForPayload turns a set of filters into ONE subscription and returns a
// uniform { close } handle:
//
//   origin:'outbox'  → NAP-OUTBOX discovery: outbox.subscribe(filters,
//                      { strategy:'outbox', live:true }) when supports('outbox'),
//                      else NAP-RELAYS fallback via relay.subscribe.
//   origin:'relay'   → NAP-RELAYS exact relay fan-out, one relay.subscribe per
//                      relay url, deduped by event id.
//
// The supports('outbox') gate MUST be read AFTER await shell.ready() — it is
// false until the shell handshake settles (profile-metadata.ts pattern).

import { outbox, relay, type Subscription } from '@napplet/sdk';
import type { NostrEvent, NostrFilter } from '@hyprgate/types';

/** The minimal payload the GM inbox routes (a subset of FeedIntentPayload). */
export interface OriginSubscribePayload {
  filters: NostrFilter[];
  origin: 'outbox' | 'relay';
  relays?: string[];
}

/** Minimal shape of the shim-installed shell handshake we depend on. */
interface NappletShellHandle {
  ready(): Promise<unknown>;
  supports(domain: string, protocol?: string): boolean;
}

function getShell(): NappletShellHandle | null {
  return (
    (globalThis as unknown as { napplet?: { shell?: NappletShellHandle } }).napplet?.shell ?? null
  );
}

export interface PayloadSubscriptionCallbacks {
  onEvent(event: NostrEvent): void;
  onEose(): void;
}

interface OutboxSubscribeOptions {
  strategy: 'outbox';
  live: boolean;
}

/**
 * Apply caller-supplied per-leg props onto every filter, returning PLAIN,
 * structured-cloneable filter objects.
 *
 * The deep clone is load-bearing, not cosmetic: filters built from Svelte
 * `$state` are reactive Proxies, and the SDK posts them across the iframe via
 * `postMessage`, which throws `DataCloneError` on a Proxy and silently drops the
 * subscription (the FEED-02 root cause). A JSON round-trip strips the Proxy.
 */
function withExtraProps(
  filters: NostrFilter[],
  extra: Record<string, unknown> | undefined,
): NostrFilter[] {
  const merged =
    extra && Object.keys(extra).length > 0
      ? filters.map((filter) => ({ ...filter, ...extra }))
      : filters;
  return JSON.parse(JSON.stringify(merged)) as NostrFilter[];
}

/**
 * Build a uniform { close } subscription from a payload. The subscription opens
 * after the shell.ready() gate resolves; an early close() is honored.
 */
export function subscribeForPayload(
  payload: OriginSubscribePayload,
  callbacks: PayloadSubscriptionCallbacks,
  extraFilterProps?: Record<string, unknown>,
): Subscription {
  const filters = withExtraProps(payload.filters, extraFilterProps);

  let subscription: Subscription | null = null;
  let closed = false;
  let closeWhenReady = false;

  function close(): void {
    if (closed) return;
    closed = true;
    if (subscription) {
      subscription.close();
    } else {
      closeWhenReady = true;
    }
  }

  function openOutbox(options: OutboxSubscribeOptions): Subscription {
    const sub = outbox.subscribe(
      filters,
      options as unknown as Parameters<typeof outbox.subscribe>[1],
    );
    sub.on('event', (event) => callbacks.onEvent(event as NostrEvent));
    sub.on('eose', () => callbacks.onEose());
    return { close: () => sub.close() };
  }

  function openRelayFallback(): Subscription {
    return relay.subscribe(
      filters,
      (event) => callbacks.onEvent(event as NostrEvent),
      () => callbacks.onEose(),
    );
  }

  function openPinnedRelays(relays: string[]): Subscription {
    const relayUrls = [...relays];
    const subs: Subscription[] = [];
    const seenIds = new Set<string>();
    let remainingEose = relayUrls.length;
    let eoseSent = false;

    function maybeEose(): void {
      if (eoseSent || remainingEose > 0) return;
      eoseSent = true;
      callbacks.onEose();
    }

    for (const relayUrl of relayUrls) {
      subs.push(
        relay.subscribe(
          filters,
          (event) => {
            if (seenIds.has(event.id)) return;
            seenIds.add(event.id);
            callbacks.onEvent(event as NostrEvent);
          },
          () => {
            remainingEose -= 1;
            maybeEose();
          },
          { relay: relayUrl },
        ),
      );
    }

    return {
      close: () => {
        for (const sub of subs) sub.close();
      },
    };
  }

  void (async () => {
    const shell = getShell();
    await shell?.ready();
    if (closed) return;
    const useOutbox = shell?.supports('outbox') ?? false;

    if (payload.origin === 'relay') {
      subscription = openPinnedRelays(payload.relays ?? []);
    } else if (useOutbox) {
      subscription = openOutbox({ strategy: 'outbox', live: true });
    } else {
      subscription = openRelayFallback();
    }

    if (closeWhenReady) subscription.close();
  })();

  return { close };
}

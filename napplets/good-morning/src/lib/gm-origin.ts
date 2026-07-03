// napplets/good-morning/src/lib/gm-origin.ts
// The single origin-routing seam for the GM inbox.
//
// subscribeForPayload turns a set of filters into ONE subscription and returns a
// uniform { close } handle:
//
//   origin:'outbox'  → NAP-OUTBOX discovery: outbox.subscribe(filters,
//                      { strategy:'outbox', live:true }).
//
// The supports('outbox') gate MUST be read AFTER await shell.ready() — it is
// false until the shell handshake settles (profile-metadata.ts pattern).

import { outbox, type Subscription } from '@napplet/sdk';
import type { NostrEvent, NostrFilter } from '@hyprgate/types';

/** The minimal payload the GM inbox routes (a subset of FeedIntentPayload). */
export interface OriginSubscribePayload {
  filters: NostrFilter[];
  origin: 'outbox';
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
    sub.on('event', (result) => callbacks.onEvent(result.event as NostrEvent));
    sub.on('closed', () => {
      if (!options.live) callbacks.onEose();
    });
    return { close: () => sub.close() };
  }

  void (async () => {
    const shell = getShell();
    await shell?.ready();
    if (closed) return;
    subscription = openOutbox({ strategy: 'outbox', live: true });

    if (closeWhenReady) subscription.close();
  })();

  return { close };
}

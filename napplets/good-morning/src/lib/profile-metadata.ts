import { outbox, type Subscription } from '@napplet/sdk';
import type { NostrEvent } from '@hyprgate/types';

/**
 * Shared kind-0 profile-metadata subscription. Kept byte-identical with the
 * feed/live-chat copies (anti-drift) — change all of them together.
 */
interface NappletShellHandle {
  ready(): Promise<unknown>;
  supports(domain: string, protocol?: string): boolean;
}

function getShell(): NappletShellHandle | null {
  return (
    (globalThis as unknown as { napplet?: { shell?: NappletShellHandle } }).napplet?.shell ?? null
  );
}

export interface ProfileContent {
  name?: string;
  display_name?: string;
  displayName?: string;
  nip05?: string;
  picture?: string;
}

export type ProfileMetadataCallback = (pubkey: string, profile: ProfileContent) => void;

const NOOP_SUBSCRIPTION: Subscription = {
  close: () => {
    /* no-op */
  },
};

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function parseProfileEvent(event: NostrEvent): ProfileContent | null {
  if (event.kind !== 0) return null;

  try {
    const metadata = JSON.parse(event.content) as Record<string, unknown>;
    return {
      name: optionalString(metadata.name),
      display_name: optionalString(metadata.display_name),
      displayName: optionalString(metadata.displayName),
      nip05: optionalString(metadata.nip05),
      picture: optionalString(metadata.picture),
    };
  } catch {
    return null;
  }
}

export function subscribeProfileMetadata(
  pubkeys: string[],
  onProfile: ProfileMetadataCallback,
  onDone: () => void = () => {
    /* no-op */
  },
): Subscription {
  const authors = [...new Set(pubkeys.filter((pubkey) => pubkey.length > 0))];
  if (authors.length === 0) {
    onDone();
    return NOOP_SUBSCRIPTION;
  }

  const latestByPubkey = new Map<string, number>();
  let subscription: Subscription | null = null;
  let closed = false;

  // Set up the close guard synchronously so an early close() (before the
  // shell.ready() gate resolves) is honored once the subscription opens. The
  // async block re-checks `closed` right after opening, so a close() that lands
  // first still tears the subscription down.
  function close(): void {
    if (closed) return;
    closed = true;
    subscription?.close();
    subscription = null;
  }

  function handleEvent(event: NostrEvent): void {
    if (closed || event.kind !== 0 || !authors.includes(event.pubkey)) return;
    const latestCreatedAt = latestByPubkey.get(event.pubkey);
    if (latestCreatedAt !== undefined && latestCreatedAt > event.created_at) return;

    const profile = parseProfileEvent(event);
    if (!profile) return;

    latestByPubkey.set(event.pubkey, event.created_at);
    onProfile(event.pubkey, profile);
  }

  let doneFired = false;
  function handleDone(): void {
    if (doneFired) return;
    doneFired = true;
    onDone();
  }

  const filters = authors.map((author) => ({ kinds: [0], authors: [author], limit: 1 }));
  // Open AFTER shell.ready() so the handshake is settled and shell.supports('outbox')
  // reflects the runtime's registered NAP services. NAP-OUTBOX has no `eose`
  // (napplet/naps#32): a one-shot query is the initial read (its resolution fires
  // `onDone`) and a live subscription tails any profile updates while the inbox
  // stays open.
  void (async () => {
    const shell = getShell();
    await shell?.ready();
    if (closed) return;
    // Explicit author hint so the shell routes each kind-0 lookup to that author's
    // write relays (NAP-OUTBOX) instead of re-deriving from filters.
    const options = { authors };
    const sub = outbox.subscribe(filters, options);
    // NAP-OUTBOX delivers a RelayEventResult (`{ event, sidecar? }`); the raw
    // event is at `result.event`, not the callback arg itself.
    sub.on('event', (result) => handleEvent(result.event));
    subscription = { close: () => sub.close() };
    if (closed) {
      sub.close();
      return;
    }
    try {
      const { events } = await outbox.query(filters, options);
      if (closed) return;
      for (const result of events) handleEvent(result.event);
    } catch {
      /* best-effort: the live subscription may still deliver profiles */
    } finally {
      if (!closed) handleDone();
    }
  })();

  return { close };
}

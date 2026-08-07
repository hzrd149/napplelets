import type { NostrEvent } from './nostr';
import { createNoteViewerOpenPayload, type NoteViewerOpenPayload } from './note-viewer-protocol';
import { outbox } from '@napplet/sdk';
import { NoteFactory } from 'applesauce-common/factories/note';
import * as nip19 from 'nostr-tools/nip19';

/** Source tag emitted on note-viewer intents so the shell can attribute them. */
export const GM_NAPPLET_SOURCE = 'good-morning' as const;

/** Client tag on GMs this napplet publishes (attribution / parity w/ gm-protocol). */
export const GM_CLIENT_TAG = ['client', '@napplelets/good-morning'] as const;

/** The fixed content of a one-tap "Quick GM" reply. */
export const QUICK_GM_CONTENT = 'GM' as const;

/**
 * Build the note-viewer open payload for a GM inbox row. The shell intercepts
 * the `note` archetype, creates/focuses the selected note-viewer window, and the
 * user replies to the GM inline there — this napplet only supplies the payload.
 */
export function createGMNoteOpenPayload(
  event: Pick<NostrEvent, 'id' | 'kind' | 'pubkey'>,
): NoteViewerOpenPayload | null {
  return createNoteViewerOpenPayload({
    target: { type: 'event', id: event.id, kind: event.kind, pubkey: event.pubkey },
    behavior: { focus: true },
    source: { napplet: GM_NAPPLET_SOURCE },
  });
}

/**
 * Decode an embedded nostr reference (note/nevent/naddr) into a note-viewer open
 * payload so references inside a GM open in the viewer. Mirrors the feed's
 * createFeedReferenceOpenPayload.
 */
export function createGMReferenceOpenPayload(source: string): NoteViewerOpenPayload | null {
  const encoded = source.trim().replace(/^nostr:/i, '');
  if (!encoded) return null;

  try {
    const decoded = nip19.decode(encoded);
    if (decoded.type === 'note') {
      return createNoteViewerOpenPayload({
        target: { type: 'event', id: decoded.data, nip19: encoded },
        behavior: { focus: true },
        source: { napplet: GM_NAPPLET_SOURCE },
      });
    }
    if (decoded.type === 'nevent') {
      const data = decoded.data;
      return createNoteViewerOpenPayload({
        target: {
          type: 'event',
          id: data.id,
          ...(typeof data.kind === 'number' ? { kind: data.kind } : {}),
          ...(typeof data.author === 'string' ? { pubkey: data.author } : {}),
          nip19: encoded,
        },
        ...(Array.isArray(data.relays) ? { relays: data.relays } : {}),
        behavior: { focus: true },
        source: { napplet: GM_NAPPLET_SOURCE },
      });
    }
    if (decoded.type === 'naddr') {
      const data = decoded.data;
      return createNoteViewerOpenPayload({
        target: {
          type: 'address',
          kind: data.kind,
          pubkey: data.pubkey,
          identifier: data.identifier,
          nip19: encoded,
        },
        ...(Array.isArray(data.relays) ? { relays: data.relays } : {}),
        behavior: { focus: true },
        source: { napplet: GM_NAPPLET_SOURCE },
      });
    }
  } catch {
    return null;
  }

  return null;
}

/**
 * Build the NIP-10 reply tags + content for a one-tap "Quick GM". Applesauce
 * preserves the parent note's thread root and marks this event's direct parent
 * as the reply target. The resulting `e` tags also make the inbox's isRead check
 * flip the row to replied.
 */
export async function createQuickGMReplyTemplate(event: NostrEvent): Promise<{
  kind: 1;
  content: string;
  tags: string[][];
  created_at: number;
}> {
  const template = await NoteFactory.reply(event, QUICK_GM_CONTENT);
  return { ...template, tags: [...template.tags, [...GM_CLIENT_TAG]] };
}

/** Sign + publish a Quick GM reply through the shell (NAP-OUTBOX). */
export async function publishQuickGM(event: NostrEvent): Promise<object> {
  const template = await createQuickGMReplyTemplate(event);
  return outbox.publish(template);
}

/**
 * Build the composer open payload for a "GM Reply" — the user writes their own
 * reply in the composer napplet. NAP-INTENT opens the selected composer handler
 * pre-seeded with this reply context.
 */
export function createGMReplyComposePayload(
  event: Pick<NostrEvent, 'id' | 'pubkey' | 'kind'> &
    Partial<Pick<NostrEvent, 'content' | 'created_at'>>,
): {
  source: { napplet: typeof GM_NAPPLET_SOURCE };
  intent: 'reply';
  replyTo: { id: string; pubkey: string; kind: number; content?: string; created_at?: number };
} {
  return {
    source: { napplet: GM_NAPPLET_SOURCE },
    intent: 'reply',
    replyTo: {
      id: event.id,
      pubkey: event.pubkey,
      kind: event.kind,
      ...(typeof event.content === 'string' ? { content: event.content } : {}),
      ...(typeof event.created_at === 'number' ? { created_at: event.created_at } : {}),
    },
  };
}

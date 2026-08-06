import * as nip19 from 'nostr-tools/nip19';

export type NoteViewerOpenTarget =
  | { type: 'event'; id: string; kind?: number; pubkey?: string; nip19?: string }
  | { type: 'address'; kind: number; pubkey: string; identifier: string; nip19?: string };

export interface NoteViewerOpenPayload {
  target: NoteViewerOpenTarget;
  relays?: string[];
  source?: { napplet?: string; windowId?: string; requestId?: string };
  behavior?: { focus?: boolean; newWindow?: boolean };
}

const LOWER_HEX_64 = /^[0-9a-f]{64}$/;

export function createNoteViewerOpenPayload(
  input: NoteViewerOpenPayload,
): NoteViewerOpenPayload | null {
  if (!isValidOpenTarget(input.target)) return null;
  const relays = input.relays?.filter(
    (relay, index, all) => relay.length > 0 && all.indexOf(relay) === index,
  );
  const target =
    relays && relays.length > 0 ? withRelayHintedNip19(input.target, relays) : input.target;
  return {
    target,
    ...(relays && relays.length > 0 ? { relays } : {}),
    ...(input.source ? { source: input.source } : {}),
    ...(input.behavior ? { behavior: input.behavior } : {}),
  };
}

function isValidOpenTarget(value: NoteViewerOpenTarget): boolean {
  if (value.type === 'event') {
    return (
      LOWER_HEX_64.test(value.id) &&
      (value.kind === undefined || Number.isInteger(value.kind)) &&
      (value.pubkey === undefined || LOWER_HEX_64.test(value.pubkey))
    );
  }
  return (
    Number.isInteger(value.kind) &&
    LOWER_HEX_64.test(value.pubkey) &&
    typeof value.identifier === 'string'
  );
}

function withRelayHintedNip19(
  target: NoteViewerOpenTarget,
  relays: string[],
): NoteViewerOpenTarget {
  try {
    if (target.type === 'event') {
      return {
        ...target,
        nip19: nip19.neventEncode({
          id: target.id,
          relays,
          ...(target.pubkey ? { author: target.pubkey } : {}),
          ...(target.kind !== undefined ? { kind: target.kind } : {}),
        }),
      };
    }
    return {
      ...target,
      nip19: nip19.naddrEncode({
        kind: target.kind,
        pubkey: target.pubkey,
        identifier: target.identifier,
        relays,
      }),
    };
  } catch {
    return target;
  }
}

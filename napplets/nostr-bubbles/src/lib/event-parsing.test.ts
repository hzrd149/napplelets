import { describe, expect, it } from 'vitest';
import {
  getOnchainZapAmountSats,
  getReactionEmoji,
  getReactionTargetEventId,
  getZapAmountSats,
  getZapSenderPubkey,
  isSelfOnchainZap,
  parseThreadReference,
} from './event-parsing';
import type { NostrEvent } from './nostr';

const hexA = 'a'.repeat(64);
const hexB = 'b'.repeat(64);
const hexC = 'c'.repeat(64);

function event(overrides: Partial<NostrEvent>): NostrEvent {
  return {
    id: hexA,
    pubkey: hexB,
    created_at: 1,
    kind: 1,
    tags: [],
    content: '',
    sig: '0'.repeat(128),
    ...overrides,
  };
}

describe('event parsing', () => {
  it('parses NIP-10 root and reply tags', () => {
    const root = '1'.repeat(64);
    const reply = '2'.repeat(64);
    const parsed = parseThreadReference(
      event({
        tags: [
          ['e', root, 'wss://relay.example', 'root', hexC],
          ['e', reply, '', 'reply', hexB],
        ],
      }),
    );

    expect(parsed?.root.eventId).toBe(root);
    expect(parsed?.root.relayHint).toBe('wss://relay.example');
    expect(parsed?.root.authorHint).toBe(hexC);
    expect(parsed?.reply?.eventId).toBe(reply);
  });

  it('selects reaction target by marker precedence', () => {
    const root = '1'.repeat(64);
    const reply = '2'.repeat(64);
    expect(getReactionTargetEventId(event({ kind: 7, tags: [['e', reply, '', 'reply'], ['e', root, '', 'root']] }))).toBe(root);
  });

  it('normalizes reaction emoji content', () => {
    expect(getReactionEmoji('+')).toBe('❤️');
    expect(getReactionEmoji('-')).toBe('👎');
    expect(getReactionEmoji('🔥')).toBe('🔥');
  });

  it('extracts zap sender and sats from tags', () => {
    const zap = event({
      kind: 9735,
      tags: [
        ['P', hexC],
        ['amount', '21000'],
      ],
    });
    expect(getZapSenderPubkey(zap)).toBe(hexC);
    expect(getZapAmountSats(zap)).toBe(21);
  });

  it('parses on-chain zap amount and self-zap state', () => {
    const zap = event({ kind: 8333, pubkey: hexB, tags: [['amount', '42'], ['p', hexB]] });
    expect(getOnchainZapAmountSats(zap)).toBe(42);
    expect(isSelfOnchainZap(zap)).toBe(true);
  });
});

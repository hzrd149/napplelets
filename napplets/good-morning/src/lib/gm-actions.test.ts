import { describe, it, expect } from 'vitest';
import {
  createQuickGMReplyTemplate,
  createGMReplyComposePayload,
  QUICK_GM_CONTENT,
} from './gm-actions';

const ROOT = {
  id: 'b'.repeat(64),
  pubkey: 'a'.repeat(64),
  kind: 1,
  content: 'GM frens',
  created_at: 1700,
  tags: [],
  sig: 'c'.repeat(128),
};

describe('createQuickGMReplyTemplate', () => {
  it('builds a kind-1 "GM" reply that e-tags the root (NIP-10 reply marker)', async () => {
    const template = await createQuickGMReplyTemplate(ROOT);
    expect(template.kind).toBe(1);
    expect(template.content).toBe(QUICK_GM_CONTENT);
    expect(template.tags).toContainEqual(['e', ROOT.id, '', 'root', ROOT.pubkey]);
    expect(template.tags).toContainEqual(['e', ROOT.id, '', 'reply', ROOT.pubkey]);
    expect(template.tags).toContainEqual(['p', ROOT.pubkey]);
    expect(template.tags).toContainEqual(['client', '@napplelets/good-morning']);
    expect(typeof template.created_at).toBe('number');
  });

  it('preserves the root and marks the direct parent when replying inside a thread', async () => {
    const parent = {
      id: 'd'.repeat(64),
      pubkey: ROOT.pubkey,
      kind: 1,
      content: 'replying GM',
      created_at: 1800,
      tags: [['e', ROOT.id, '', 'root']],
      sig: 'e'.repeat(128),
    };
    const template = await createQuickGMReplyTemplate(parent);

    expect(template.tags).toContainEqual(['e', ROOT.id, '', 'root']);
    expect(template.tags).toContainEqual(['e', parent.id, '', 'reply', parent.pubkey]);
  });
});

describe('createGMReplyComposePayload', () => {
  it('produces a reply-intent payload the composer accepts', () => {
    const payload = createGMReplyComposePayload(ROOT);
    expect(payload.intent).toBe('reply');
    expect(payload.replyTo).toMatchObject({
      id: ROOT.id,
      pubkey: ROOT.pubkey,
      kind: ROOT.kind,
      content: ROOT.content,
      created_at: ROOT.created_at,
    });
    expect(payload.source.napplet).toBe('good-morning');
  });

  it('omits content/created_at when absent', () => {
    const payload = createGMReplyComposePayload({ id: ROOT.id, pubkey: ROOT.pubkey, kind: 1 });
    expect('content' in payload.replyTo).toBe(false);
    expect('created_at' in payload.replyTo).toBe(false);
  });
});

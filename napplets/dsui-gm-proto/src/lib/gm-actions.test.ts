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
};

describe('createQuickGMReplyTemplate', () => {
  it('builds a kind-1 "GM" reply that e-tags the root (NIP-10 reply marker)', () => {
    const template = createQuickGMReplyTemplate(ROOT);
    expect(template.kind).toBe(1);
    expect(template.content).toBe(QUICK_GM_CONTENT);
    expect(template.tags).toContainEqual(['e', ROOT.id, '', 'reply']);
    expect(template.tags).toContainEqual(['p', ROOT.pubkey]);
    expect(typeof template.created_at).toBe('number');
  });

  it('e-tags the root id so the inbox isRead check flips to replied', () => {
    const template = createQuickGMReplyTemplate(ROOT);
    const eTag = template.tags.find((tag) => tag[0] === 'e');
    expect(eTag?.[1]).toBe(ROOT.id);
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
    expect(payload.source.napplet).toBe('dsui-gm-proto');
  });

  it('omits content/created_at when absent', () => {
    const payload = createGMReplyComposePayload({ id: ROOT.id, pubkey: ROOT.pubkey, kind: 1 });
    expect('content' in payload.replyTo).toBe(false);
    expect('created_at' in payload.replyTo).toBe(false);
  });
});

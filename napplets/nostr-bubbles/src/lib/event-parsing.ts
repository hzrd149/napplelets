import type { NostrEvent } from './nostr';

export const KIND_TEXT_NOTE = 1;
export const KIND_METADATA = 0;
export const KIND_REACTION = 7;
export const KIND_ZAP_RECEIPT = 9735;
export const KIND_ONCHAIN_ZAP = 8333;

const HEX_64_RE = /^[0-9a-f]{64}$/i;

export interface ProfileResult {
  displayName?: string;
  picture?: string;
  shape?: string;
}

export interface EventReference {
  eventId: string;
  relayHint?: string;
  authorHint?: string;
}

export interface ThreadReference {
  root: EventReference;
  reply?: EventReference;
}

function isHex64(value: unknown): value is string {
  return typeof value === 'string' && HEX_64_RE.test(value);
}

function normalizeRelayHint(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value.includes('://') ? value : `wss://${value}`);
    if (url.protocol !== 'wss:' && url.protocol !== 'ws:') return undefined;
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return undefined;
  }
}

function referenceFromETag(tag: string[]): EventReference | undefined {
  const eventId = tag[1];
  if (!isHex64(eventId)) return undefined;
  const authorHint = tag[4];
  return {
    eventId: eventId.toLowerCase(),
    relayHint: normalizeRelayHint(tag[2]),
    authorHint: isHex64(authorHint) ? authorHint.toLowerCase() : undefined,
  };
}

export function parseThreadReference(event: NostrEvent): ThreadReference | undefined {
  const eTags = event.tags.filter((tag) => tag[0] === 'e' && isHex64(tag[1]));
  const rootTag = eTags.find((tag) => tag[3] === 'root') ?? eTags[0];
  const replyTag = eTags.find((tag) => tag[3] === 'reply') ?? eTags.at(-1);
  const rootFromTag = rootTag ? referenceFromETag(rootTag) : undefined;
  const replyFromTag = replyTag ? referenceFromETag(replyTag) : undefined;
  if (eTags.length === 0) return undefined;
  return rootFromTag ? { root: rootFromTag, reply: replyFromTag?.eventId === event.id ? undefined : replyFromTag } : undefined;
}

export function parseProfile(event: NostrEvent | undefined): ProfileResult {
  if (!event) return {};
  try {
    const content = JSON.parse(event.content) as Record<string, unknown>;
    const picture = typeof content.picture === 'string' ? content.picture : typeof content.image === 'string' ? content.image : undefined;
    const displayName = typeof content.display_name === 'string' ? content.display_name : typeof content.name === 'string' ? content.name : undefined;
    return {
      displayName: typeof displayName === 'string' && displayName.trim() ? displayName.trim() : undefined,
      picture: typeof picture === 'string' && picture.trim() ? picture.trim() : undefined,
      shape: isEmojiShape(content?.shape) ? content.shape : undefined,
    };
  } catch {
    return {};
  }
}

export function sanitizeHttpsUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

export function getReactionTargetEventId(event: NostrEvent): string | undefined {
  const eTags = event.tags.filter((tag) => tag[0] === 'e' && isHex64(tag[1]));
  const target =
    eTags.find((tag) => tag[3] === 'root') ??
    eTags.find((tag) => tag[3] === 'reply') ??
    eTags.find((tag) => tag[3] === 'mention') ??
    eTags.at(-1);
  return target?.[1]?.toLowerCase();
}

export function getReactionEmoji(content: string): string {
  const trimmed = content.trim();
  if (!trimmed || trimmed === '+') return '❤️';
  if (trimmed === '-') return '👎';
  return Array.from(trimmed).slice(0, 4).join('') || '❤️';
}

export function getZapSenderPubkey(event: NostrEvent): string | undefined {
  const directSender = getTagValue(event, 'P');
  if (isHex64(directSender)) return directSender.toLowerCase();

  const description = getTagValue(event, 'description');
  if (typeof description !== 'string') return undefined;
  try {
    const zapRequest = JSON.parse(description) as Record<string, unknown>;
    return isHex64(zapRequest.pubkey) ? zapRequest.pubkey.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

export function getZapAmountSats(event: NostrEvent): number | undefined {
  const candidates = [getTagValue(event, 'amount')];
  const description = getTagValue(event, 'description');
  if (typeof description === 'string') {
    try {
      const zapRequest = JSON.parse(description) as Record<string, unknown>;
      const tags = zapRequest.tags;
      if (Array.isArray(tags)) {
        const amountTag = tags.find(
          (tag): tag is string[] => Array.isArray(tag) && tag[0] === 'amount' && typeof tag[1] === 'string',
        );
        candidates.push(amountTag?.[1]);
      }
    } catch {
      // Ignore malformed zap requests.
    }
  }

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const millisats = Number.parseInt(candidate, 10);
    if (Number.isFinite(millisats) && millisats > 0) return Math.max(1, Math.round(millisats / 1000));
  }
  return parseBolt11AmountSats(getTagValue(event, 'bolt11'));
}

export function getOnchainZapAmountSats(event: NostrEvent): number | undefined {
  const amount = getTagValue(event, 'amount');
  if (typeof amount !== 'string') return undefined;
  const sats = Number.parseInt(amount, 10);
  return Number.isFinite(sats) && sats > 0 ? sats : undefined;
}

export function isSelfOnchainZap(event: NostrEvent): boolean {
  return event.tags.some(([name, value]) => name === 'p' && value === event.pubkey);
}

export function getMessagePreview(content: string): string {
  const preview = content.replace(/\s+/g, ' ').trim();
  return preview || 'Empty note';
}

function parseBolt11AmountSats(invoice: unknown): number | undefined {
  if (typeof invoice !== 'string') return undefined;
  const match = invoice.toLowerCase().match(/^ln(?:bc|tb|bcrt)(\d+)([munp]?)/);
  if (!match) return undefined;
  const quantity = Number.parseInt(match[1]!, 10);
  if (!Number.isFinite(quantity) || quantity <= 0) return undefined;
  const multiplier = match[2];
  const sats =
    multiplier === 'm'
      ? quantity * 100_000
      : multiplier === 'u'
        ? quantity * 100
        : multiplier === 'n'
          ? quantity / 10
          : multiplier === 'p'
            ? quantity / 10_000
            : quantity * 100_000_000;
  return Math.max(1, Math.round(sats));
}

function getTagValue(event: NostrEvent, name: string): string | undefined {
  return event.tags.find((tag) => tag[0] === name)?.[1];
}

function isEmojiShape(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 20 && /[^\x00-\x7F]/.test(value);
}

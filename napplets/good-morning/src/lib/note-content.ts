import * as nip19 from 'nostr-tools/nip19';

export type NoteContentBlock =
  | { type: 'text'; value: string }
  | { type: 'url'; value: string; source: string }
  | { type: 'emoji'; value: string; source: string; imageUrl: string }
  | { type: 'profile'; value: string; source: string }
  | { type: 'event'; value: string; source: string }
  | { type: 'address'; value: string; source: string }
  | { type: 'media'; value: string; mediaType: 'image' | 'video'; source: string }
  | { type: 'resource'; value: string; mediaType: 'image'; source: string };

export type NoteContentEmbed = Exclude<NoteContentBlock, { type: 'text' | 'url' | 'emoji' }>;

interface Candidate {
  start: number;
  end: number;
  block: Exclude<NoteContentBlock, { type: 'text' }>;
}

const NIP19_RE = /\b(?:nostr:)?((?:npub|nprofile|note|nevent|naddr)1[023456789acdefghjklmnpqrstuvwxyz]+)\b/gi;
const URL_RE = /\bhttps?:\/\/[^\s<>"']+/gi;
const BLOSSOM_RE = /\bblossom:sha256:[0-9a-f]{64}\b/gi;
const CUSTOM_EMOJI_TOKEN_RE = /:([A-Za-z0-9_-]+):/g;
const CUSTOM_EMOJI_SHORTCODE_RE = /^[A-Za-z0-9_-]+$/;
const IMAGE_EXT_RE = /\.(?:png|jpe?g|gif|webp|avif)(?:[?#].*)?$/i;
const VIDEO_EXT_RE = /\.(?:mp4|webm|mov|m4v)(?:[?#].*)?$/i;

export interface ExtractNoteContentEmbedsOptions {
  includeProfiles?: boolean;
  includeEvents?: boolean;
  includeAddresses?: boolean;
  includeImageUrls?: boolean;
  includeVideoUrls?: boolean;
  includeResources?: boolean;
}

export function parseNoteContent(content: string, emojiTags: readonly (readonly string[])[] = []): NoteContentBlock[] {
  const candidates = collectCandidates(content, emojiTags);
  const blocks: NoteContentBlock[] = [];
  let cursor = 0;
  for (const candidate of candidates) {
    if (candidate.start < cursor) continue;
    if (candidate.start > cursor) blocks.push({ type: 'text', value: content.slice(cursor, candidate.start) });
    blocks.push(candidate.block);
    cursor = candidate.end;
  }
  if (cursor < content.length) blocks.push({ type: 'text', value: content.slice(cursor) });
  return blocks;
}

export function extractNoteContentEmbeds(
  content: string,
  limit = 6,
  options: ExtractNoteContentEmbedsOptions = {},
): NoteContentEmbed[] {
  const includeProfiles = options.includeProfiles ?? true;
  const includeEvents = options.includeEvents ?? true;
  const includeAddresses = options.includeAddresses ?? true;
  const includeImageUrls = options.includeImageUrls ?? true;
  const includeVideoUrls = options.includeVideoUrls ?? true;
  const includeResources = options.includeResources ?? true;
  const embeds: NoteContentEmbed[] = [];
  const seen = new Set<string>();

  for (const block of parseNoteContent(content)) {
    if (block.type === 'text' || block.type === 'url' || block.type === 'emoji') continue;
    if (block.type === 'profile' && !includeProfiles) continue;
    if (block.type === 'event' && !includeEvents) continue;
    if (block.type === 'address' && !includeAddresses) continue;
    if (block.type === 'resource' && !includeResources) continue;
    if (block.type === 'media' && block.mediaType === 'image' && !includeImageUrls) continue;
    if (block.type === 'media' && block.mediaType === 'video' && !includeVideoUrls) continue;
    const key = `${block.type}:${block.value}`;
    if (seen.has(key) || embeds.length >= limit) continue;
    seen.add(key);
    embeds.push(block);
  }
  return embeds;
}

function collectCandidates(content: string, emojiTags: readonly (readonly string[])[]): Candidate[] {
  const candidates: Candidate[] = [];
  const emojis = parseCustomEmojiTags(emojiTags);

  for (const match of content.matchAll(CUSTOM_EMOJI_TOKEN_RE)) {
    const shortcode = match[1];
    const imageUrl = shortcode ? emojis.get(shortcode) : undefined;
    if (!shortcode || !imageUrl) continue;
    const source = match[0]!;
    const start = match.index ?? 0;
    candidates.push({ start, end: start + source.length, block: { type: 'emoji', value: shortcode, source, imageUrl } });
  }

  for (const match of content.matchAll(NIP19_RE)) {
    const encoded = match[1];
    if (!encoded) continue;
    const source = match[0]!.startsWith('nostr:') ? match[0]! : `nostr:${encoded}`;
    const block = decodeNip19Block(encoded, source);
    if (block) {
      const start = match.index ?? 0;
      candidates.push({ start, end: start + match[0]!.length, block });
    }
  }

  for (const match of content.matchAll(URL_RE)) {
    const raw = match[0]!;
    const value = raw.replace(/[),.;!?]+$/g, '');
    const start = match.index ?? 0;
    candidates.push({ start, end: start + value.length, block: mediaBlockForUrl(value) ?? { type: 'url', value, source: value } });
  }

  for (const match of content.matchAll(BLOSSOM_RE)) {
    const value = match[0]!.toLowerCase();
    const start = match.index ?? 0;
    candidates.push({ start, end: start + match[0]!.length, block: { type: 'resource', mediaType: 'image', value, source: value } });
  }

  return candidates.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
}

function parseCustomEmojiTags(tags: readonly (readonly string[])[]): Map<string, string> {
  const emojis = new Map<string, string>();
  for (const tag of tags) {
    const shortcode = tag[1];
    const imageUrl = tag[2];
    if (tag[0] === 'emoji' && typeof shortcode === 'string' && typeof imageUrl === 'string' && CUSTOM_EMOJI_SHORTCODE_RE.test(shortcode)) {
      emojis.set(shortcode, imageUrl);
    }
  }
  return emojis;
}

function decodeNip19Block(encoded: string, source: string): Candidate['block'] | null {
  try {
    const decoded = nip19.decode(encoded);
    if (decoded.type === 'npub') return { type: 'profile', value: decoded.data, source };
    if (decoded.type === 'note') return { type: 'event', value: decoded.data, source };
    if (decoded.type === 'nprofile') return { type: 'profile', value: decoded.data.pubkey, source };
    if (decoded.type === 'nevent') return { type: 'event', value: decoded.data.id, source };
    if (decoded.type === 'naddr') return { type: 'address', value: `${decoded.data.kind}:${decoded.data.pubkey}:${decoded.data.identifier}`, source };
    return null;
  } catch {
    return null;
  }
}

function mediaBlockForUrl(value: string): Candidate['block'] | null {
  if (IMAGE_EXT_RE.test(value)) return { type: 'media', mediaType: 'image', value, source: value };
  if (VIDEO_EXT_RE.test(value)) return { type: 'media', mediaType: 'video', value, source: value };
  return null;
}

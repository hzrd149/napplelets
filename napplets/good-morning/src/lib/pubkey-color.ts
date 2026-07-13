const HEX_64_RE = /^[0-9a-f]{64}$/i;
const FALLBACK_COLOR = 'hsl(180 60% 68%)';

export function pubkeyReadableColor(pubkey: string): string {
  const normalized = pubkey.trim().toLowerCase();
  if (!HEX_64_RE.test(normalized)) return FALLBACK_COLOR;
  let hash = 0x811c9dc5;
  const mixed = `${normalized.slice(0, 16)}${normalized.slice(-16)}`;
  for (let i = 0; i < mixed.length; i++) {
    hash ^= mixed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `hsl(${(hash >>> 0) % 360} 72% 66%)`;
}

export function pubkeyColorStyle(pubkey: string): string {
  return `color: ${pubkeyReadableColor(pubkey)}`;
}

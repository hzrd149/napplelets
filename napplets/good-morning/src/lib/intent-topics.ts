const CANONICAL_HEX_PUBKEY = /^[0-9a-f]{64}$/;

export const IDENTITY_CHANGED_TOPIC = 'identity:changed';
export const LEGACY_AUTH_IDENTITY_CHANGED_TOPIC = 'auth:identity-changed';

export interface IdentityChangedPayload {
  pubkey: string | null;
}

export function isCanonicalHexPubkey(value: unknown): value is string {
  return typeof value === 'string' && CANONICAL_HEX_PUBKEY.test(value);
}

export function parseIdentityChangedPayload(payload: unknown): IdentityChangedPayload | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const pubkey = (payload as { pubkey?: unknown }).pubkey;
  if (pubkey === null) return { pubkey: null };
  if (!isCanonicalHexPubkey(pubkey)) return null;
  return { pubkey };
}

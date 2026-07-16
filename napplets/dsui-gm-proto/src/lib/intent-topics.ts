const CANONICAL_HEX_PUBKEY = /^[0-9a-f]{64}$/;

export function isCanonicalHexPubkey(value: unknown): value is string {
  return typeof value === 'string' && CANONICAL_HEX_PUBKEY.test(value);
}

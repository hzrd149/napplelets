// Stands in for the bare `nostr-tools` root specifier (see the alias in
// vite.config.ts). The real root re-exports the relay pool, which touches
// `fetch`/`WebSocket` and trips the conformance forbidden-globals check.
//
// Only re-export side-effect-free subpaths. Runtime values imported from the
// bare root by any dependency must be listed here or the build fails with
// "does not provide an export named ..." — type-only imports are erased and
// need no entry.
import * as kinds from 'nostr-tools/kinds';
import * as nip19 from 'nostr-tools/nip19';
import * as pure from 'nostr-tools/pure';

export { kinds, nip19 };
export const { finalizeEvent, generateSecretKey, getEventHash, getPublicKey, verifyEvent } = pure;

# NIP-5D Reference

This repository does not contain normative protocol text.

Authoritative living source and upstream discussion:

`https://github.com/nostr-protocol/nips/pull/2303`

Compatibility note: current Kehto/Paja hosts derive the injected domain grant
from manifest `requires`. Until that runtime has a separate optional-grant path,
this workspace lists degradable domains there too. Treat that as a current host
constraint, not as normative optional-capability semantics for NIP-5D.

## What To Use This For

- Confirm the JSON envelope shape for napplet-shell postMessage transport.
- Confirm iframe sandbox assumptions.
- Confirm how a runtime injects available NAP domains before app scripts.
- Confirm that shell-owned services, not the napplet, hold privileged access.

## What Not To Do

- Do not copy protocol requirements into app code as hardcoded shell policy.
- Do not treat this template as the spec.
- Do not infer missing shell behavior from browser side effects.

When protocol behavior appears to conflict with a package README or NAP draft,
check the current NIP-5D PR head and the relevant living NAP text before using
the current `@napplet` package source as implementation evidence.

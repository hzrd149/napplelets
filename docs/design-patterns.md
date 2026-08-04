# Napplet Design Patterns

## Bootstrap

The runtime injects `window.napplet` before app code runs. Napplet application
code imports SDK helpers; it does not install its own runtime namespace.

```ts
import { outbox, storage, identity } from '@napplet/sdk';
```

SDK methods read `window.napplet` at call time. This lets app modules import SDK
helpers freely while preserving runtime-owned injection.

## Feature Detection

Use injected domain property presence for optional surfaces.

```ts
const supportsResource = Boolean(window.napplet?.resource);
const supportsOutbox = Boolean(window.napplet?.outbox);
```

Support checks are advisory. A user-triggered call can still fail because the
shell denied a grant, disconnected a signer, hit a quota, or rejected a policy
input. Always surface operation errors.

## Storage

Use storage for durable app state.

```ts
await storage.setItem('draft', value);
const value = await storage.getItem('draft');
```

Storage is scoped by napplet identity and aggregate hash on the shell side.
Do not add browser storage fallbacks without a deliberate privacy review.

## Config

Prefer manifest-declared config through `@napplet/vite-plugin`.

```ts
nip5aManifest({
  nappletType: 'my-napplet',
  configSchema,
});
```

Use `config.get()` for a one-time snapshot, `config.subscribe()` for live values,
and `config.openSettings()` to deep-link into shell-owned settings UI.

## Text Selection

The starter treats the napplet surface like app chrome: static text does not
show accidental selection highlights by default. The default is plain CSS in
`src/styles.css`, not a shell or protocol rule.

Use one of these app-local overrides when copy/select behavior is part of the
napplet UX:

```html
<pre data-napplet-select="text">copyable output</pre>
<code data-napplet-select="all">nostr:...</code>
```

For a text-heavy napplet, set the root variable instead:

```css
:root {
  --napplet-text-selection: text;
}
```

## Inputs And Actions

Never use HTML `<form>` elements or form submission APIs in a napplet. Build
input flows from plain containers, inputs, and `type="button"` buttons with
explicit event handlers. If pressing Enter should confirm an action, handle the
input's `keydown` event directly and preserve IME composition:

```ts
confirmButton.addEventListener('click', () => void confirm());
nameInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' || event.isComposing) return;
  event.preventDefault();
  void confirm();
});
```

Surface validation and runtime failures in the napplet UI. Do not rely on native
form submission, implicit submit buttons, or `method="dialog"` behavior.

## OUTBOX-First Nostr Access

Use OUTBOX for normal social event reads and publishes so the runtime owns relay
discovery, fallback, deduplication, signing, and fanout.

```ts
const { events } = await outbox.query([{ kinds: [1], limit: 5 }]);
const sub = outbox.subscribe([{ kinds: [1], limit: 20 }]);
sub.on('event', (result) => renderEvent(result.event));
sub.close();
```

Keep subscriptions tied to UI lifecycle and close them on teardown.

## Relay-Local Escape Hatch

Use RELAY only when a feature needs semantics tied to one named relay, such as
a NIP-29 group relay, raw relay diagnostics, or protocol tooling OUTBOX cannot
express. Document that reason next to the call.

## Resource Fetching

Use `resource.bytes()` for external read-only bytes. The shell applies its
resource policy before bytes reach the iframe.

```ts
const blob = await resource.bytes('https://example.com/avatar.png');
```

For images, prefer `bytesAsObjectURL()` and revoke the handle when the element is
done using it.

## Virtual Filesystem Access

Use NAP-FS for shell-mediated files and directories. The napplet sees virtual
absolute paths only; roots, permissions, limits, watches, and operation results
are advisory or policy-bound runtime data.

```ts
const { roots, limits } = await fs.info();
const entries = await fs.list(roots[0].path);
const result = await fs.read(entries[0].path, { length: limits.maxReadBytes });
```

Treat watch events as invalidation hints and re-list after receiving them.
Respect read/write limits, handle every operation rejection, and never translate
virtual paths into assumptions about the host filesystem.

## Deferred NAPs (direct network access, security class)

NAP-CONNECT (direct-network grants: `connectGranted()` / `connectOrigins()`) and
NAP-CLASS (shell-assigned posture: `getClass()`) are currently **deferred** on
the [NAPs track](https://github.com/napplet/naps). They are not part of the
active surface: the `connect`/`class` domains, their SDK helpers, and the
vite-plugin `connect` option have been removed. Do not depend on them. For
read-only external bytes, use `resource.bytes()`. If your napplet genuinely needs
a capability the active NAPs do not cover, propose it on the track first (see
below) rather than reaching for removed surface.

## Missing Protocol Surface

Do not create a new JSON envelope domain in app code when a named NAP interface
or numbered wire format is missing. First check whether existing NAPs can be
composed. If the feature really needs a reusable shell-mediated contract, follow
`docs/new-nap-proposals.md` and open a focused PR to
`https://github.com/napplet/naps`.

import { defineConfig } from 'vite';
import { nip5aManifest } from '@napplet/vite-plugin';
import type { NappletConfigSchema } from '@napplet/sdk';

const configSchema = {
  type: 'object',
  properties: {
    windowFrame: {
      type: 'boolean',
      title: 'Window frame',
      description:
        'Draw the Windows XP title bar and border. Turn this off when the shell already frames the napplet.',
      default: true,
      'x-napplet-section': 'appearance',
      'x-napplet-order': 1,
    },
  },
} satisfies NappletConfigSchema;

export default defineConfig({
  plugins: [
    nip5aManifest({
      nappletType: 'notepad',
      title: 'Notepad',
      description: "A Windows XP Notepad for the shell's virtual filesystem.",
      // Every domain the app touches. The current Kehto/Paja host derives the
      // injected grants from this list, so an omitted domain is simply absent at
      // runtime -- the app still feature-checks each one before use.
      //
      // `fs` is the whole point. `storage` keeps only the editor's own state:
      // which file was open, an unsaved buffer, and the word-wrap preference.
      // The documents themselves live on the filesystem, never in storage.
      //
      // `config` carries settings that belong to whoever placed this napplet
      // rather than to whoever is typing in it -- see `configSchema` above.
      // Word wrap deliberately stays out of it: that is a per-document editing
      // decision the typist makes from the Format menu, and it is persisted in
      // storage. `keys` is absent: every action has a menu item, so there is no
      // shell shortcut worth reserving and the shell keeps whatever keys it
      // wants.
      //
      // `inc` is how an intent actually arrives. NAP-INTENT has no inbound
      // envelope of its own: the shell resolves this napplet from the
      // `archetype` tag below, then delivers the caller's payload over the
      // convention's ordinary mechanism, which for `napplet:…/open` is an INC
      // topic event. Without `inc` the archetype tag would resolve and the
      // payload would never land.
      requires: ['fs', 'storage', 'inc', 'config'],
      // Settings owned by whoever placed this napplet, not by the person typing
      // in it. A shell that already draws its own title bar and frame around
      // the pane would otherwise show a window inside a window, and only the
      // shell knows that -- so it is a shell-owned setting rather than a menu
      // item. Default `true`, because a napplet dropped into a bare pane still
      // has to look like Notepad.
      configSchema,
      // The role this napplet fulfils, so a shell can route
      // `intent.open('text-editor', …)` here. `text-editor` rather than the
      // broader `editor`: Notepad refuses anything that is not UTF-8 text, so
      // claiming to handle every kind of editing would be a promise it breaks
      // on the first image. The slug is not yet in `napplet/naps`
      // `ARCHETYPES.md`, where slugs are first-come-first-served and
      // maintainer-approved -- register it there before treating it as stable.
      //
      // Archetype tags sit outside the aggregate `x` hash, so adding this does
      // not by itself change the napplet's identity; the source change does.
      // One tag per action. `open` is NAP-INTENT's default action, `edit` is
      // what a caller that means "let the user change this" reaches for; both
      // land in the same editor, because Notepad has no read-only mode. A
      // caller using `edit` against an `open`-only handler resolves to no
      // handler at all, so declaring only one would drop half the callers.
      archetypes: [
        { slug: 'text-editor', convention: 'napplet:text-editor/open' },
        { slug: 'text-editor', convention: 'napplet:text-editor/edit' },
      ],
      // Inline all JS/CSS into one `index.html`. NIP-5D loads a napplet as a
      // single self-contained `/index.html` via `iframe.srcdoc` with
      // `sandbox="allow-scripts"` and no `allow-same-origin` (an opaque origin):
      // there is no served origin the shell could fetch an external
      // `<script src>`/`<link href>` from, so the whole napplet must be one file.
      artifactMode: 'single-file',
    }),
  ],
  server: {
    port: 3002,
    cors: true,
  },
  build: {
    modulePreload: { polyfill: false },
    outDir: 'dist',
  },
});

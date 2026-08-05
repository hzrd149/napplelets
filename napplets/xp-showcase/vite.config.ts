import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { nip5aManifest } from '@napplet/vite-plugin';
import type { NappletConfigSchema } from '@napplet/sdk';

const configSchema = {
  type: 'object',
  properties: {
    // Same setting the other XP napplets carry, and the only way to show
    // `.window.xp-fill.xp-frameless` honestly: whether the napplet should draw
    // its own title bar is knowledge only the host has. A shell that already
    // frames the pane sets this false and the showcase drops its chrome.
    windowFrame: {
      type: 'boolean',
      title: 'Window frame',
      description:
        'Draw the Windows XP title bar and border. Turn this off when the shell already frames the napplet.',
      default: true,
      'x-napplet-section': 'appearance',
      'x-napplet-order': 1,
    },
    // The three skins are mutually exclusive stylesheets, not a palette knob --
    // picking one is a placement decision (a 98-era pane in a retro shell), so
    // it starts as config. The showcase still lets you flip skins in-app to
    // compare them; that choice is remembered in `storage` and wins for this
    // reader without rewriting the placement's default.
    skin: {
      type: 'string',
      title: 'Skin',
      description: 'Which XP.css skin the showcase opens with.',
      enum: ['xp', '98', 'gui'],
      default: 'xp',
      'x-napplet-section': 'appearance',
      'x-napplet-order': 2,
    },
  },
} satisfies NappletConfigSchema;

export default defineConfig({
  plugins: [
    // Inline all JS/CSS into a single `index.html`. NIP-5D loads a napplet as a
    // single self-contained `/index.html` via `iframe.srcdoc` with
    // `sandbox="allow-scripts"` and no `allow-same-origin` (an opaque origin):
    // there is no served origin from which the shell could fetch an external
    // `<script src>`/`<link href>`, so the whole napplet must be one inlined
    // file. `vite-plugin-singlefile` produces that artifact; `nip5aManifest`
    // then content-addresses it for the NIP-5A manifest.
    viteSingleFile(),
    nip5aManifest({
      nappletType: 'xp-showcase',
      title: 'XP Theme Showcase',
      description:
        'Every component, skin and token in @napplelets/theme-xp, wired to a live NAP-THEME payload.',
      // `theme` is the subject of the napplet, not a decoration: everything on
      // the Theme tab is the shell's own `theme.get` / `theme.changed` payload
      // rendered back, and the whole UI re-tints from it.
      //
      // `resource` is what makes the *optional* half of a NAP-THEME payload
      // real. `fonts.body.url` and `background.url` are external bytes, and a
      // sandboxed napplet has no network of its own -- without the resource NAP
      // the shell's font name resolves to nothing and its wallpaper never
      // paints. Both are feature-checked; the showcase reports the degradation
      // rather than hiding it.
      //
      // `config` carries the two placement-owned settings above. `storage`
      // keeps only this reader's own view state -- the chosen skin and tab --
      // which is a preference of whoever is looking, not of whoever placed it.
      requires: ['theme', 'resource', 'config', 'storage'],
      configSchema,
    }),
  ],
  server: {
    port: 3011,
    cors: true,
  },
  build: {
    modulePreload: { polyfill: false },
    outDir: 'dist',
  },
});

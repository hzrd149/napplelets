import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
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
    // Inline all JS/CSS into a single `index.html`. NIP-5D loads a napplet as a
    // single self-contained `/index.html` via `iframe.srcdoc` with
    // `sandbox="allow-scripts"` and no `allow-same-origin` (an opaque origin):
    // there is no served origin from which the shell could fetch an external
    // `<script src>`/`<link href>`, so the whole napplet must be one inlined
    // file. `vite-plugin-singlefile` produces that artifact; `nip5aManifest`
    // then content-addresses it for the NIP-5A manifest.
    viteSingleFile(),
    nip5aManifest({
      nappletType: 'minesweeper',
      title: 'Minesweeper',
      description: 'A Windows XP-style Minesweeper game with a Nostr friends feed.',
      requires: ['config', 'identity', 'outbox', 'common'],
      configSchema,
    }),
  ],
  server: {
    port: 3010,
    cors: true,
  },
  build: {
    modulePreload: { polyfill: false },
    outDir: 'dist',
  },
});

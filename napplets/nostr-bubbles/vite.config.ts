import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { nip5aManifest } from '@napplet/vite-plugin';

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
      nappletType: 'nostr-bubbles',
      requires: ['identity', 'outbox', 'relay', 'resource', 'storage', 'theme'],
      artifactMode: 'single-file',
    }),
  ],
  build: {
    modulePreload: { polyfill: false },
  },
  server: {
    // Paja loads the napplet via `iframe.srcdoc` under `sandbox="allow-scripts"`
    // (no `allow-same-origin`), which gives the iframe an opaque origin. Module
    // scripts are CORS-mode, so Vite must reflect `Access-Control-Allow-Origin:
    // *` for `Origin: null` or the cross-origin `/src/main.ts` request is blocked.
    // The default `{ origin: defaultAllowedOrigins }` regex rejects `null`.
    cors: true,
  },
});

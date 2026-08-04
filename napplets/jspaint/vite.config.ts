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
      nappletType: 'jspaint',
      title: 'JS Paint',
      description: 'A compact Windows XP-style bitmap editor.',
      // NAP-FS owns user-selected files; NAP-STORAGE keeps a recovery copy and
      // is the fallback when filesystem access is unavailable or denied.
      // The XP chrome is static and intentionally does not consume NAP-THEME.
      requires: ['fs', 'storage'],
      artifactMode: 'single-file',
    }),
  ],
  server: {
    // Paja's opaque-origin iframe needs CORS-enabled Vite module responses.
    // The package's dev script owns the concrete port, like the other basic
    // napplets in this monorepo.
    cors: true,
  },
  build: {
    modulePreload: { polyfill: false },
    outDir: 'dist',
  },
});

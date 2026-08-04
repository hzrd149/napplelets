import { defineConfig } from 'vite';
import { nip5aManifest } from '@napplet/vite-plugin';

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
      // `config` is absent, so word wrap is a menu toggle persisted in storage
      // rather than a shell-owned setting. `keys` is absent too: every action
      // has a menu item, so there is no shell shortcut worth reserving and the
      // shell keeps whatever keys it wants.
      requires: ['fs', 'storage'],
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

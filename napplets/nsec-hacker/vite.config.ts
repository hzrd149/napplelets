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
    // file. That is also why GSAP is bundled rather than pulled from a CDN.
    viteSingleFile(),
    nip5aManifest({
      nappletType: 'nsec-hacker',
      title: 'Nsec Hacker',
      description: 'Brute-force your own nsec. It will not work. That is the joke.',
      // `identity` is the only domain this napplet touches: `getPublicKey()`
      // supplies the pubkey to compare guesses against, and `onChanged()` lets
      // the target follow an account switch. Everything else -- the mining, the
      // animation, the whole point -- runs with no shell help at all.
      //
      // Absent `identity` the napplet degrades to "NO TARGET": it still mines
      // and still animates, it just says there was nothing to match rather than
      // faking a denial.
      requires: ['identity'],
      artifactMode: 'single-file',
    }),
  ],
  build: {
    modulePreload: { polyfill: false },
    outDir: 'dist',
  },
  server: {
    port: 3012,
    cors: true,
  },
});

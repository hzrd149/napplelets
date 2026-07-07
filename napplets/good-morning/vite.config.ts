import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import UnoCSS from '@unocss/vite';
import { nip5aManifest } from '@napplet/vite-plugin';

export default defineConfig({
  plugins: [
    UnoCSS(),
    svelte(),
    // The kind-35129 manifest is build-signed from this option. `nappletType`
    // becomes the manifest `d` tag, so it MUST match the launcher registry dTag
    // ('good-morning') or the resolver REQs a non-existent manifest.
    //
    // Capability ACL: the runtime silently drops service messages for undeclared
    // domains. We route GM reads and Quick GM publishes through NAP-OUTBOX, so
    // WITHOUT 'outbox' here the inbox never fetches and Quick GM cannot publish.
    // 'resource' is required for avatar/media image loading, 'inc' for identity +
    // note:open/profile:open intents.
    nip5aManifest({
      nappletType: 'good-morning',
      requires: ['identity', 'inc', 'outbox', 'resource', 'theme'],
      artifactMode: 'single-file',
      archetypes: [{ slug: 'good-morning', naps: ['good-morning'] }],
    }),
  ],
  resolve: {
    dedupe: ['svelte'],
  },
  server: {
    port: 5184,
    cors: true,
  },
  build: {
    modulePreload: { polyfill: false },
    outDir: 'dist',
  },
});

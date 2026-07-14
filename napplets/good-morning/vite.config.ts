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
    // Capability grant list: current runtimes derive injected domains from
    // manifest requirements. Keep every used domain here; the app still guards
    // degraded paths so incomplete diagnostic runtimes do not crash it.
    nip5aManifest({
      nappletType: 'good-morning',
      requires: ['identity', 'inc', 'outbox', 'resource', 'theme', 'link'],
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

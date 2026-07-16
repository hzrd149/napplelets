import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { nip5aManifest } from '@napplet/vite-plugin';

export default defineConfig({
  plugins: [
    tailwindcss(),
    svelte(),
    // The kind-35129 manifest is build-signed from this option. `nappletType`
    // becomes the manifest `d` tag, so it MUST match the launcher registry dTag
    // ('dsui-gm-proto') or the resolver REQs a non-existent manifest.
    //
    // Capability grant list: current runtimes derive injected domains from
    // manifest requirements. Keep every used domain here; the app still guards
    // degraded paths so incomplete diagnostic runtimes do not crash it.
    nip5aManifest({
      nappletType: 'dsui-gm-proto',
      requires: ['identity', 'inc', 'outbox', 'resource', 'theme', 'link'],
      artifactMode: 'single-file',
      archetypes: [{ slug: 'dsui-gm-proto', naps: ['good-morning'] }],
    }),
  ],
  resolve: {
    dedupe: ['svelte'],
  },
  server: {
    port: 5185,
    cors: true,
  },
  build: {
    modulePreload: { polyfill: false },
    outDir: 'dist',
  },
});

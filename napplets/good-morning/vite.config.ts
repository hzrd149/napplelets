import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import UnoCSS from '@unocss/vite';
import { nip5aManifest } from '@napplet/vite-plugin';

export default defineConfig({
  plugins: [
    {
      name: 'applesauce-granular-kinds',
      // The upstream root nostr-tools bundle initializes NIP-11 fetch even
      // when Applesauce only imports kind constants. Use its pure subpath.
      transform(code, id) {
        if (!/\/applesauce-core\/dist\//.test(id)) return;
        const updated = code.replace(
          /import \{ kinds \} from "nostr-tools";/g,
          'import * as kinds from "nostr-tools/kinds";',
        );
        if (updated !== code) return { code: updated, map: null };
      },
    },
    UnoCSS(),
    svelte(),
    // The kind-35129 manifest is build-signed from this option. `nappletType`
    // becomes the manifest `d` tag, so it MUST match the launcher registry dTag
    // ('good-morning') or the resolver REQs a non-existent manifest.
    //
    // Capability grant list: current runtimes derive injected domains from
    // manifest requirements. Keep every used domain here; the app still guards
    // degraded paths so incomplete diagnostic runtimes do not crash it.
    // Explicit inlining keeps the artifact self-contained with Vite 8/Rolldown.
    viteSingleFile(),
    nip5aManifest({
      nappletType: 'good-morning',
      requires: ['identity', 'outbox', 'resource', 'theme', 'link', 'intent'],
      artifactMode: 'single-file',
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
    rollupOptions: {
      treeshake: {
        // Applesauce's pure note factory imports helper barrels whose unused
        // modules initialize browser debug/network helpers. Drop those modules
        // while retaining the factory and all exports it actually uses.
        moduleSideEffects: (id) => !/\/(?:applesauce-[^/]+|nostr-tools)\//.test(id),
      },
    },
    outDir: 'dist',
  },
});

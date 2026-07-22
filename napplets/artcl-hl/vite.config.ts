import tailwindcss from '@tailwindcss/vite';
import { nip5aManifest } from '@napplet/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const configSchema = {
  type: 'object',
  title: 'Article Highlights',
  properties: {
    naddr: {
      type: 'string',
      title: 'Article naddr',
      description: 'NIP-19 naddr for the NIP-23 article to open.',
      minLength: 8,
      maxLength: 1200,
      'x-napplet-section': 'Article',
    },
  },
  additionalProperties: false,
} as const;

export default defineConfig({
  resolve: {
    // Both aliases are load-bearing for `boot/no-forbidden-globals`, not cosmetic.
    // Exact-match (`/^x$/`) on purpose: app code imports the safe `nostr-tools/*`
    // subpaths directly, and only the bare-root specifier must be intercepted.
    alias: [
      // `debug` reads process.env and installs a console logger; applesauce-core
      // imports it transitively. Swap in an inert no-op logger.
      { find: /^debug$/, replacement: new URL('./src/lib/debug-safe.ts', import.meta.url).pathname },
      // The `nostr-tools` root re-exports the relay pool, which references
      // `fetch`/`WebSocket` at module scope. applesauce-core imports the bare
      // root for `kinds`; without this alias conformance fails with
      // "Accessed forbidden surface(s): fetch" (and the bundle grows ~48 kB).
      { find: /^nostr-tools$/, replacement: new URL('./src/lib/nostr-tools-safe.ts', import.meta.url).pathname },
    ],
  },
  plugins: [
    react(),
    tailwindcss(),
    viteSingleFile(),
    nip5aManifest({
      nappletType: 'artcl-hl',
      requires: ['config', 'outbox', 'resource', 'theme'],
      artifactMode: 'single-file',
      configSchema,
    }),
  ],
  build: {
    modulePreload: { polyfill: false },
  },
  server: {
    cors: true,
  },
});

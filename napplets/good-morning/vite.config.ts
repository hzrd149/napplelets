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
      title: "GM Protocol",
      description: 'Say good morning to your friends every day',
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
    outDir: 'dist',
    // Inline source maps for debugging the BUILT single-file artifact — opt-in
    // via `SOURCE_MAPS=inline pnpm build`. External `.map` files can't be
    // fetched from the srcdoc iframe's opaque origin, so 'inline' (a base64
    // data-URI appended to the inlined <script>) is the only mode that survives
    // single-file inlining and loads at runtime. It stays OFF by default: maps
    // ~5.6x the artifact (~650KB → ~3.7MB) and shift the NIP-5A aggregate hash,
    // so normal `pnpm build`/`pnpm deploy` ship the lean artifact. `pnpm dev`
    // (Paja) already has maps via Vite, so this only matters for the built file.
    sourcemap: process.env.SOURCE_MAPS === 'inline' ? 'inline' : false,
  },
});

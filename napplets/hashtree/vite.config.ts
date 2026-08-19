import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { nip5aManifest } from '@napplet/vite-plugin';
import type { NappletConfigSchema } from '@napplet/sdk';

/**
 * Blossom servers are the only way to fetch a hashtree's blobs. BUD-18 defines
 * no `xs=` server hint for `htree://` references and never says to use the root
 * author's BUD-03 list, so a resolver needs an out-of-band server set. The
 * signed-in user's own BUD-03 list is tried ahead of these, so they are the
 * fallback for a user who has published none — the two the reference
 * implementation ships with.
 */
const DEFAULT_BLOSSOM_SERVERS = ['https://blossom.primal.net', 'https://cdn.iris.to'];

const configSchema = {
  type: 'object',
  properties: {
    useUserServerList: {
      type: 'boolean',
      title: 'Use my own server list',
      description:
        'Try the Blossom servers from your own BUD-03 kind 10063 list first, before the servers below.',
      default: true,
      'x-napplet-section': 'sources',
      'x-napplet-order': 1,
    },
    blossomServers: {
      type: 'array',
      title: 'Blossom servers',
      description:
        'Servers tried in order when fetching a blob by hash. Decryption keys are never sent to a server.',
      items: { type: 'string' },
      default: DEFAULT_BLOSSOM_SERVERS,
      'x-napplet-section': 'sources',
      'x-napplet-order': 2,
    },
    useAuthorServerList: {
      type: 'boolean',
      title: "Use the tree author's server list",
      description:
        'For npub/naddr references, also try the BUD-03 kind 10063 servers published by the root event author.',
      default: true,
      'x-napplet-section': 'sources',
      'x-napplet-order': 3,
    },
    maxParallelChunks: {
      type: 'integer',
      title: 'Parallel chunk downloads',
      description: 'How many 2 MiB file chunks to fetch concurrently when assembling a file.',
      minimum: 1,
      maximum: 16,
      default: 4,
      'x-napplet-section': 'transfer',
      'x-napplet-order': 1,
    },
    maxCacheBytes: {
      type: 'integer',
      title: 'Blob cache size (MiB)',
      description: 'In-memory budget for verified manifests and chunks.',
      minimum: 8,
      maximum: 1024,
      default: 128,
      'x-napplet-section': 'transfer',
      'x-napplet-order': 2,
    },
    autoPreview: {
      type: 'boolean',
      title: 'Preview on select',
      description: 'Fetch and render a file as soon as it is selected, instead of on demand.',
      default: false,
      'x-napplet-section': 'behavior',
      'x-napplet-order': 1,
    },
  },
} satisfies NappletConfigSchema;

export default defineConfig({
  plugins: [
    svelte(),
    // NIP-5D loads a napplet via `iframe.srcdoc` with `sandbox="allow-scripts"`
    // and no `allow-same-origin` (an opaque origin): there is no served origin
    // the shell could fetch an external `<script src>`/`<link href>` from, so
    // the whole napplet must be one inlined file. `viteSingleFile` produces that
    // artifact; `artifactMode` below declares it in the manifest.
    viteSingleFile(),
    nip5aManifest({
      nappletType: 'hashtree',
      title: 'Hashtree',
      description: 'Browse Blossom hashtree folders (BUD-15/16/17/18) read-only.',
      // Current hosts derive the injected domain grant from this list, so every
      // domain the app can touch must appear here. Only `resource` is actually
      // essential -- see `src/lib/nap.ts` for the essential/degraded split that
      // drives the UI when a host injects less than this.
      requires: [
        'resource', // fetch blobs by hash from Blossom servers -- essential
        'outbox', // kind 30064 mutable roots + kind 10063 server lists
        'identity', // the signed-in user's pubkey, to read their BUD-03 servers
        'config', // server list, concurrency, cache budget
        'theme', // DSUI theme following
        'link', // open a single-blob file at its real https URL
        'fs', // save an assembled file to disk
        'media', // transport controls while previewing audio/video
        'storage', // recently opened trees
      ],
      artifactMode: 'single-file',
      // No `archetypes`: NAP-INTENT's inbound envelopes are only invoke/available/
      // handlers results and availability changes -- the protocol has no way to
      // deliver a payload to a handler. Declaring an archetype would advertise a
      // role this napplet cannot actually service. References come from the entry
      // screen instead.
      configSchema,
    }),
  ],
  resolve: {
    dedupe: ['svelte'],
  },
  build: {
    modulePreload: { polyfill: false },
    outDir: 'dist',
  },
  server: {
    // Paja loads the napplet via `iframe.srcdoc` under `sandbox="allow-scripts"`
    // (no `allow-same-origin`), which gives the iframe an opaque origin. Module
    // scripts are CORS-mode, so Vite must reflect `Access-Control-Allow-Origin:
    // *` for `Origin: null` or the cross-origin `/src/main.ts` request is blocked.
    // The default `{ origin: defaultAllowedOrigins }` regex rejects `null`.
    //
    // The package's dev script owns the concrete port, like the other basic
    // napplets in this monorepo.
    cors: true,
  },
});

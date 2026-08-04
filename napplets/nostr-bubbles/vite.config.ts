import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { nip5aManifest } from '@napplet/vite-plugin';
import type { NappletConfigSchema } from '@napplet/sdk';

const configSchema = {
  type: 'object',
  properties: {
    sourceMode: {
      type: 'string',
      title: 'Activity source',
      description: 'Watch your contacts through OUTBOX or named popular relays.',
      enum: ['contacts', 'popular'],
      default: 'contacts',
      'x-napplet-section': 'stream',
      'x-napplet-order': 1,
    },
    bubbleDensityMode: {
      type: 'string',
      title: 'Bubble density',
      enum: ['auto', 'manual'],
      default: 'auto',
      'x-napplet-section': 'appearance',
      'x-napplet-order': 1,
    },
    bubbleTargetCount: {
      type: 'integer',
      title: 'Target bubbles',
      minimum: 8,
      maximum: 96,
      default: 44,
      'x-napplet-section': 'appearance',
      'x-napplet-order': 2,
    },
    enableReactions: {
      type: 'boolean',
      title: 'Show reactions',
      default: true,
      'x-napplet-section': 'events',
      'x-napplet-order': 1,
    },
    includeZaps: {
      type: 'boolean',
      title: 'Show Lightning zaps',
      default: true,
      'x-napplet-section': 'events',
      'x-napplet-order': 2,
    },
    includeOnchainZaps: {
      type: 'boolean',
      title: 'Show on-chain zaps',
      default: true,
      'x-napplet-section': 'events',
      'x-napplet-order': 3,
    },
    zapBreaksBubbles: {
      type: 'boolean',
      title: 'Zap collisions break bubbles',
      default: true,
      'x-napplet-section': 'appearance',
      'x-napplet-order': 3,
    },
  },
} satisfies NappletConfigSchema;

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
      nappletType: 'nostr-bubbles',
      requires: ['identity', 'outbox', 'relay', 'resource', 'config', 'theme', 'common'],
      artifactMode: 'single-file',
      configSchema,
    }),
  ],
  build: {
    modulePreload: { polyfill: false },
  },
  server: {
    // Paja loads the napplet via `iframe.srcdoc` under `sandbox="allow-scripts"`
    // (no `allow-same-origin`), which gives the iframe an opaque origin. Module
    // scripts are CORS-mode, so Vite must reflect `Access-Control-Allow-Origin:
    // *` for `Origin: null` or the cross-origin `/src/main.ts` request is blocked.
    // The default `{ origin: defaultAllowedOrigins }` regex rejects `null`.
    cors: true,
  },
});

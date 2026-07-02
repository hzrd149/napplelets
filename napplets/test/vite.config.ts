import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { nip5aManifest } from '@napplet/vite-plugin';
import type { NappletConfigSchema } from '@napplet/sdk';

const configSchema = {
  type: 'object',
  properties: {
    accentColor: {
      type: 'string',
      enum: ['blue', 'green', 'amber'],
      default: 'blue',
      'x-napplet-section': 'appearance',
      'x-napplet-order': 1,
    },
    defaultRelayLimit: {
      type: 'integer',
      minimum: 1,
      maximum: 50,
      default: 5,
      'x-napplet-section': 'relay',
      'x-napplet-order': 1,
    },
  },
  required: ['accentColor'],
} satisfies NappletConfigSchema;

export default defineConfig({
  build: {
    // A NIP-5D napplet is loaded via `iframe.srcdoc` in the host shell, i.e. it
    // always runs in the host's (modern) browser — there is no legacy runtime to
    // support. Vite's default target (es2020/chrome87/…) makes esbuild try to
    // lower object-rest destructuring emitted by the `@napplet` packages, which
    // it can't ("Transforming destructuring … is not supported yet"). Target
    // esnext so the modern syntax passes through untouched.
    target: 'esnext',
  },
  server: {
    // In `pnpm shell`, the napplet is loaded inside an `allow-scripts` iframe
    // with no `allow-same-origin` (opaque origin), so its dev requests back to
    // this server (`/@vite/client`, `/src/main.ts`, HMR) carry `Origin: null`
    // and are cross-origin. Vite 6's default CORS only permits localhost
    // origins, which blocks them. Allow any origin for local dev so the host
    // shell's iframe can boot the napplet.
    cors: { origin: '*' },
  },
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
      nappletType: 'test',
      requires: ['relay', 'storage', 'identity', 'config', 'resource', 'notify'],
      configSchema,
    }),
  ],
});


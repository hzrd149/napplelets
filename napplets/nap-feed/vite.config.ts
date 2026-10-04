import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { nip5aManifest } from '@napplet/vite-plugin';

export default defineConfig({
  plugins: [
    // Explicit inlining keeps the artifact self-contained with Vite 8/Rolldown.
    viteSingleFile(),
    nip5aManifest({
      nappletType: 'nap-feed',
      title: 'Napplet Feed',
      description: 'Napplet manifests published by your contacts, with quick naddr copy.',
      requires: ['config', 'identity', 'outbox', 'theme'],
      artifactMode: 'single-file',
      configSchema: {
        type: 'object',
        properties: {
          scanWindowDays: {
            type: 'integer',
            title: 'Scan window days',
            description: 'How far back to look for napplet manifests from contacts.',
            minimum: 1,
            maximum: 365,
            default: 30,
          },
          contactBatchSize: {
            type: 'integer',
            title: 'Contact batch size',
            description: 'How many contact pubkeys to include in each OUTBOX read batch.',
            minimum: 25,
            maximum: 250,
            default: 100,
          },
          includeSelf: {
            type: 'boolean',
            title: 'Include my napplets',
            description: 'Include napplet manifests published by the active identity.',
            default: true,
          },
        },
      },
    }),
  ],
  server: {
    port: 5187,
    cors: true,
  },
  build: {
    modulePreload: { polyfill: false },
    outDir: 'dist',
  },
});

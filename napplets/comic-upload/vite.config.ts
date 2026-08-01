import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { nip5aManifest } from '@napplet/vite-plugin';

export default defineConfig({
  plugins: [
    viteSingleFile(),
    nip5aManifest({
      nappletType: 'comic-upload',
      requires: ['identity', 'upload', 'outbox', 'theme'],
      artifactMode: 'single-file',
    }),
  ],
  build: {
    modulePreload: { polyfill: false },
  },
  server: {
    cors: true,
  },
});

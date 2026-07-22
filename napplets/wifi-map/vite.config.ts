import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { nip5aManifest } from '@napplet/vite-plugin';

export default defineConfig({
  plugins: [
    viteSingleFile(),
    nip5aManifest({
      nappletType: 'wifi-map',
      requires: ['outbox', 'storage', 'theme', 'link'],
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

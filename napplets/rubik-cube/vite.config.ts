import { nip5aManifest } from '@napplet/vite-plugin';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [
    viteSingleFile(),
    nip5aManifest({
      nappletType: 'rubik-cube',
      requires: [],
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

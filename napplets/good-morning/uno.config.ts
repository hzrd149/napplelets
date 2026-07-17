import { defineConfig, presetUno } from 'unocss';
import type { PresetMiniTheme } from 'unocss';
import { hyprUnoTheme } from '@napplelets/theme-hypr/uno';

export default defineConfig({
  presets: [presetUno()],
  theme: hyprUnoTheme as PresetMiniTheme,
});

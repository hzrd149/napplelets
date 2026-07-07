import '@napplet/shim'; // installs window.napplet before any component mounts (NIP-5D — no window.nostr)

import '@unocss/reset/tailwind.css';
import 'virtual:uno.css';
import { installBuiltInThemeClient } from '../../../hyprgate/packages/utils/src/theme-client';
import { mount } from 'svelte';
import App from './App.svelte';

installBuiltInThemeClient();

const app = mount(App, { target: document.getElementById('app')! });
export default app;

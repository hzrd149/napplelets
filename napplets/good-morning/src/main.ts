import '@napplet/shim'; // installs window.napplet before any component mounts (NIP-5D — no window.nostr)

import '@unocss/reset/tailwind.css';
import 'virtual:uno.css';
import { installBuiltInThemeClient } from '@hyprgate/utils';
import { mount } from 'svelte';
import App from './App.svelte';
import { napNote } from './lib/debug-log';

napNote(
  'good-morning',
  'NAP debug logging ON — window.__GM_DEBUG__=false silences it, window.__GM_DEBUG_STREAM__=false mutes the per-event firehose',
);

installBuiltInThemeClient();

const app = mount(App, { target: document.getElementById('app')! });
export default app;

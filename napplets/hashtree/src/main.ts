import '@napplelets/theme-dsui/styles.css';
import './styles.css';
import { installThemeClient } from '@napplelets/theme-dsui';
import { mount } from 'svelte';
import App from './App.svelte';
import { ReferenceQueue, subscribeInboundIntents } from './lib/intent-inbound.js';

// Subscribe before mounting. NAP-INTENT delivers handler payloads over NAP-INC,
// and a shell that launched this napplet *to* open a reference may emit it
// immediately -- a subscription installed after mount would miss it.
const intents = new ReferenceQueue();
subscribeInboundIntents((reference) => intents.push(reference));

installThemeClient();

const target = document.getElementById('app');
if (target === null) throw new Error('missing #app mount point');

const app = mount(App, { target, props: { intents } });

export default app;

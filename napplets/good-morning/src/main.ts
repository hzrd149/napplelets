import '@unocss/reset/tailwind.css';
import 'virtual:uno.css';
import { installBuiltInThemeClient } from './lib/theme-client';
import { mount } from 'svelte';
import App from './App.svelte';

installBuiltInThemeClient();

const app = mount(App, { target: document.getElementById('app')! });
export default app;

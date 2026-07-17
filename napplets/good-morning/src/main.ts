import '@napplelets/theme-hypr/styles.css';
import 'virtual:uno.css';
import { installThemeClient } from '@napplelets/theme-hypr';
import { mount } from 'svelte';
import App from './App.svelte';

installThemeClient();

const app = mount(App, { target: document.getElementById('app')! });
export default app;

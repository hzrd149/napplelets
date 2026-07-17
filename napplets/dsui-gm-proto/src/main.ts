import '@napplelets/theme-dsui/styles.css';
import { installThemeClient } from '@napplelets/theme-dsui';
import { mount } from 'svelte';
import App from './App.svelte';

installThemeClient();

const app = mount(App, { target: document.getElementById('app')! });
export default app;

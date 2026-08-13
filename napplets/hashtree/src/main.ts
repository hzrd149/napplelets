import '@napplelets/theme-dsui/styles.css';
import './styles.css';
import { installThemeClient } from '@napplelets/theme-dsui';
import { mount } from 'svelte';
import App from './App.svelte';

installThemeClient();

const target = document.getElementById('app');
if (target === null) throw new Error('missing #app mount point');

const app = mount(App, { target });

export default app;

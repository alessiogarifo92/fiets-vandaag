import { mount } from 'svelte';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/geist/400.css';
import '@fontsource/geist/500.css';
import '@fontsource/geist/600.css';
import App from './App.svelte';
import './app.css';

const target = document.getElementById('app');
if (!target) throw new Error('#app missing from index.html');

export default mount(App, { target });

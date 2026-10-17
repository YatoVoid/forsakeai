import '@fontsource-variable/newsreader/opsz.css';
import '@fontsource-variable/newsreader/opsz-italic.css';
import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/500.css';
import '@fontsource/instrument-sans/600.css';
import '@fontsource-variable/jetbrains-mono';
import './app/app.css';
import { mount } from 'svelte';
import App from './app/App.svelte';

mount(App, { target: document.getElementById('app')! });

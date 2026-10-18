import '@fontsource-variable/schibsted-grotesk/wght.css';
import './app/app.css';
import { mount } from 'svelte';
import App from './app/App.svelte';
import { migrateStorage } from './lib/migrate';

migrateStorage();
mount(App, { target: document.getElementById('app')! });

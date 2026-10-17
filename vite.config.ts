import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

/**
 * GitHub Pages can't send response headers, so the policy ships as a meta tag.
 * frame-ancestors and report-to are ignored in meta tags; move to real headers
 * when hosting changes. Dev mode is skipped because Vite injects inline styles.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "worker-src 'self' blob:",
  [
    "connect-src 'self'",
    'https://api.openai.com',
    'https://api.anthropic.com',
    'https://generativelanguage.googleapis.com',
    'https://openrouter.ai',
    'https://api.groq.com',
    'https://api.mistral.ai',
    'https://huggingface.co',
    'https://*.hf.co',
    'https://raw.githubusercontent.com',
    'http://localhost:*',
    'http://127.0.0.1:*',
  ].join(' '),
  "img-src 'self' data: blob:",
  "style-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function contentSecurityPolicy(): Plugin {
  return {
    name: 'plainhand-csp',
    apply: 'build',
    transformIndexHtml: () => [
      { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP }, injectTo: 'head-prepend' },
    ],
  };
}

export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [svelte(), contentSecurityPolicy()],
  worker: { format: 'es' },
  build: { target: 'es2023', sourcemap: true, assetsInlineLimit: 0 },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});

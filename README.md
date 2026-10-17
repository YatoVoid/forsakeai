# Plainhand

A voice editor for AI drafts. Paste stiff text and Plainhand marks and fixes the phrases that make writing sound machine-made, then rewrites the remaining stiff sentences on your own device or through your own API key. It runs entirely in the browser. There is no backend.

It does not promise any detector score, and no tool honestly can.

## How it works

1. **Parse.** Markdown or plain text is split into blocks and sentences. Code, quotes and tables are never edited.
2. **Protect.** Numbers, links, citations, quotes, inline code and emphasis are swapped for locked tokens like `[[3]]` before any rule or model sees the text.
3. **Rule pass.** Per-language pattern lists fix what can be fixed deterministically ("in order to" → "to", chatbot closers) and flag the rest. It runs instantly.
4. **Chunk.** Paragraph-aware chunks of about 450 tokens. Each carries the last two sentences of the previous chunk as read-only context.
5. **Rewrite.** The model sees the passage with flagged sentences tagged `<S1>…</S1>` and returns only `S1: …` lines. The pipeline splices them back by ID, so sentences that weren't flagged can't change.
6. **Validate each sentence.** Every locked token present exactly once, no new digits or names, length within 0.5–1.8× of the original, and the same script and language. A failed chunk is retried once with the reasons; anything that still fails keeps the original, with a note in the margin.
7. **Audit.** The rule list runs again over every rewrite. Deterministic leftovers are fixed in place; rewrites that still read stiff go back to the model once, and a failed audit keeps the first rewrite.
8. **Spelling (optional).** English documents can be converted to US or UK spelling with a word list, before and after the rewrite.

**Voice matching.** Choose "Like my writing sample" and paste 300 to 1,000 words of your own writing. Plainhand measures sentence length, contractions, person, punctuation habits and word length, and sends that description plus about 120 words of excerpts with each passage. The whole sample would not fit in a small on-device model's context.

Each finished chunk is saved to IndexedDB. Reloading mid-job offers to resume, and a Web Lock stops two tabs from running the same job.

## Engines

| Engine | Where the text goes | Notes |
| --- | --- | --- |
| On this device | Nowhere | WebLLM on WebGPU. Qwen 2.5 1.5B (880 MB) or 0.5B (290 MB), both Apache 2.0, or Llama 3.2 3B (1.8 GB, Llama 3.2 Community License, eight languages). Downloaded once and cached by the browser |
| Your API key | Straight to the provider | OpenAI, Anthropic, Gemini, OpenRouter, Groq, Mistral, or a local Ollama / LM Studio server on `localhost`. Keys stay in this browser: in localStorage, optionally encrypted with a passphrase (PBKDF2 + AES-GCM) |

WebGPU ships by default in Chrome and Edge, Safari 26+, and Firefox on Windows and macOS. Firefox on Linux doesn't have it yet; those users get the API-key path.

## Pages

The build writes the editor at `/`, a landing page per language at `/de/`, `/es/`, `/fr/` and `/pt/` (localized title, description, intro, placeholder and sample, with hreflang links), `/privacy.html`, and `sitemap.xml`. Set `SITE_URL` if the site moves off `https://yatovoid.github.io/plainhand`.

## Commands

```sh
npm install
npm run dev        # local dev server
npm test           # unit tests (vitest)
npm run check      # svelte-check + type-check, fails on warnings
npm run build      # production build in dist/; set BASE_PATH=/repo-name/ for GitHub Pages
```

Browser tests run against a production build and a stub OpenAI-compatible server:

```sh
BASE_PATH=/plainhand/ npm run build
npx vite preview --base /plainhand/ --port 4173 &
node scripts/mock-llm.mjs 8787 &          # fast stub
node scripts/mock-llm.mjs 8788 700 &      # slow stub for the resume test
node tests/e2e/flow.mjs   http://localhost:4173/plainhand/ /path/to/chromium
node tests/e2e/resume.mjs http://localhost:4173/plainhand/ /path/to/chromium
node tests/e2e/long.mjs   http://localhost:4173/plainhand/ /path/to/chromium
node tests/e2e/phase2.mjs http://localhost:4173/plainhand/ /path/to/chromium
```

## Security

- The production build ships a Content Security Policy as a `<meta>` tag. GitHub Pages can't send headers, so `frame-ancestors` isn't enforced there. Move to real headers when hosting changes.
- No third-party scripts, fonts or analytics load on the page. Any script on this origin could read saved API keys, so keep it that way.
- Custom model servers are limited to `localhost` and `127.0.0.1` by both the CSP and the URL check.
- Diff output is rendered as text nodes, never as HTML.

## Known gaps

- **On-device mode hasn't been run on real hardware yet.** Headless Chromium has no WebGPU, so the browser tests cover the API path with a stub. Test on an Intel iGPU laptop, an M-series Mac and an Android phone before launch.
- **Rule lists and landing-page copy for German, Spanish, French and Portuguese are starter versions.** They need review by native speakers.
- Landing pages localize their intro and sample; the rest of the interface is English.
- Not built yet: the AI-likelihood checker, comparison pages, email capture, and the hosted Fast mode.
- Rewrites appear one passage at a time, not word by word.

## License

Code is MIT. The rule lists in `src/engines/rules/lang/` draw on Wikipedia's [Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing) and are CC BY-SA 4.0. See `LICENSE`.

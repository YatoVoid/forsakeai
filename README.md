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

**Small models get one sentence at a time.** On-device models and local servers (Qwen 2.5 1.5B and smaller) can't follow the tagged passage format; in testing, a 1.5B model rewrote 0 of 7 sentences that way. They get a one-sentence prompt with only the previous sentence as context, because given the following sentence too they often rewrote that one instead. Each sentence gets up to three tries. Every answer that passes validation is kept, and the one with the fewest leftover stock phrases wins, then the one closest in meaning. Replies are capped at about twice the sentence's length in tokens.

**Meaning check.** Word overlap can't tell a paraphrase from a different claim, so small-model rewrites are also compared with the original using a multilingual sentence embedding ([paraphrase-multilingual-MiniLM-L12-v2](https://huggingface.co/sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2), Apache 2.0, 118 MB int8, run in a worker on WASM). A rewrite under 0.62 cosine similarity, or closer to a neighbouring sentence than to its own, is rejected. If the model can't download, the word-overlap check runs instead. Stock words the rules flagged don't count toward the overlap, since removing them is the point. On the test essay, this took a 1.5B model from 6 of 13 stiff sentences rewritten to 11 of 13 (`scripts/eval-rewrite.ts`). It catches rewrites that change the subject; it doesn't catch small invented details.

**Voice matching.** Choose "Like my writing sample" and paste 300 to 1,000 words of your own writing. Plainhand measures sentence length, contractions, person, punctuation habits and word length, and sends that description plus about 120 words of excerpts with each passage. The whole sample would not fit in a small on-device model's context.

Each finished chunk is saved to IndexedDB. Reloading mid-job offers to resume, and a Web Lock stops two tabs from running the same job.

## Engines

| Engine | Where the text goes | Notes |
| --- | --- | --- |
| On this device | Nowhere | WebLLM on WebGPU. Qwen 2.5 1.5B (880 MB) or 0.5B (290 MB), both Apache 2.0, or Llama 3.2 3B (1.8 GB, Llama 3.2 Community License, eight languages). Downloaded once and cached by the browser |
| Your API key | Straight to the provider | OpenAI, Anthropic, Gemini, OpenRouter, Groq, Mistral, or a local Ollama / LM Studio server on `localhost`. Keys stay in this browser: in localStorage, optionally encrypted with a passphrase (PBKDF2 + AES-GCM) |

WebGPU ships by default in Chrome and Edge, Safari 26+, and Firefox on Windows and macOS. Firefox on Linux doesn't have it yet; those users get the API-key path.

## Design

White page, near-black ink, one ultramarine accent, Schibsted Grotesk throughout, Lucide icons, 3px corners, hairlines instead of shadows. The right column is a copy editor's style sheet: every rule hit as an entry with a paragraph locator, why it reads stiff, and what it became. Changes are marked by line form so they read without colour: struck through (removed), double underline (added), wavy underline (still stiff). The only image is a public-domain scan of rule 13 from Strunk's *The Elements of Style* (1918).

## Checker (behind a flag)

Add `?checker` to the URL to see the **Check it** button. It estimates how likely a text is to be AI-generated with [Binoculars](https://arxiv.org/abs/2401.12070), using Qwen2.5-0.5B as observer and Qwen2.5-0.5B-Instruct as performer, run in a worker through Transformers.js. WebGPU uses the 4-bit builds (about 970 MB). Without WebGPU it falls back to the int8 builds over WASM (about 1 GB, slower), so it also works in browsers that can't run the rewriter.

Results show as a range ("Likely human-written · 12–24% AI-likelihood"), a confidence level and the three sentences that read most machine-like, each with **Rewrite this one**. The range comes from a logistic fit per language and model build, widened for short texts. Languages without calibration data are labelled "not tested" with low confidence.

Calibration and the benchmark are reproducible:

```sh
node scripts/detector-score.mjs sample.jsonl int8 384 > scores-int8.jsonl     # Node, CPU
node scripts/detector-calibrate.mjs wasm=scores-int8.jsonl webgpu=scores-q4f16.jsonl
```

`detector-calibrate.mjs` writes `src/detector/calibration.json` and `docs/detector-benchmark.md`. The plan's gate (lower false-positive rate than ZeroGPT) hasn't been checked; the flag stays until it is. Measured so far: English AUC 0.83–0.87 depending on the build, about 5–16% of human texts flagged at the strictest usable cutoff, German and Russian no better than chance. A 1.5B model pair improved English only slightly (AUC 0.85). The int8 and 4-bit builds score on different scales, so each has its own calibration.

`tests/e2e/essay.mjs` runs a real essay through the app against `scripts/local-llm-server.mjs`, an OpenAI-compatible server that runs Qwen2.5-1.5B-Instruct (4-bit; the int8 ONNX build produces nonsense) on the CPU.

ONNX Runtime's WASM files ship with the site under `/ort/` because the CSP blocks CDN and `blob:` scripts.

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
node tests/e2e/firstrun.mjs http://localhost:4173/plainhand/ /path/to/chromium
node tests/e2e/essay.mjs essay.md out/ http://127.0.0.1:8790/v1 Qwen2.5-1.5B-Instruct   # needs scripts/local-llm-server.mjs
```

The rewrite pipeline also runs headless in Node against any OpenAI-compatible server, printing what happened to each stiff sentence:

```sh
node scripts/local-llm-server.mjs 8790 onnx-community/Qwen2.5-1.5B-Instruct q4f16 &
node --import ./scripts/ts-register.mjs scripts/eval-rewrite.ts essay.md http://127.0.0.1:8790/v1 Qwen2.5-1.5B-Instruct out.json
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

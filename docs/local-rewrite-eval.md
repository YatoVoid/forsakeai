# On-device rewrite evaluation

How the on-device model, the rewrite format and the prompt were chosen. Measured 2026-10-17 on an RTX 3050 6 GB laptop GPU (no shader-f16, so the q4f32 builds), Chromium 153 with WebGPU over Vulkan.

## Yardstick

A user's third-party detector rated a 370-word AI text at 77.5% before and after on-device rewrites with Qwen 2.5 1.5B and Llama 3.2 3B, and 45% after Gemini Flash rewrote two sentences. The Binoculars checker this repo shipped at the time rated the same text as human, so it couldn’t serve as a stand-in. The app now uses desklib for its AI check.

[desklib/ai-text-detector-v1.01](https://huggingface.co/desklib/ai-text-detector-v1.01) (MIT, DeBERTa-v3-large) separates human from AI text well on a 24-text sample from the COLING 2025 MGT data: human texts scored a raw logit of -6 to +2.7, AI texts +3.7 to +12. Its probabilities saturate at 1.0 for every AI text, so the raw logit is the metric. Lower is more human; below 0 reads as human. Each run is also checked for meaning (embedding similarity per paragraph) and readability (words per sentence, share of sentences under five words), because one prompt fooled the detector with telegraphic fragments.

Test set: the 370-word Overwatch text, a 600-word remote-work essay, a GPT-4 Wikipedia-style article and a GPT-3.5 argument essay. Originals average logit 10.79.

## Results

| Setup | Mean logit | Meaning | Words/sentence | Time for the set |
| --- | --- | --- | --- | --- |
| Originals | 10.79 | | 20 to 26 | |
| Qwen 2.5 1.5B, sentence at a time (previous default), Overwatch text only | 6.72 (original 8.07; Qwen3 4B paragraph: 0.9 to 1.6) | | | 38 s |
| Qwen3 4B, sentence at a time | 7.50 | 0.90 | | 338 s |
| Llama 3.2 3B, paragraph | 10.45 | | | |
| Phi 3.5 mini, paragraph | 7.98 | 0.76 | 14.0 | |
| Qwen3.5 4B, paragraph | 8.84 | | | |
| Qwen3 1.7B, paragraph, blog prompt | 8.2 to 8.4 | 0.84 to 0.91 | 15.6 | 97 s |
| Qwen3 4B, paragraph, "friend" prompt | 3.84 | 0.81 | 4.9 (fragments, rejected) | |
| Qwen3 4B, paragraph, blog prompt, best of 4 by desklib | 5.78 | 0.83 | 12.7 | |
| **Qwen3 4B, paragraph, app pipeline** | **5.36 to 6.24** | **0.86** | **11 to 12** | **145 to 270 s** |
| A careful rewrite by a frontier model, essay only | 7.26 on the essay (Qwen3 4B: 9.8) | | | |

Qwen 2.5 7B (5.9 GB in q4f32) loaded but failed on the first generation; it may fit GPUs with shader-f16 (5.1 GB) and is untested.

## What the numbers say

- Model size and family matter most. Qwen3 4B beats every other model that fits in 6 GB.
- Rewriting whole paragraphs beats rewriting sentences one at a time, and is faster. Sentence-level rewrites keep the draft's paragraph shape.
- Short, choppy sentences fool the detector but read badly. The shipped prompt asks for mixed sentence lengths and lands near 12 words per sentence.
- Higher temperature and a second rewrite pass did not help.
- Run-to-run noise is large: the same setup scored the GPT-4 article anywhere from -3 to 9. Differences under about one logit on this set are not meaningful.
- Generic essays stay detectable even after a careful frontier-model rewrite. The content and its structure are part of the signal.

## Reproduce

```sh
npx vite --port 5173 &                                   # serves scripts/bench/webllm.html
CHROMIUM_GPU=/path/to/full/chrome BENCH_OPTS='{"noThinking":true}' SCOPE=all \
  node --import ./scripts/ts-register.mjs scripts/eval-rewrite.ts draft.md webllm:Qwen3-4B-q4f32_1-MLC x out.json
```

`scripts/bench/browser-engine.ts` drives WebLLM in a headed Chromium (WebGPU needs a real GPU process). The desklib scoring scripts are in Python and not part of this repo.

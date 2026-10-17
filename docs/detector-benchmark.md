# Checker benchmark

Generated 2026-10-17 by `scripts/detector-calibrate.mjs`. Score noise constant: 0.692 (from 998 texts split in half). Model pair: Qwen2.5-0.5B (observer) and Qwen2.5-0.5B-Instruct (performer), Binoculars score, first 384 tokens of each text.

Data: a stratified sample of the dev split of the COLING 2025 multilingual machine-generated text task (`Jinyan1/COLING_2025_MGT_multingual`). English AI texts are limited to chat models (GPT-3.5, GPT-4, GPT-4o, Llama 3, Mixtral, Gemma, Cohere). Each language is split in half: one half fits the curve, the other half produces the numbers below.

The checker only says "likely AI-generated" below a cutoff that 2% of the fit-half human texts fall under, and "likely human-written" above one that 5% of the fit-half AI texts exceed. Everything between is "unclear". On the held-out half: "Flags human as AI" is the false-positive rate, "Catches AI" is the share of AI texts called likely AI, and "Clears human" is the share of human texts called likely human.

| Build | Language | Human texts | AI texts | AUC | Flags human as AI | Catches AI | Clears human |
| --- | --- | --- | --- | --- | --- | --- | --- |
| wasm | Arabic | 34 | 40 | 0.887 | 0.0% | 33.3% | 17.6% |
| wasm | Bulgarian | 40 | 35 | 0.898 | 0.0% | 21.4% | 73.7% |
| wasm | Chinese | 37 | 39 | 0.929 | 11.8% | 90.0% | 88.2% |
| wasm | German | 65 | 64 | 0.618 | 3.0% | 22.6% | 3.0% |
| wasm | English | 150 | 150 | 0.854 | 5.6% | 48.6% | 43.7% |
| wasm | Indonesian | 38 | 33 | 0.754 | 20.0% | 50.0% | 40.0% |
| wasm | Russian | 35 | 40 | 0.208 | 15.8% | 0.0% | 0.0% |
| wasm | Urdu | 27 | 30 | 0.856 | 7.7% | 62.5% | 38.5% |
| webgpu | German | 30 | 30 | 0.594 | 6.3% | 37.5% | 0.0% |
| webgpu | English | 60 | 60 | 0.813 | 15.6% | 67.6% | 56.3% |

The held-out halves are small (about 15–75 human texts per language), so a 0% rate means none were seen, and the true rate could still be a few percent. A language whose held-out false-positive rate is above 5% never gets a "likely AI-generated" verdict in the app.

Not measured: Spanish, French and Portuguese (no human texts in the dataset), text written by non-native English speakers, text that was AI-written and then edited by a person, and comparison against ZeroGPT or GPTZero. Languages missing from the table are shown to users as "not tested yet" with low confidence.

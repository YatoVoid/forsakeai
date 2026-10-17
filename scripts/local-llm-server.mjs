// OpenAI-compatible server that runs a real model on the CPU with Transformers.js,
// for testing the full rewrite path without WebGPU or an API key.
// Usage: node scripts/local-llm-server.mjs [port=8790] [model=onnx-community/Qwen2.5-1.5B-Instruct] [dtype=int8]
// Then use provider "Local server" with http://127.0.0.1:<port>/v1.
import { createServer } from 'node:http';
import { AutoModelForCausalLM, AutoTokenizer, TextStreamer, env } from '@huggingface/transformers';

const [port = '8790', modelId = 'onnx-community/Qwen2.5-1.5B-Instruct', dtype = 'int8'] = process.argv.slice(2);
env.cacheDir = process.env.HF_CACHE ?? `${process.env.HOME}/.cache/plainhand-models`;

const tokenizer = await AutoTokenizer.from_pretrained(modelId);
const model = await AutoModelForCausalLM.from_pretrained(modelId, { dtype, device: 'cpu' });
const name = modelId.split('/').pop();

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};

// One generation at a time; the CPU can't usefully run two.
let queue = Promise.resolve();

createServer((req, res) => {
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
  if (req.url?.endsWith('/models')) {
    res.writeHead(200, { ...cors, 'content-type': 'application/json' });
    return res.end(JSON.stringify({ data: [{ id: name }] }));
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    queue = queue.then(async () => {
      const { messages, max_tokens = 1200 } = JSON.parse(body);
      const inputs = tokenizer.apply_chat_template(messages, { add_generation_prompt: true, return_dict: true });
      res.writeHead(200, { ...cors, 'content-type': 'text/event-stream' });
      const started = Date.now();
      let out = '';
      const streamer = new TextStreamer(tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (text) => {
          out += text;
          res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`);
        },
      });
      await model.generate({ ...inputs, max_new_tokens: max_tokens, do_sample: true, temperature: 0.6, top_p: 0.9, streamer });
      res.end('data: [DONE]\n\n');
      console.log(`--- ${((Date.now() - started) / 1000).toFixed(0)} s\n${out}\n`);
    }).catch((err) => {
      console.error(err);
      if (!res.headersSent) res.writeHead(500, cors);
      res.end();
    });
  });
}).listen(Number(port), '127.0.0.1', () => console.log(`${name} on http://127.0.0.1:${port}/v1`));

// OpenAI-compatible stub for browser testing the BYOK path without a real key.
// Usage: node scripts/mock-llm.mjs [port] [delayMs]   then use provider "Local server" with http://127.0.0.1:<port>/v1
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 8787);
const delay = Number(process.argv[3] ?? 0);
const SWAPS = [
  [/plays a crucial role in/gi, 'matters for'],
  [/In today's fast-paced digital world, /g, 'These days, '],
  [/delve into the intricacies of/g, 'look closely at'],
  [/foster a seamless experience/g, 'make it smooth'],
  [/leverages/g, 'uses'],
  [/serves as a reminder of/g, 'reminds people'],
  [/pivotal/g, 'big'],
  [/unlock the full potential of/g, 'get more out of'],
  [/It's not just about fewer clicks, it's about/g, 'Fewer clicks help, but the real goal is'],
];

function rewrite(sentence) {
  let out = sentence;
  for (const [re, to] of SWAPS) out = out.replace(re, to);
  return out === sentence ? `Put simply, ${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}` : out;
}

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
};

createServer((req, res) => {
  if (req.method === 'OPTIONS') return res.writeHead(204, cors).end();
  if (req.url?.endsWith('/models')) {
    res.writeHead(200, { ...cors, 'content-type': 'application/json' });
    return res.end(JSON.stringify({ data: [{ id: 'mock-editor' }] }));
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    const { messages } = JSON.parse(body);
    const user = messages.find((m) => m.role === 'user').content;
    const single = /^Sentence to rewrite: (.*)$/m.exec(user);
    const lines = single
      ? [rewrite(single[1])]
      : [...user.matchAll(/<(S\d+)>(.*?)<\/\1>/gs)].map(([, key, text]) => `${key}: ${rewrite(text)}`);
    await new Promise((r) => setTimeout(r, delay));
    res.writeHead(200, { ...cors, 'content-type': 'text/event-stream' });
    for (const piece of lines.join('\n').match(/.{1,12}/gs) ?? []) {
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: piece } }] })}\n\n`);
      await new Promise((r) => setTimeout(r, 15));
    }
    res.end('data: [DONE]\n\n');
  });
}).listen(port, '127.0.0.1', () => console.log(`mock LLM on http://127.0.0.1:${port}/v1`));

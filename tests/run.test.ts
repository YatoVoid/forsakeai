import { describe, expect, it } from 'vitest';
import { EngineError, type CompletionRequest, type Engine } from '../src/engines/types';
import { chunkDoc } from '../src/pipeline/chunk';
import { parse, serialize } from '../src/pipeline/parse';
import { parseResponse } from '../src/pipeline/prompt';
import { rulePass } from '../src/pipeline/rulepass';
import { rewriteDoc } from '../src/pipeline/run';

const eng = () => 'eng';
const noSleep = async () => {};

function fakeEngine(reply: (req: CompletionRequest, call: number) => string | Promise<string>): Engine & { calls: number } {
  const engine = {
    kind: 'byok' as const,
    label: 'fake',
    concurrency: 1,
    calls: 0,
    async complete(req: CompletionRequest) {
      return reply(req, engine.calls++);
    },
  };
  return engine;
}

function setup(text: string) {
  const doc = parse(text, eng);
  rulePass(doc);
  return { doc, chunks: chunkDoc(doc) };
}

const opts = (signal = new AbortController().signal) => ({ register: 'keep' as const, signal, detect: eng, sleep: noSleep });

describe('parseResponse', () => {
  it('reads ID lines and tolerates light formatting', () => {
    const r = parseResponse('Here you go:\nS1: First.\n**S2**: "Second."\nS3) Third\n');
    expect(r.get('S1')).toEqual(['First.']);
    expect(r.get('S2')).toEqual(['Second.']);
    expect(r.get('S3')).toEqual(['Third']);
  });
});

describe('rewriteDoc', () => {
  it('splices rewrites by id and leaves clean sentences byte-identical', async () => {
    const text = 'The sky is blue. This plays a crucial role in 2024 planning. Cats sleep a lot.';
    const { doc, chunks } = setup(text);
    expect(chunks).toHaveLength(1);
    const engine = fakeEngine((req) => {
      expect(req.user).toContain('<S1>This plays a crucial role in [[1]] planning.</S1>');
      return 'S1: This shapes [[1]] planning.';
    });
    await rewriteDoc(doc, chunks, engine, opts());
    expect(serialize(doc)).toBe('The sky is blue. This shapes 2024 planning. Cats sleep a lot.');
  });

  it('retries once with reasons, then keeps the original on repeated failure', async () => {
    const { doc, chunks } = setup('Revenue plays a pivotal role at 40% margins.');
    const engine = fakeEngine((req, call) => {
      if (call === 1) expect(req.user).toContain('previous answer was rejected');
      return 'S1: Revenue matters at good margins.';
    });
    await rewriteDoc(doc, chunks, engine, opts());
    expect(engine.calls).toBe(2);
    const s = doc.blocks[0]!.sentences[0]!;
    expect(s.status).toBe('kept');
    expect(s.note).toMatch(/dropped a locked token/);
    expect(serialize(doc)).toBe('Revenue plays a pivotal role at 40% margins.');
  });

  it('uses a valid sentence from the retry when the first attempt failed', async () => {
    const { doc, chunks } = setup('This pivotal step costs $5. Another robust idea.');
    const engine = fakeEngine((_req, call) =>
      call === 0 ? 'S1: This step costs money.\nS2: Another solid idea.' : 'S1: This key step costs [[1]].',
    );
    await rewriteDoc(doc, chunks, engine, opts());
    expect(serialize(doc)).toBe('This key step costs $5. Another solid idea.');
  });

  it('retries transient errors and pauses on auth errors', async () => {
    const { doc, chunks } = setup('A pivotal idea.');
    let waits = 0;
    const flaky = fakeEngine((_r, call) => {
      if (call === 0) throw new EngineError('rate-limit', '429', { retryAfterMs: 10 });
      return 'S1: A good idea.';
    });
    await rewriteDoc(doc, chunks, flaky, opts(), { onWait: () => waits++ });
    expect(waits).toBe(1);
    expect(serialize(doc)).toBe('A good idea.');

    const second = setup('A pivotal idea.');
    const denied = fakeEngine(() => {
      throw new EngineError('auth', '401');
    });
    await expect(rewriteDoc(second.doc, second.chunks, denied, opts())).rejects.toMatchObject({ code: 'auth' });
  });

  it('skips chunks that are already finished (resume)', async () => {
    const paragraphs = Array.from({ length: 6 }, (_, i) =>
      `Paragraph ${'x'.repeat(i)} plays a crucial role here. ${'Filler sentence goes here. '.repeat(30)}`,
    ).join('\n\n');
    const { doc, chunks } = setup(paragraphs);
    expect(chunks.length).toBeGreaterThan(2);

    const controller = new AbortController();
    let done = 0;
    const answerAll = (req: CompletionRequest) =>
      [...req.user.matchAll(/<(S\d+)>/g)].map((m) => `${m[1]}: This paragraph matters here.`).join('\n');
    const engine = fakeEngine(answerAll);
    await expect(
      rewriteDoc(doc, chunks, engine, opts(controller.signal), {
        onChunkDone: () => {
          if (++done === 2) controller.abort();
        },
      }),
    ).rejects.toMatchObject({ code: 'aborted' });

    const resumed = fakeEngine(answerAll);
    await rewriteDoc(doc, chunks, resumed, opts());
    expect(resumed.calls).toBe(chunks.length - 2);
  });

  it('fails the chunk on unknown ids and retries', async () => {
    const { doc, chunks } = setup('A pivotal idea.');
    const engine = fakeEngine((_r, call) => (call === 0 ? 'S1: A good idea.\nS9: Extra.' : 'S1: A sound idea.'));
    await rewriteDoc(doc, chunks, engine, opts());
    expect(engine.calls).toBe(2);
    expect(serialize(doc)).toBe('A sound idea.');
  });
});

describe('chunkDoc', () => {
  it('splits an oversized paragraph between sentences and carries context', () => {
    const para = Array.from({ length: 80 }, (_, i) => `Sentence ${i} is a pivotal one.`).join(' ');
    const { chunks } = setup(para);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[1]!.context).toHaveLength(2);
  });
});

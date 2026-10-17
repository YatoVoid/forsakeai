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
    await rewriteDoc(doc, engine, opts());
    expect(serialize(doc)).toBe('The sky is blue. This shapes 2024 planning. Cats sleep a lot.');
  });

  it('retries once with reasons, then keeps the original on repeated failure', async () => {
    const { doc, chunks } = setup('Revenue plays a pivotal role at 40% margins.');
    const engine = fakeEngine((req, call) => {
      if (call === 1) expect(req.user).toContain('previous answer was rejected');
      return 'S1: Revenue matters at good margins.';
    });
    await rewriteDoc(doc, engine, opts());
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
    await rewriteDoc(doc, engine, opts());
    expect(serialize(doc)).toBe('This key step costs $5. Another solid idea.');
  });

  it('retries transient errors and pauses on auth errors', async () => {
    const { doc, chunks } = setup('A pivotal idea.');
    let waits = 0;
    const flaky = fakeEngine((_r, call) => {
      if (call === 0) throw new EngineError('rate-limit', '429', { retryAfterMs: 10 });
      return 'S1: A good idea.';
    });
    await rewriteDoc(doc, flaky, opts(), { onWait: () => waits++ });
    expect(waits).toBe(1);
    expect(serialize(doc)).toBe('A good idea.');

    const second = setup('A pivotal idea.');
    const denied = fakeEngine(() => {
      throw new EngineError('auth', '401');
    });
    await expect(rewriteDoc(second.doc, denied, opts())).rejects.toMatchObject({ code: 'auth' });
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
      [...req.user.matchAll(/<(S\d+)>(.*?)<\/S\d+>/g)].map((m) => `${m[1]}: ${m[2]!.replace('plays a crucial role', 'matters')}`).join('\n');
    const engine = fakeEngine(answerAll);
    await expect(
      rewriteDoc(doc, engine, opts(controller.signal), {
        onChunkDone: () => {
          if (++done === 2) controller.abort();
        },
      }),
    ).rejects.toMatchObject({ code: 'aborted' });

    const resumed = fakeEngine(answerAll);
    await rewriteDoc(doc, resumed, opts());
    expect(resumed.calls).toBe(chunks.length - 2);
  });

  it('fails the chunk on unknown ids and retries', async () => {
    const { doc, chunks } = setup('A pivotal idea.');
    const engine = fakeEngine((_r, call) => (call === 0 ? 'S1: A good idea.\nS9: Extra.' : 'S1: A sound idea.'));
    await rewriteDoc(doc, engine, opts());
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

describe('audit pass', () => {
  it('fixes deterministic leftovers without a model call', async () => {
    const { doc } = setup('This is a pivotal idea.');
    const engine = fakeEngine(() => 'S1: This idea matters—a lot.');
    await rewriteDoc(doc, engine, opts());
    expect(engine.calls).toBe(1);
    expect(serialize(doc)).toBe('This idea matters, a lot.');
  });

  it('sends rewrites that still read stiff back once, then stops', async () => {
    const { doc } = setup('This is a pivotal idea.');
    const engine = fakeEngine((req, call) => {
      if (call === 0) return 'S1: This idea is still pivotal.';
      expect(req.user).toContain('<S1>This idea is still pivotal.</S1>');
      expect(req.user).toContain('pivotal');
      return 'S1: This idea matters most.';
    });
    await rewriteDoc(doc, engine, opts());
    expect(engine.calls).toBe(2);
    expect(serialize(doc)).toBe('This idea matters most.');
    expect(doc.blocks[0]!.sentences[0]!.audited).toBe(true);
  });

  it('keeps the first rewrite when the audit attempt fails validation', async () => {
    const { doc } = setup('It is a pivotal idea for 2024.');
    const engine = fakeEngine((_req, call) => (call === 0 ? 'S1: It is still a pivotal idea for [[1]].' : 'S1: It matters.'));
    await rewriteDoc(doc, engine, opts());
    expect(engine.calls).toBe(3);
    expect(serialize(doc)).toBe('It is still a pivotal idea for 2024.');
  });

  it('can be turned off', async () => {
    const { doc } = setup('This is a pivotal idea.');
    const engine = fakeEngine(() => 'S1: This idea is still pivotal.');
    await rewriteDoc(doc, engine, { ...opts(), audit: false });
    expect(engine.calls).toBe(1);
  });
});

describe('voice profile in prompts', () => {
  it('adds the brief and excerpts only for the sample register', async () => {
    const { buildVoiceProfile } = await import('../src/pipeline/voice');
    const sample = Array.from({ length: 40 }, (_, i) => `I don't think we need that, honestly. We'll ship item ${i} on Friday and see.`).join(' ');
    const voice = buildVoiceProfile(sample, 'eng')!;
    expect(voice.brief).toContain('uses contractions freely');
    expect(voice.brief).toContain('writes in the first person');
    const { doc } = setup('This is a pivotal idea.');
    let seen: CompletionRequest | undefined;
    const engine = fakeEngine((req) => {
      seen = req;
      return 'S1: This idea matters.';
    });
    await rewriteDoc(doc, engine, { ...opts(), register: 'sample', voice });
    expect(seen!.system).toContain("The author's habits:");
    expect(seen!.user).toContain("Lines from the author's own writing");
  });
});

describe('targets after a partial run', () => {
  it('never sends an already rewritten sentence back, even when chunks regroup', async () => {
    const { doc } = setup('First pivotal point. Second pivotal point. Third pivotal point.');
    const [a, b, c] = doc.blocks[0]!.sentences;
    a!.status = 'rewritten';
    a!.rewrite = 'First point.';
    a!.audited = true;
    let user = '';
    const engine = fakeEngine((req) => {
      user = req.user;
      return 'S1: Second point.\nS2: Third point.';
    });
    await rewriteDoc(doc, engine, opts());
    expect(user).not.toContain('<S3>');
    expect(user).toContain('First point.');
    expect(b!.rewrite).toBe('Second point.');
    expect(c!.rewrite).toBe('Third point.');
    expect(a!.rewrite).toBe('First point.');
  });
});

describe('sentence-at-a-time mode', () => {
  const sentenceEngine = (reply: (req: CompletionRequest, call: number) => string) => {
    const e = fakeEngine(reply);
    return Object.assign(e, { granularity: 'sentence' as const });
  };

  it('asks for one sentence per request and splices each back', async () => {
    const { doc } = setup('Plain opener. This is pivotal at 40% scale. Another robust idea.');
    const asked: string[] = [];
    const engine = sentenceEngine((req) => {
      const m = /^Sentence to rewrite: (.*)$/m.exec(req.user)!;
      asked.push(m[1]!);
      expect(req.user).toContain('Previous sentence, for tone only');
      return m[1]!.includes('[[1]]') ? 'Rewritten sentence: "This matters at [[1]] scale."' : 'Another solid idea.';
    });
    await rewriteDoc(doc, engine, opts());
    expect(asked).toEqual(['This is pivotal at [[1]] scale.', 'Another robust idea.']);
    expect(serialize(doc)).toBe('Plain opener. This matters at 40% scale. Another solid idea.');
  });

  it('retries a failed sentence with the reason, then keeps the original', async () => {
    const { doc } = setup('This is pivotal at 40% scale.');
    const engine = sentenceEngine((req, call) => {
      if (call > 0) expect(req.user).toContain('previous answer was rejected');
      return 'This matters a lot.';
    });
    await rewriteDoc(doc, engine, opts());
    expect(engine.calls).toBe(3);
    expect(doc.blocks[0]!.sentences[0]!.status).toBe('kept');
  });

  it('asks again while a stock phrase is left, and keeps the cleanest answer', async () => {
    const { doc } = setup('This robust plan is a testament to the team.');
    const replies = ['This robust plan shows what the team can do.', 'This plan shows what the team can do.'];
    const engine = sentenceEngine((req, call) => {
      if (call === 1) expect(req.user).toContain('it still says "robust"');
      return replies[call]!;
    });
    await rewriteDoc(doc, engine, opts());
    expect(engine.calls).toBe(2);
    expect(serialize(doc)).toBe('This plan shows what the team can do.');
  });

  it('keeps a partial fix when no answer clears every stock phrase', async () => {
    const { doc } = setup('This robust plan is a testament to the team.');
    const engine = sentenceEngine(() => 'This robust plan shows what the team can do.');
    await rewriteDoc(doc, engine, opts());
    expect(engine.calls).toBe(3);
    expect(serialize(doc)).toBe('This robust plan shows what the team can do.');
  });

  it('rejects answers the meaning scorer marks as different, or closer to a neighbour', async () => {
    const { doc } = setup('Our team ships weekly. This pivotal release fixes the login bug. Support hours stay the same.');
    const replies = ['Support hours do not change.', 'Lunch is at noon.', 'This release fixes the login bug.'];
    const engine = sentenceEngine((_req, call) => replies[call]!);
    const meaning = {
      similarity: async (text: string, others: string[]) =>
        others.map((o) => (text.startsWith('Support') && o.startsWith('Support') ? 0.9 : text.startsWith('Lunch') ? 0.2 : 0.8)),
    };
    await rewriteDoc(doc, engine, { ...opts(), meaning });
    expect(engine.calls).toBe(3);
    expect(serialize(doc)).toBe('Our team ships weekly. This release fixes the login bug. Support hours stay the same.');
  });

  it('caps the reply length for one sentence', async () => {
    const { doc } = setup('This is pivotal.');
    let cap: number | undefined;
    const engine = sentenceEngine((req) => ((cap = req.maxTokens), 'This matters.'));
    await rewriteDoc(doc, engine, opts());
    expect(cap).toBeGreaterThanOrEqual(96);
    expect(cap).toBeLessThan(400);
  });
});

describe('parseSentenceResponse', () => {
  it('strips labels and quotes', async () => {
    const { parseSentenceResponse } = await import('../src/pipeline/prompt');
    expect(parseSentenceResponse('\n**Rewritten sentence:** "It works."\nExplanation: ...')).toBe('It works.');
    expect(parseSentenceResponse('S1: Fine.')).toBe('Fine.');
    expect(parseSentenceResponse('   ')).toBeUndefined();
  });
});

describe('rewrite scope', () => {
  it("'all' sends every prose sentence, skips headings and the reader's own edits, and reports each one", async () => {
    const { doc } = setup('## Plain heading\n\nFirst plain sentence. Second plain sentence. Third plain sentence.');
    const third = doc.blocks[1]!.sentences[2]!;
    third.edited = true;
    third.status = 'rewritten';
    third.rewrite = 'Mine.';
    const asked: string[] = [];
    const done: string[] = [];
    const engine = Object.assign(
      fakeEngine((req) => {
        const m = /^Sentence to rewrite: (.*)$/m.exec(req.user)!;
        asked.push(m[1]!);
        return m[1]!.replace('plain', 'simple');
      }),
      { granularity: 'sentence' as const },
    );
    await rewriteDoc(doc, engine, { ...opts(), scope: 'all' }, { onSentenceDone: (id) => void done.push(id) });
    expect(asked).toEqual(['First plain sentence.', 'Second plain sentence.']);
    expect(done).toHaveLength(2);
    expect(serialize(doc)).toBe('## Plain heading\n\nFirst simple sentence. Second simple sentence. Mine.');
  });
});

describe('pausing in sentence mode', () => {
  it('keeps sentences finished before the pause, and a rerun skips them', async () => {
    const { doc } = setup('One pivotal idea. Two pivotal ideas. Three pivotal ideas.');
    const controller = new AbortController();
    const engine = Object.assign(
      fakeEngine((req) => {
        const m = /^Sentence to rewrite: (.*)$/m.exec(req.user)![1]!;
        if (m.startsWith('Two')) controller.abort();
        if (req.signal.aborted) throw new EngineError('aborted', 'Stopped');
        return m.replace('pivotal', 'big');
      }),
      { granularity: 'sentence' as const },
    );
    await expect(rewriteDoc(doc, engine, { ...opts(), signal: controller.signal })).rejects.toThrow('Stopped');
    const [one, two] = doc.blocks[0]!.sentences;
    expect(one!.rewrite).toBe('One big idea.');
    expect(two!.status).not.toBe('rewritten');

    const asked: string[] = [];
    const again = Object.assign(
      fakeEngine((req) => {
        const m = /^Sentence to rewrite: (.*)$/m.exec(req.user)![1]!;
        asked.push(m);
        return m.replace('pivotal', 'big');
      }),
      { granularity: 'sentence' as const },
    );
    await rewriteDoc(doc, again, opts());
    expect(asked).toEqual(['Two pivotal ideas.', 'Three pivotal ideas.']);
    expect(serialize(doc)).toBe('One big idea. Two big ideas. Three big ideas.');
  });
});

describe('isProse', () => {
  it('skips short title lines pasted without Markdown', async () => {
    const { isProse } = await import('../src/pipeline/run');
    const { doc } = setup('The Universal Contender: D.Va\n\nShe works on every map. Her kit is flexible.\n\nOne line that ends with a period.');
    expect(doc.blocks.filter((b) => b.kind !== 'blank').map(isProse)).toEqual([false, true, true]);
  });
});

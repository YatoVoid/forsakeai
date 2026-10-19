import { describe, expect, it } from 'vitest';
import { drifted, validateRewrite } from '../src/pipeline/validate';

const same = (lang: string) => () => lang;

describe('validateRewrite', () => {
  const original = 'This tool plays a crucial role in cutting costs by [[1]] for teams at [[2]].';

  it('accepts a faithful rewrite', () => {
    expect(validateRewrite(original, 'The tool cuts costs by [[1]] for teams at [[2]].', 'eng', same('eng'))).toEqual([]);
  });

  it('rejects a dropped token', () => {
    expect(validateRewrite(original, 'The tool cuts costs for teams at [[2]].', 'eng', same('eng'))).toContain(
      'dropped locked token [[1]]',
    );
  });

  it('rejects a repeated or invented token', () => {
    const reasons = validateRewrite(original, 'It cuts [[1]] and [[1]] at [[2]] and [[3]].', 'eng', same('eng'));
    expect(reasons).toContain('repeated locked token [[1]]');
    expect(reasons).toContain('invented token [[3]]');
  });

  it('rejects new digits outside tokens', () => {
    expect(validateRewrite(original, 'It cuts costs by [[1]] for 40 teams at [[2]].', 'eng', same('eng'))).toContain(
      'changed or added a number',
    );
  });

  it('rejects an invented name', () => {
    const reasons = validateRewrite(original, 'Microsoft says it cuts costs by [[1]] for teams at [[2]].', 'eng', same('eng'));
    expect(reasons).toEqual([]);
    const mid = validateRewrite(original, 'The tool, says Microsoft, cuts costs by [[1]] at [[2]].', 'eng', same('eng'));
    expect(mid[0]).toMatch(/added a name/);
  });

  it('skips the name check for German', () => {
    expect(validateRewrite('Das Werkzeug spart [[1]] Kosten.', 'Das Werkzeug spart der Firma [[1]] Kosten.', 'deu', same('deu'))).toEqual([]);
  });

  it('rejects rewrites that cut too much', () => {
    const long = 'We think that this new approach will make the whole onboarding process much faster for everyone.';
    expect(validateRewrite(long, 'Onboarding is faster.', 'eng', same('eng'))).toContain('cut too much');
  });

  it('allows short sentences to change length more', () => {
    expect(validateRewrite('Moreover, it works.', 'And that part works fine too.', 'eng', same('eng'))).toEqual([]);
  });

  it('rejects rewrites that grow too long', () => {
    expect(
      validateRewrite('It works well.', 'It works really quite remarkably well in nearly every single case we tried.', 'eng', same('eng')),
    ).toContain('grew too long');
  });

  it('rejects a language switch on long sentences', () => {
    const detect = (t: string) => (t.startsWith('Das') ? 'deu' : 'eng');
    expect(
      validateRewrite(
        'This approach makes the whole onboarding process much faster and simpler for everyone involved in it.',
        'Das macht den gesamten Onboarding-Prozess für alle Beteiligten deutlich schneller und einfacher.',
        'eng',
        detect,
      ),
    ).toContain('switched language');
  });

  it('rejects a switch to another script even on short sentences', () => {
    expect(validateRewrite('It works well.', '它运行良好。', 'eng', same('eng'))).toContain('switched language');
  });

  it('does not run the language detector on short sentences', () => {
    const detect = () => 'sco';
    expect(validateRewrite('Moreover, it leverages data from [[1]] to foster growth.', 'Moreover, it uses data from [[1]] to foster growth.', 'eng', detect)).toEqual([]);
  });

  it('accepts a real short English rewrite with the real detector', async () => {
    const { detectLang } = await import('../src/lib/lang');
    expect(validateRewrite('Moreover, it leverages data from [[1]] to foster growth.', 'Moreover, it uses data from [[1]] to foster growth.', 'eng', detectLang)).toEqual([]);
  });

  it('rejects empty and multi-line output', () => {
    expect(validateRewrite(original, '  ', 'eng', same('eng'))).toEqual(['empty rewrite']);
    expect(validateRewrite('One. Two.', 'One.\nTwo.', 'eng', same('eng'))).toContain('line break inside a sentence');
  });
});

describe('script detection', () => {
  it('treats kanji-heavy and kana-heavy Japanese as the same script', async () => {
    const { dominantScript } = await import('../src/lib/script');
    expect(dominantScript('東京大学研究所')).toBe(dominantScript('これはとてもいいですね'));
    expect(dominantScript('Привет мир')).toBe('Cyrillic');
  });
});

describe('meaning checks', () => {
  const eng = () => 'eng';
  it('rejects a rewrite that drops most of the content (from the real essay run)', () => {
    const original = 'Moreover, studies suggest that remote employees often report higher levels of job satisfaction, which in turn fosters greater loyalty and reduces turnover.';
    const rewrite = 'This newfound independence allows individuals to tailor their work schedules around their best productivity times, enhancing job satisfaction and reducing attrition.';
    expect(validateRewrite(original, rewrite, 'eng', eng)).toContain('changed the meaning');
  });

  it('rejects a rewrite of the neighbouring sentence', () => {
    const original = 'Additionally, many organizations are adopting hybrid models that combine flexible remote work with regular in-person interaction.';
    const neighbour = 'Looking ahead, the future of work will likely be characterized by continued experimentation and adaptation.';
    const rewrite = 'Looking forward, the future of work will likely be characterized by continued experimentation and adaptation.';
    const reasons = validateRewrite(original, rewrite, 'eng', eng, [neighbour]);
    expect(reasons.some((r) => r === 'changed the meaning' || r === 'rewrote a neighbouring sentence')).toBe(true);
  });

  it('accepts a real paraphrase that keeps the content', () => {
    const original = 'Ultimately, remote work is not just a trend; it is a testament to the resilience and adaptability of the modern workforce.';
    const rewrite = "Remote work isn't merely a trend but a reflection of how our workforce has grown more resilient and better at adapting.";
    expect(validateRewrite(original, rewrite, 'eng', eng)).toEqual([]);
  });
});

describe('stock phrasing in rewrites', () => {
  const eng = () => 'eng';
  it('rejects a rewrite that swaps in a different stock phrase', () => {
    expect(validateRewrite('Moreover, the tool helps teams.', 'Furthermore, the tool facilitates teamwork.', 'eng', eng)[0]).toMatch(/added stock phrasing/);
  });
  it('allows a rewrite that keeps a stock word the original already had', () => {
    expect(validateRewrite('This is a pivotal idea.', 'This idea is still pivotal.', 'eng', eng)).toEqual([]);
  });
});

describe('stock words and the meaning check', () => {
  it('does not count flagged stock words as meaning the rewrite must keep', () => {
    const original = "In today's rapidly evolving professional landscape, remote work has emerged as a transformative force reshaping how organizations operate.";
    const rewrite = 'Remote work now shapes how organizations run their day, far more than anyone expected.';
    const stock = ["In today's rapidly evolving professional landscape", 'has emerged as a', 'transformative'];
    expect(validateRewrite(original, rewrite, 'eng', () => 'eng')).toContain('changed the meaning');
    expect(validateRewrite(original, rewrite, 'eng', () => 'eng', [], { stock })).toEqual([]);
  });
});

describe('names joined by punctuation', () => {
  it('treats "Va" as known when the original says "D.Va"', () => {
    const original = 'D.Va stands out as the most adaptable tank across every map and game mode.';
    expect(validateRewrite(original, 'On every map and in every mode, D.Va is the most flexible tank.', 'eng', () => 'eng')).toEqual([]);
  });
});

describe('possessive names', () => {
  it('accepts "Va\'s" when the original has "D.Va’s"', () => {
    const original = 'D.Va’s hybrid kit of mitigation, burst damage and mobility makes her the best all-around tank pick.';
    expect(validateRewrite(original, "Thanks to D.Va's mix of mitigation, burst damage and mobility, she is the best all-around tank pick.", 'eng', () => 'eng')).toEqual([]);
  });
});

describe('droppedNames', () => {
  it('lists names the rewrite no longer mentions', async () => {
    const { droppedNames } = await import('../src/pipeline/validate');
    expect(droppedNames('She dives alongside Tracer, Genji, or Winston.', 'She dives with Tracer or Genji.')).toEqual(['Winston']);
    expect(droppedNames('D.Va stands out. Her Booster helps.', 'She stands out, and D.Va has a booster.')).toEqual([]);
  });
});

describe('wordDiff on heavy rewrites', () => {
  it('shows the old and new sentence whole when most words changed', async () => {
    const { wordDiff } = await import('../src/lib/diff');
    expect(wordDiff('In long-range Poke matchups, Defense Matrix absorbs incoming pressure.', 'When the fight is at range, she just eats the damage.')).toEqual([
      { op: 'delete', text: 'In long-range Poke matchups, Defense Matrix absorbs incoming pressure.' },
      { op: 'insert', text: 'When the fight is at range, she just eats the damage.' },
    ]);
    expect(wordDiff('This is pivotal for the team.', 'This is big for the team.').some((p) => p.op === 'equal')).toBe(true);
  });
});

describe('token repair and camel-case brands', () => {
  it('restores brackets a model dropped from locked tokens', async () => {
    const { repairTokens } = await import('../src/pipeline/protect');
    expect(repairTokens('The first [[1]] days are free, then [[2]] a month.', 'The first 1 days are free, then 2 a month.')).toBe('The first [[1]] days are free, then [[2]] a month.');
    expect(repairTokens('Costs [[1]].', 'Costs [[1]].')).toBe('Costs [[1]].');
  });

  it('does not read "Markable" in "reMarkable" as a new name', () => {
    const original = 'Your paper arrives by email for your Kindle, or as a download for Kobo and reMarkable.';
    expect(validateRewrite(original, 'It comes by email for Kindle, or as a download for Kobo and reMarkable.', 'eng', () => 'eng')).toEqual([]);
  });
});

describe('repeating a neighbour', () => {
  it('rejects a rewrite that copies the previous sentence before its own', () => {
    const previous = 'You simply read it to the last page, and then you are done.';
    const original = 'This intentional design fosters a healthier relationship with the news.';
    const rewrite = "You read it to the last page and then you're done. This design helps people live with the news.";
    expect(validateRewrite(original, rewrite, 'eng', () => 'eng', [previous])).toContain('repeated a neighbouring sentence');
    expect(validateRewrite(original, 'The design makes the news easier to live with. It stays calm.', 'eng', () => 'eng', [previous])).toEqual([]);
  });
});

describe('language drift', () => {
  it('catches one short French sentence inside an English paragraph', () => {
    const original = 'But I think Socrates is kind of being ironic here. He is really testing if Euthyphro actually knows what he thinks he knows.';
    const rewrite = "But I think Socrates is being ironic here. Il teste si Euthyphro vraiment sait ce qu'il croit savoir.";
    expect(validateRewrite(original, rewrite, 'eng', same('eng'))).toContain('switched language');
  });

  it('leaves English with a borrowed French phrase alone', () => {
    expect(drifted('He shrugged and said c’est la vie before he left.', 'eng')).toBe(false);
    expect(drifted('Socrates says no, because that is just one example.', 'eng')).toBe(false);
  });

  it('rejects a question turned into a statement', () => {
    expect(validateRewrite('What method does Socrates use?', 'Socrates asks what method he uses.', 'eng', same('eng'))).toContain(
      'turned a question into a statement',
    );
  });
});

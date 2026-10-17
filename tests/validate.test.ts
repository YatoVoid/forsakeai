import { describe, expect, it } from 'vitest';
import { validateRewrite } from '../src/pipeline/validate';

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

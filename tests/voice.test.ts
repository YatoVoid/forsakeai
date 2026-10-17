import { describe, expect, it } from 'vitest';
import { buildVoiceProfile, VOICE_MIN_WORDS } from '../src/pipeline/voice';

describe('buildVoiceProfile', () => {
  it('needs a minimum amount of text', () => {
    expect(buildVoiceProfile('Too short.', 'eng')).toBeNull();
  });

  it('describes formal, contraction-free writing', () => {
    const sample = Array.from(
      { length: 30 },
      () => 'The committee considered the proposal carefully; its recommendations were subsequently implemented across departments.',
    ).join(' ');
    const p = buildVoiceProfile(sample, 'eng')!;
    expect(p.brief).toContain('avoids contractions');
    expect(p.brief).toContain('uses semicolons');
    expect(p.brief).toContain('formal, latinate vocabulary');
  });

  it('keeps excerpts short and verbatim', () => {
    const sentences = Array.from({ length: 60 }, (_, i) => `Short line number ${i} here.`);
    const p = buildVoiceProfile(sentences.join(' '), 'eng')!;
    expect(p.excerpts.length).toBeGreaterThan(0);
    expect(p.excerpts.join(' ').split(/\s+/).length).toBeLessThanOrEqual(120);
    for (const e of p.excerpts) expect(sentences).toContain(e);
  });

  it('caps very long samples', () => {
    const p = buildVoiceProfile('word '.repeat(5000), 'eng')!;
    expect(p.words).toBe(1500);
    expect(VOICE_MIN_WORDS).toBe(150);
  });

  it('skips English-only checks for other languages', () => {
    const sample = Array.from({ length: 40 }, () => 'Wir haben das Projekt gestern abgeschlossen und sind zufrieden.').join(' ');
    expect(buildVoiceProfile(sample, 'deu')!.brief).not.toContain('contractions');
  });
});

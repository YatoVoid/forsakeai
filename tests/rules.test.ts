import { describe, expect, it } from 'vitest';
import { runRules } from '../src/engines/rules/run';
import { parse, serialize } from '../src/pipeline/parse';
import { rulePass } from '../src/pipeline/rulepass';

describe('runRules', () => {
  it('applies deterministic fixes and keeps capitalization', () => {
    expect(runRules('In order to win, we utilize data.', 'eng').text).toBe('To win, we use data.');
  });

  it('removes throat-clearing and capitalizes what is left', () => {
    expect(runRules("It's worth noting that the API is slow.", 'eng').text).toBe('The API is slow.');
  });

  it('deletes chatbot closers', () => {
    const r = runRules('I hope this helps!', 'eng');
    expect(r.deleted).toBe(true);
    expect(r.text).toBe('');
  });

  it('flags stock words without changing them', () => {
    const r = runRules('This pivotal update will delve into the details.', 'eng');
    expect(r.text).toBe('This pivotal update will delve into the details.');
    expect(r.flags.filter((f) => !f.fixed).map((f) => f.ruleId).sort()).toEqual(['en-delve', 'en-pivotal']);
  });

  it('replaces em dashes', () => {
    expect(runRules('The fix—finally—works.', 'eng').text).toBe("The fix (finally) works.");
  });

  it('respects word boundaries with accented letters', () => {
    expect(runRules('Le mot crucialité reste.', 'fra').flags).toHaveLength(0);
    expect(runRules('Un point crucial reste.', 'fra').flags.length).toBeGreaterThan(0);
  });

  it('applies German rules', () => {
    const r = runRules('Es ist wichtig zu beachten, dass die Daten fehlen.', 'deu');
    expect(r.text).toBe('Die Daten fehlen.');
  });

  it('applies only common rules to unsupported languages', () => {
    expect(runRules('Dit is belangrijk—echt.', 'nld').text).toBe('Dit is belangrijk, echt.');
  });
});

describe('rulePass', () => {
  it('never edits text inside URLs or code', () => {
    const doc = parse('We utilize `utilize()` at https://x.com/utilize daily.', () => 'eng');
    rulePass(doc);
    expect(serialize(doc)).toBe('We use `utilize()` at https://x.com/utilize daily.');
  });

  it('marks sentences with unfixed flags as stiff and locates the flag', () => {
    const doc = parse('This is a pivotal moment. The sky is blue.', () => 'eng');
    const summary = rulePass(doc);
    const [a, b] = doc.blocks[0]!.sentences;
    expect(a!.stiff).toBe(true);
    expect(b!.stiff).toBe(false);
    expect(summary.stiffSentences).toBe(1);
    const flag = a!.flags[0]!;
    expect(a!.text.slice(flag.start, flag.end)).toBe('pivotal');
  });

  it('removes a deleted closer from the output', () => {
    const doc = parse('Here is the plan. I hope this helps!', () => 'eng');
    rulePass(doc);
    expect(serialize(doc)).toBe('Here is the plan.');
  });
});

describe('capitalization after removals', () => {
  it('does not capitalize a word that follows a number', () => {
    const doc = parse("It's worth noting that 64% of users leave.", () => 'eng');
    rulePass(doc);
    expect(serialize(doc)).toBe('64% of users leave.');
  });
});

describe('paired em dashes', () => {
  it('turns a short aside into parentheses and a lone dash into a comma', () => {
    expect(runRules('The tool—once installed—runs on its own.', 'eng').text).toBe('The tool (once installed) runs on its own.');
    expect(runRules('It works—mostly.', 'eng').text).toBe('It works, mostly.');
  });
});

describe('"isn\'t just" constructions', () => {
  it('flags the contracted and plural forms', () => {
    for (const t of ["This isn't just about where you work, it's about how work is done.", 'Remote work is not merely a trend; it is a shift.', "They aren't just tools, they're habits.", "Remote work isn't just a thing people are trying out, it shows how strong workers are."]) {
      expect(runRules(t, 'eng').flags.some((f) => f.ruleId === 'en-isnt-just' || f.ruleId === 'en-not-merely'), t).toBe(true);
    }
  });
});

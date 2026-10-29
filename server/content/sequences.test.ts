import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Chess } from 'chess.js';
import type { PlanFile } from '../../shared/plans.js';
import { loadPlan } from '../plans/load.js';
import { loadAllRepertoires } from '../repertoire/load.js';
import { loadRepertoire } from '../repertoire/load.js';
import { applySeverity, checkSequence, extractSan, sequenceCheck, REJECT, sequenceExitCode, sequenceIssues, splitSentences, type ContentSources } from './sequences.js';

const START = new Chess().fen();
const afterE4 = (() => {
  const g = new Chess();
  g.move('e4');
  return g.fen();
})();

describe('extractSan', () => {
  it('finds moves and strips move numbers and dots', () => {
    expect(extractSan('After Nxe4 you play ...Bf5.')).toEqual(['Nxe4', 'Bf5']);
    expect(extractSan('Play 1.e4 e5 2.Nf3 Nc6 3...Bb4+')).toEqual(['e4', 'e5', 'Nf3', 'Nc6', 'Bb4+']);
  });
  it('keeps castling, captures, checks and promotion', () => {
    expect(extractSan('Castle O-O first')).toEqual(['O-O']);
    expect(extractSan('Then O-O-O and exd5 Qxd5+ e8=Q#')).toEqual(['O-O-O', 'exd5', 'Qxd5+', 'e8=Q#']);
  });
  it('ignores move numbers and plain words', () => {
    expect(extractSan('The move 3 is…')).toEqual([]);
    expect(extractSan('The bishop on c8 and the pawn on d5 are loose.')).toEqual([]);
  });
});

describe('extractSan lists and plans', () => {
  it('keeps a pawn push only in a move context', () => {
    expect(extractSan('Play e3 and Nf3.')).toEqual(['e3', 'Nf3']);
    expect(extractSan('The pawn on e5 attacks d6.')).toEqual([]);
  });
});

describe('checkSequence', () => {
  it('reads a list of plans as no line', () => {
    expect(checkSequence('Play Nf3, Nc3 and Bb5.', [START])).toEqual({ ok: true, replayed: 1 });
    expect(checkSequence('Black has ...c5 and ...e5 as breaks.', [START]).ok).toBe(true);
  });
  it('skips a move named as a plan or threat', () => {
    expect(checkSequence('Nf3 prepares Qe2 and Qe8#.', [START]).ok).toBe(true);
  });
  it('accepts a legal sequence', () => {
    expect(checkSequence('Play e4 e5 Nf3.', [START])).toEqual({ ok: true, replayed: 3 });
  });
  it('rejects an illegal sequence and reports how far it went', () => {
    expect(checkSequence('Play e4 e4.', [START])).toEqual({ ok: false, replayed: 1 });
  });
  it('accepts when a later start works', () => {
    expect(checkSequence('Then e5 Nf3', [START, afterE4]).ok).toBe(true);
    expect(checkSequence('Then e5 Nf3', [START]).ok).toBe(false);
  });
  it('treats one token as no sequence', () => {
    expect(checkSequence('Never play Qh5', [START]).ok).toBe(true);
  });
});

function sources(comment: string): ContentSources {
  const rep = loadRepertoire({ id: 'fx', name: 'Fixture', color: 'white', moves: [{ san: 'e4', comment, children: [{ san: 'e5' }] }] });
  return { repertoires: [{ file: 'fx.json', rep }], lessons: [], guides: [], plans: [] };
}

describe('sequenceIssues', () => {
  it('reports an illegal sequence in a repertoire comment as an error', () => {
    const issues = sequenceIssues(sources('Next comes Nf3 Nf3 and then Bc4.'));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ file: 'fx.json', nodeId: 'e4', rule: 'illegal-sequence' });
    expect(issues[0]!.severity ?? 'error').toBe('error');
  });
  it('gives a warning when the sentence hedges', () => {
    const issues = sequenceIssues(sources('Instead of Nf3 Nf3 play something else.'));
    expect(issues).toHaveLength(1);
    expect(issues[0]!.severity).toBe('warning');
  });
  it('follows the text across sentences', () => {
    expect(sequenceIssues(sources('Black plays e5. Then White plays Nf3 Nc6. After Bb5 play a6.'))).toEqual([]);
  });
  it('gives a warning when one unnamed move makes the line legal', () => {
    const issues = sequenceIssues(sources('Black has Nc6 Nf6 ready.'));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ rule: 'skipped-move', severity: 'warning' });
    expect(issues[0]!.detail).toContain('unnamed move');
  });
  it('accepts a legal sequence from the position after the move', () => {
    expect(sequenceIssues(sources('Black plays e5 and White answers Nf3.'))).toEqual([]);
  });
});

describe('annotations and lone squares', () => {
  it('ignores move annotations', () => {
    expect(extractSan('Play e4!? e5?! Nf3!')).toEqual(['e4', 'e5', 'Nf3']);
    expect(extractSan('Then Nc6?? or Bb5!! and Qh5?')).toEqual(['Nc6', 'Bb5', 'Qh5']);
    expect(checkSequence('Play e4!? e5?! Nf3!', [START]).ok).toBe(true);
  });
  it('does not read a lone square word as a move', () => {
    expect(extractSan('the e4 square')).toEqual([]);
    expect(extractSan('Watch the e4 square and the d5 square.')).toEqual([]);
  });
});

describe('splitSentences', () => {
  it('splits at full stops, paragraphs, semicolons and clause words', () => {
    expect(splitSentences('Play e4. Then d4.\n\nNext one; and more, so go, and stop against it.')).toEqual([
      'Play e4.', 'Then d4.', 'Next one', 'and more', 'go', 'stop', 'it.',
    ]);
  });
  it('does not split after a move annotation', () => {
    expect(splitSentences('Play Nf3! Nc6 follows.')).toEqual(['Play Nf3! Nc6 follows.']);
    expect(splitSentences('Not Qh5? Nc6 wins.')).toEqual(['Not Qh5? Nc6 wins.']);
    expect(splitSentences('Really? Yes.')).toEqual(['Really?', 'Yes.']);
  });
  it('keeps a move number with its move and splits before an ellipsis', () => {
    expect(splitSentences('Play 1. e4 e5. ...Nc6 follows.')).toEqual(['Play 1. e4 e5.', '...Nc6 follows.']);
  });
});

describe('skip rules', () => {
  it('REJECT: words that reject a move are matched', () => {
    for (const t of ['Nf3 is bad.', 'It is not possible.', 'Nf3 fails to Ng5.', 'A blunder.', 'It loses to Ng5.']) expect(REJECT.test(t)).toBe(true);
    for (const t of ['Play Nf3.', 'The knight guards e5.']) expect(REJECT.test(t)).toBe(false);
  });
  it('REJECT: a rejected line does not become a start for the next line', () => {
    // Nf3 Nc6 is legal, but it is called bad. Nxe5 Nxe5 would only be legal after it, so it is an error.
    const issues = sequenceIssues(sources('It is bad to play Nf3 Nc6. Then Nxe5 Nxe5.'));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ rule: 'illegal-sequence', severity: 'error' });
    // Without the rejection the thread goes on and the line is legal.
    expect(sequenceIssues(sources('Black plays e5. Then White plays Nf3 Nc6. Then Nxe5 Nxe5.'))).toEqual([]);
  });
  it('PLAN_WORD: moves after threatens/prepares/plans are not part of the line', () => {
    expect(extractSan('Nf3 threatens Ng5 and then plans Bc4.')).toEqual(['Nf3']);
    expect(checkSequence('Black plays Nc6 Nf3 and threatens Qh5.', [afterE4])).toEqual({ ok: true, replayed: 2 });
    expect(checkSequence('Play Nc6 Nf3 which prepares ...Qh4.', [afterE4]).replayed).toBe(2);
  });
  it('REF_WORD: "as in the ...d5 part" is a reference, not a move', () => {
    expect(checkSequence('Play Nc6 Nf3 as in the ...d5 part.', [afterE4]).ok).toBe(true);
  });
});

describe('list and side rules', () => {
  it('LIST_GAP: moves joined by comma, and, or, not are a list, not a line', () => {
    expect(checkSequence('Play Bc4, Nf3 and Qh5.', [START]).replayed).toBe(1);
    expect(checkSequence('Play Nf3, not Nc3.', [START]).replayed).toBe(1);
  });
  it('mixedSides: a black then a white move with a comma stay one line', () => {
    expect(checkSequence('After ...e5, Nf3 Nc6 follows.', [afterE4]).ok).toBe(true);
    expect(checkSequence('After ...e5, Nf3 Nc6 follows.', [afterE4]).replayed).toBe(3);
  });
  it('sameSide: two black moves with dots, or equal move numbers, are alternatives', () => {
    expect(checkSequence('Black has ...e5 ...c5 ready.', [afterE4]).ok).toBe(true);
    expect(checkSequence('Play 2.Nf3 or 2.Nc3 here.', [afterE4]).ok).toBe(true);
  });
});

describe('thread leniency does not hide errors', () => {
  it('reports a later line that is illegal from every start', () => {
    // After "Play e5." the thread stands after e4 e5. "Qh5 Rd1" is illegal there and from every other start.
    const issues = sequenceIssues(sources('Black plays e5. Qh5 Rd1 follows.'));
    const bad = issues.filter((i) => i.rule === 'illegal-sequence');
    expect(bad).toHaveLength(1);
    expect(bad[0]!.severity).toBe('error');
  });
});

describe('severity helpers', () => {
  const err = { file: 'f', nodeId: 'n', rule: 'illegal-sequence', detail: 'd' };
  const skip = { file: 'f', nodeId: 'n', rule: 'skipped-move', detail: 'd', severity: 'warning' as const };
  it('applySeverity downgrades errors unless strict and never upgrades skipped-move', () => {
    expect(applySeverity([err, skip], false).map((i) => i.severity)).toEqual(['warning', 'warning']);
    expect(applySeverity([err, skip], true).map((i) => i.severity)).toEqual([undefined, 'warning']);
  });
  it('sequenceExitCode is 1 only with an error', () => {
    expect(sequenceExitCode([skip])).toBe(0);
    expect(sequenceExitCode([err])).toBe(1);
  });
  const fixture = (): ContentSources => {
    const bad = 'Next comes Nf3 Nf3 here.';
    const rep = loadRepertoire({ id: 'fx', name: 'Fixture', color: 'white', moves: [{ san: 'e4', comment: bad, children: [{ san: 'e5' }] }] });
    const lesson = {
      id: 'blunder-check', order: 1, level: 1, title: 'L', summary: 'S', tags: [], body: 'B', links: [],
      exercises: [{ id: 'x', fen: new Chess().fen(), prompt: 'P', solution: ['e2e4'], explanation: bad }],
    } as unknown as ContentSources['lessons'][number]['lesson'];
    const guide = {
      repertoireId: 'fx', why: bad,
      variations: [{ key: 'v', name: 'V', roots: ['e4'], finalForm: { nodeId: 'e4', jobs: [] }, route: [], deviations: [], middlegame: 'M', mistakes: [] }],
    } as unknown as ContentSources['guides'][number]['guide'];
    return { repertoires: [{ file: 'rep.json', rep }], lessons: [{ file: 'les.json', lesson }], guides: [{ file: 'gui.json', guide, rep }], plans: [] };
  };
  const files = (issues: { file: string }[]) => [...new Set(issues.map((i) => i.file))].sort();
  it('sequenceCheck filters by scope', () => {
    expect(files(sequenceCheck({ lessons: true, repertoires: true }, true, fixture()))).toEqual(['gui.json', 'les.json', 'rep.json']);
    expect(files(sequenceCheck({ lessons: true, repertoires: false }, true, fixture()))).toEqual(['les.json']);
    expect(files(sequenceCheck({ lessons: false, repertoires: true }, true, fixture()))).toEqual(['gui.json', 'rep.json']);
  });
  it('sequenceCheck filters by file', () => {
    expect(files(sequenceCheck({ file: 'content/lessons/les.json' }, true, fixture()))).toEqual(['les.json']);
    expect(files(sequenceCheck({ file: 'rep.json' }, true, fixture()))).toEqual(['rep.json']);
  });
  it('sequenceCheck applies --strict', () => {
    const strict = sequenceCheck({ lessons: true, repertoires: true }, true, fixture());
    expect(strict.every((i) => i.rule === 'illegal-sequence' && i.severity === 'error')).toBe(true);
    expect(sequenceExitCode(strict)).toBe(1);
    const soft = sequenceCheck({ lessons: true, repertoires: true }, false, fixture());
    expect(soft.length).toBe(strict.length);
    expect(soft.every((i) => i.severity === 'warning')).toBe(true);
    expect(sequenceExitCode(soft)).toBe(0);
  });
  it('sequenceCheck runs on the real content without throwing', { timeout: 60000 }, () => {
    expect(() => sequenceCheck({ lessons: true, repertoires: true }, false)).not.toThrow();
  });
});

describe('sequenceIssues for plans', () => {
  const reps = loadAllRepertoires();
  const planSources = (mutate: (p: PlanFile) => void): ContentSources => {
    const plan = loadPlan(JSON.parse(readFileSync('content/plans/__test__/sample.json', 'utf8')), reps);
    mutate(plan);
    return { repertoires: [], lessons: [], guides: [], plans: [{ file: 'sample.json', plan }] };
  };
  const issuesOf = (mutate: (p: PlanFile) => void) => sequenceIssues(planSources(mutate));

  it('accepts the sample plan and a legal line in the goal', () => {
    expect(issuesOf(() => {})).toEqual([]);
    expect(issuesOf((p) => { p.goal = 'Play Re1 Bxg3 hxg3 and the h-file opens.'; })).toEqual([]);
  });

  it('reports an illegal line in the goal, a step, a mistake, a choice reason and an explanation', () => {
    const bad = 'Next comes Qe2 Qe2 here.';
    expect(issuesOf((p) => { p.goal = bad; }).map((i) => i.nodeId)).toEqual(['(goal)']);
    expect(issuesOf((p) => { p.steps[0]!.text = bad; }).map((i) => i.nodeId)).toEqual(['step:1']);
    expect(issuesOf((p) => { p.mistakes[0]!.text = bad; })).toHaveLength(1);
    expect(issuesOf((p) => { p.exercises[0]!.choices[0]!.why = bad; })[0]?.nodeId).toBe('sample/start');
    expect(issuesOf((p) => { p.exercises[1]!.explanation = bad; })[0]?.nodeId).toBe('sample/after-trade');
  });

  it('scope: plans only when asked; the file scope picks the plan by file name', () => {
    const src = planSources((p) => { p.goal = 'Next comes Qe2 Qe2 here.'; });
    expect(sequenceCheck({ lessons: true, repertoires: true }, true, src)).toEqual([]);
    expect(sequenceCheck({ lessons: false, repertoires: false, plans: true }, true, src)).toHaveLength(1);
    expect(sequenceCheck({ file: 'content/plans/sample.json' }, true, src)).toHaveLength(1);
  });
});

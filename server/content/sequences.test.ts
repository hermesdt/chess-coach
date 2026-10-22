import { describe, expect, it } from 'vitest';
import { Chess } from 'chess.js';
import { loadRepertoire } from '../repertoire/load.js';
import { checkSequence, extractSan, sequenceIssues, type ContentSources } from './sequences.js';

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
  return { repertoires: [{ file: 'fx.json', rep }], lessons: [], guides: [] };
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
    expect(issues[0]).toMatchObject({ severity: 'warning' });
    expect(issues[0]!.detail).toContain('unnamed move');
  });
  it('accepts a legal sequence from the position after the move', () => {
    expect(sequenceIssues(sources('Black plays e5 and White answers Nf3.'))).toEqual([]);
  });
});

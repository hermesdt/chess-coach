import { Chess } from 'chess.js';
import { describe, expect, it } from 'vitest';
import type { MoveInfo } from '../../../shared/types';
import { addLine, addMove, playLine, branchPoint, createTree, describeNode, fenOf, next, pathFromMain, prev } from './variations';

function movesFrom(sans: string[]): { start: string; moves: MoveInfo[] } {
  const chess = new Chess();
  const start = chess.fen();
  const moves = sans.map((s, i) => {
    const fenBefore = chess.fen();
    const m = chess.move(s);
    return { ply: i + 1, san: m.san, uci: m.from + m.to + (m.promotion ?? ''), fenBefore, fenAfter: chess.fen() };
  });
  return { start, moves };
}

const { start, moves } = movesFrom(['e4', 'e5', 'Nf3']);

describe('variations', () => {
  it('builds the main line with ids m<ply>', () => {
    const tree = createTree(start, moves);
    expect(tree.nodes.m1).toMatchObject({ id: 'm1', parent: null, san: 'e4', uci: 'e2e4', mainline: true, children: ['m2'] });
    expect(tree.nodes.m3).toMatchObject({ parent: 'm2', san: 'Nf3', children: [] });
    expect(fenOf(tree, 'root')).toBe(start);
    expect(fenOf(tree, 'm3')).toBe(moves[2].fenAfter);
  });

  it('returns the main node when the move is the next main-line move', () => {
    const tree = createTree(start, moves);
    const res = addMove(tree, 'm1', 'e7e5');
    expect(res?.node).toBe('m2');
    expect(res?.tree).toBe(tree);
  });

  it('creates a branch child for another move and reuses it the second time', () => {
    const tree = createTree(start, moves);
    const res = addMove(tree, 'm1', 'c7c5');
    expect(res).not.toBeNull();
    const node = res!.tree.nodes[res!.node];
    expect(node).toMatchObject({ san: 'c5', uci: 'c7c5', mainline: false, parent: 'm1' });
    expect(res!.tree.nodes.m1.children).toEqual(['m2', res!.node]);
    expect(addMove(res!.tree, 'm1', 'c7c5')?.node).toBe(res!.node);
    // the original tree is not mutated
    expect(tree.nodes.m1.children).toEqual(['m2']);
  });

  it('adds a move from the root', () => {
    const tree = createTree(start, moves);
    expect(addMove(tree, 'root', 'e2e4')?.node).toBe('m1');
    expect(addMove(tree, 'root', 'd2d4')?.tree.nodes).toBeDefined();
  });

  it('rejects illegal moves', () => {
    const tree = createTree(start, moves);
    expect(addMove(tree, 'm1', 'e2e4')).toBeNull();
    expect(addMove(tree, 'm1', 'zz')).toBeNull();
    expect(addMove(tree, 'nope', 'e2e4')).toBeNull();
  });

  it('adds a labelled line', () => {
    const tree = createTree(start, moves);
    const res = addLine(tree, 'm1', ['c7c5', 'g1f3', 'd7d6'], 'Line 1');
    const first = res.tree.nodes[res.tree.nodes.m1.children[1]];
    expect(first.label).toBe('Line 1');
    expect(res.tree.nodes[res.last]).toMatchObject({ san: 'd6', mainline: false });
    expect(res.tree.nodes[res.last].label).toBeUndefined();
  });

  it('computes pathFromMain for a branch two moves deep from ply 18', () => {
    const long = movesFrom(['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6', 'Ba4', 'Nf6', 'O-O', 'Be7', 'Re1', 'b5', 'Bb3', 'd6', 'c3', 'O-O', 'h3', 'Nb8']);
    const tree = createTree(long.start, long.moves);
    const a = addMove(tree, 'm18', 'd2d4')!;
    const b = addMove(a.tree, a.node, 'c8b7')!;
    expect(pathFromMain(b.tree, b.node)).toEqual({ ply: 18, path: ['d2d4', 'c8b7'] });
    expect(pathFromMain(b.tree, 'm5')).toEqual({ ply: 5, path: [] });
    expect(pathFromMain(b.tree, 'root')).toEqual({ ply: 0, path: [] });
  });

  it('branchPoint is the main node where a branch starts', () => {
    const tree = createTree(start, moves);
    const a = addMove(tree, 'm1', 'c7c5')!;
    const b = addMove(a.tree, a.node, 'g1f3')!;
    expect(branchPoint(b.tree, b.node)).toBe('m1');
    expect(branchPoint(b.tree, 'm2')).toBeNull();
    expect(branchPoint(b.tree, 'root')).toBeNull();
  });

  it('next and prev follow the current line', () => {
    const tree = createTree(start, moves);
    const a = addMove(tree, 'm1', 'c7c5')!;
    const b = addMove(a.tree, a.node, 'g1f3')!;
    expect(next(b.tree, 'root')).toBe('m1');
    expect(next(b.tree, 'm1')).toBe('m2');
    expect(next(b.tree, 'm3')).toBeNull();
    expect(next(b.tree, a.node)).toBe(b.node);
    expect(next(b.tree, b.node)).toBeNull();
    const tail = addMove(tree, 'm3', 'b8c6')!;
    expect(next(tail.tree, 'm3')).toBeNull();
    expect(prev(b.tree, b.node)).toBe(a.node);
    expect(prev(b.tree, a.node)).toBe('m1');
    expect(prev(b.tree, 'm1')).toBe('root');
    expect(prev(b.tree, 'root')).toBeNull();
  });

  it('describes nodes with the server wording', () => {
    const tree = createTree(start, moves);
    expect(describeNode(tree, 'root', 'white')).toBe('the start position');
    expect(describeNode(tree, 'm2', 'white')).toBe('the position after 1...e5 (your move 2)');
    expect(describeNode(tree, 'm3', 'white')).toBe('the position after 2. Nf3 (their move 2)');
    expect(describeNode(tree, 'm2', 'black')).toBe('the position after 1...e5 (their move 2)');
    const { tree: t2, last } = addLine(tree, 'm2', ['b1c3', 'g8f6'], 'x');
    expect(describeNode(t2, last, 'white')).toBe('a side line: 2. Nc3 Nf6 (after 1...e5)');
    const { tree: t3, last: l3 } = addLine(tree, 'm1', ['c7c5'], 'x');
    expect(describeNode(t3, l3, 'white')).toBe('a side line: 1...c5 (after 1. e4)');
  });
});

describe('playLine', () => {
  it('plays a line that starts at the anchor', () => {
    const tree = createTree(start, moves);
    const res = playLine(tree, 'm1', { startFen: moves[0].fenAfter, uci: ['c7c5', 'g1f3'] }, 'Line 1');
    expect(res.tree.nodes[res.first as string]).toMatchObject({ uci: 'c7c5', label: 'Line 1' });
    expect(res.tree.nodes[res.last as string]).toMatchObject({ san: 'Nf3' });
  });

  it('plays a REF line that starts after the played move', () => {
    const tree = createTree(start, moves);
    // anchor m1; the played move is m2 (e5); the REF line starts after it
    const res = playLine(tree, 'm1', { startFen: moves[1].fenAfter, uci: ['g1f3', 'b8c6'] }, 'Line 2');
    expect(res.tree.nodes[res.first as string]).toMatchObject({ san: 'Nf3', parent: 'm2' });
    expect(res.tree.nodes[res.last as string]).toMatchObject({ san: 'Nc6' });
  });

  it('throws when the line does not fit the position', () => {
    const tree = createTree(start, moves);
    expect(() => playLine(tree, 'm1', { startFen: moves[2].fenAfter, uci: ['b8c6'] }, 'x')).toThrow();
  });
});

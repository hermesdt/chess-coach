import { describe, expect, it } from 'vitest';
import type { RepNodeDTO } from '../../../shared/types';
import { nextDrillStep, nodeAtPath } from './line-drill';

function node(path: string[], children: RepNodeDTO[] = [], locked = false): RepNodeDTO {
  return {
    id: path.join(' '), san: path[path.length - 1]!, uci: '', comment: null, tags: [], level: 1,
    ply: path.length, mover: path.length % 2 === 1 ? 'white' : 'black', fenAfter: '', locked, children,
  };
}

// 1.e4 c6 2.d4 d5, plus 1...e5 (not a repertoire move for the user as Black? it is a sibling at a user node, ignored)
const tree = [
  node(['e4'], [
    node(['e4', 'c6'], [
      node(['e4', 'c6', 'd4'], [
        node(['e4', 'c6', 'd4', 'd5'], [node(['e4', 'c6', 'd4', 'd5', 'Nc3'])]),
      ]),
      node(['e4', 'c6', 'Nc3'], [], true),
    ]),
  ]),
];

describe('nextDrillStep', () => {
  it('asks the user at the start when the user is white', () => {
    expect(nextDrillStep(tree, [], 'white')).toEqual({ kind: 'user', expectedSan: 'e4' });
  });

  it('lets the opponent move when the user is black', () => {
    expect(nextDrillStep(tree, [], 'black')).toEqual({ kind: 'opponent', san: 'e4' });
  });

  it('asks the user for the single repertoire child', () => {
    expect(nextDrillStep(tree, ['e4'], 'black')).toEqual({ kind: 'user', expectedSan: 'c6' });
  });

  it('picks only unlocked opponent children', () => {
    for (let i = 0; i < 20; i++) {
      expect(nextDrillStep(tree, ['e4', 'c6'], 'black', () => 0.99)).toEqual({ kind: 'opponent', san: 'd4' });
    }
  });

  it('picks a child with the random function', () => {
    const two = [node(['d4']), node(['c4'])];
    expect(nextDrillStep(two, [], 'black', () => 0)).toEqual({ kind: 'opponent', san: 'd4' });
    expect(nextDrillStep(two, [], 'black', () => 0.6)).toEqual({ kind: 'opponent', san: 'c4' });
  });

  it('is done at a leaf', () => {
    expect(nextDrillStep(tree, ['e4', 'c6', 'd4', 'd5', 'Nc3'], 'black')).toEqual({ kind: 'done' });
  });

  it('is done when only locked children remain', () => {
    expect(nextDrillStep(tree, ['e4', 'c6', 'Nc3'], 'white')).toEqual({ kind: 'done' });
  });
});

describe('nodeAtPath', () => {
  it('finds nodes and returns null for unknown paths', () => {
    expect(nodeAtPath(tree, ['e4', 'c6'])?.id).toBe('e4 c6');
    expect(nodeAtPath(tree, [])).toBeNull();
    expect(nodeAtPath(tree, ['d4'])).toBeNull();
  });
});

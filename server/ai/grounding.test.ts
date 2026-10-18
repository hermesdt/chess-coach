import { expect, it } from 'vitest';
import { findUngroundedMoves, groundingSet } from './grounding.js';

it('flags moves that are not in the facts', () => {
  expect(findUngroundedMoves('Play Nf3 then e4', new Set(['Nf3']))).toEqual(['e4']);
});

it('ignores + and # when comparing', () => {
  expect(findUngroundedMoves('Qh5+ and Qxf7#', new Set(['Qh5', 'Qxf7+']))).toEqual([]);
  expect(findUngroundedMoves('Qh5', new Set(['Qh5+']))).toEqual([]);
});

it('accepts castling as O-O, 0-0 and 0-0-0', () => {
  const allowed = new Set(['O-O', 'O-O-O']);
  expect(findUngroundedMoves('Castle with O-O or 0-0, or even 0-0-0.', allowed)).toEqual([]);
  expect(findUngroundedMoves('You should castle with 0-0', new Set(['Nf3']))).toEqual(['O-O']);
});

it('matches pawn captures and promotions', () => {
  expect(findUngroundedMoves('exd5 was fine, exd8=Q too', new Set(['exd5', 'exd8=Q+']))).toEqual([]);
  expect(findUngroundedMoves('exd5', new Set(['dxe5']))).toEqual(['exd5']);
});

it('returns each ungrounded move once', () => {
  expect(findUngroundedMoves('e4, e4 and Bb5', new Set())).toEqual(['e4', 'Bb5']);
});

it('ignores plain words and numbers', () => {
  expect(findUngroundedMoves('You lost 3 points in move 12. Good luck, Bob.', new Set())).toEqual([]);
});

it('groundingSet adds destination squares and squares named in the facts text', () => {
  const allowed = groundingSet(['Nf3', 'exd5', 'O-O', 'e8=Q+'], 'The pawn on c4 was loose.');
  expect(findUngroundedMoves('the f3 square, the d5 pawn, the e8 square, the c4 pawn', allowed)).toEqual([]);
  expect(findUngroundedMoves('the e4 pawn', allowed)).toEqual(['e4']);
});

it('does not let markdown emphasis hide a move', () => {
  expect(findUngroundedMoves('Try _Nf3_ now', new Set())).toEqual(['Nf3']);
  expect(findUngroundedMoves('Try **Nf3** now', new Set())).toEqual(['Nf3']);
  expect(findUngroundedMoves('Try `Nf3` now', new Set())).toEqual(['Nf3']);
  expect(findUngroundedMoves('Try _Nf3_ now', new Set(['Nf3']))).toEqual([]);
});

it('splits glued moves', () => {
  expect(findUngroundedMoves('Be4Nf3', new Set(['Be4']))).toEqual(['Nf3']);
  expect(findUngroundedMoves('Nf3Nc6', new Set(['Nf3']))).toEqual(['Nc6']);
  expect(findUngroundedMoves('Nf3Nc6', new Set(['Nf3', 'Nc6']))).toEqual([]);
  expect(findUngroundedMoves('e4e5', new Set(['e4']))).toEqual(['e5']);
});

it('does not read moves out of the middle of words', () => {
  expect(findUngroundedMoves('Fred1 and abe4', new Set())).toEqual([]);
});

it('treats a square after a move verb as a move', () => {
  const nxe4 = groundingSet(['Nxe4']);
  expect(findUngroundedMoves('You should play e4', nxe4)).toEqual(['e4']);
  expect(findUngroundedMoves('Then look at the e4 pawn', nxe4)).toEqual([]);
  expect(findUngroundedMoves('the e4 square', nxe4)).toEqual([]);
  expect(findUngroundedMoves('Reply e4 here', nxe4)).toEqual(['e4']);
  expect(findUngroundedMoves('play e4', groundingSet(['e4']))).toEqual([]);
  expect(findUngroundedMoves('capture on e4', groundingSet(['dxe4']))).toEqual([]);
  expect(findUngroundedMoves('go e4', groundingSet(['Nxe4', 'Nf3']))).toEqual(['e4']);
  expect(findUngroundedMoves('The e4 pawn. Play Nxe4', groundingSet(['Nxe4']))).toEqual([]);
});

it('compares the promotion piece', () => {
  expect(findUngroundedMoves('exd8=N', new Set(['exd8=Q+']))).toEqual(['exd8=N']);
  expect(findUngroundedMoves('exd8=Q', new Set(['exd8=Q+']))).toEqual([]);
  expect(findUngroundedMoves('exd8', new Set(['exd8=Q+']))).toEqual([]);
});

it('accepts dash variants in castling', () => {
  expect(findUngroundedMoves('Castle O–O now, or 0–0–0', new Set(['O-O', 'O-O-O']))).toEqual([]);
  expect(findUngroundedMoves('Castle O–O', new Set())).toEqual(['O-O']);
});

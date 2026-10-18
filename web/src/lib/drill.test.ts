import { describe, expect, it } from 'vitest';
import type { Card } from '../../../shared/types';
import { bestSan, checkAnswer, moveToUci } from './drill';

const card: Card = {
  id: 1,
  kind: 'mistake',
  positionKey: 'k',
  fen: '7k/4P3/8/8/8/8/8/4K3 w - - 0 1',
  sideToMove: 'white',
  prompt: 'White to move.',
  solution: { accepted: ['e7e8q', 'e1d1'], best: 'e7e8q', explanation: null },
  refs: [],
  suspended: false,
  createdAt: 0,
};

describe('checkAnswer', () => {
  it('accepts a listed move and defaults to good', () => {
    expect(checkAnswer(card, 'e1d1')).toEqual({ correct: true, defaultRating: 'good' });
  });
  it('rejects an unlisted move and defaults to again', () => {
    expect(checkAnswer(card, 'e1f1')).toEqual({ correct: false, defaultRating: 'again' });
  });
  it('compares promotion pieces case-insensitively but exactly', () => {
    expect(checkAnswer(card, 'E7E8Q').correct).toBe(true);
    expect(checkAnswer(card, 'e7e8n').correct).toBe(false);
    expect(checkAnswer(card, 'e7e8').correct).toBe(false);
  });
});

describe('bestSan', () => {
  it('converts the best UCI move to SAN', () => {
    expect(bestSan(card)).toBe('e8=Q+');
  });
  it('falls back to the UCI string for an illegal move', () => {
    expect(bestSan({ ...card, solution: { ...card.solution, best: 'a1a8' } })).toBe('a1a8');
  });
});

describe('moveToUci', () => {
  it('returns null for an illegal move', () => {
    expect(moveToUci(card.fen, 'e1', 'e5')).toBeNull();
  });
  it('returns UCI for a legal move', () => {
    expect(moveToUci(card.fen, 'e1', 'd1')).toBe('e1d1');
  });
  it('auto-queens a promotion when no piece is given', () => {
    expect(moveToUci(card.fen, 'e7', 'e8')).toBe('e7e8q');
    expect(moveToUci(card.fen, 'e7', 'e8', 'n')).toBe('e7e8n');
  });
});

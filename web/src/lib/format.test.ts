import { describe, expect, it } from 'vitest';
import { formatDate, opponentLabel } from './format';

describe('formatDate', () => {
  it('formats a ms epoch as a UTC date', () => {
    expect(formatDate(Date.UTC(2024, 2, 5, 23, 59))).toBe('2024-03-05');
  });
});

describe('opponentLabel', () => {
  const g = { white: 'Ann', black: 'Bob', whiteElo: 1500, blackElo: null };
  it('shows the opponent of the user', () => {
    expect(opponentLabel({ ...g, userColor: 'white' })).toBe('Bob');
    expect(opponentLabel({ ...g, userColor: 'black' })).toBe('Ann (1500)');
  });
  it('shows both players when the user colour is unknown', () => {
    expect(opponentLabel({ ...g, userColor: null })).toBe('Ann (1500) vs Bob');
  });
});

import { Chess } from 'chess.js';
import type { Card, Rating } from '../../../shared/types';

export function checkAnswer(card: Card, uci: string): { correct: boolean; defaultRating: Rating } {
  const correct = card.solution.accepted.includes(uci.toLowerCase());
  return { correct, defaultRating: correct ? 'good' : 'again' };
}

/** Best move of a card in SAN. Falls back to the UCI string when the move is not legal. */
export function bestSan(card: Card): string {
  const uci = card.solution.best;
  try {
    return new Chess(card.fen).move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.slice(4) || undefined,
    }).san;
  } catch {
    return uci;
  }
}

/** True when moving from `from` to `to` is a pawn promotion in this position. */
export function isPromotion(fen: string, from: string, to: string): boolean {
  return new Chess(fen).moves({ verbose: true }).some((m) => m.from === from && m.to === to && !!m.promotion);
}

/** UCI string of a legal move, or null when the move is illegal. Promotions default to a queen. */
export function moveToUci(fen: string, from: string, to: string, promotion?: string): string | null {
  const chess = new Chess(fen);
  const legal = chess.moves({ verbose: true }).find((m) => m.from === from && m.to === to);
  if (!legal) return null;
  return `${from}${to}${legal.promotion ? (promotion ?? 'q') : ''}`;
}

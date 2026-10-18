import type { Classification, EngineScore } from '../../shared/types';

const WIN_K = 0.00368208;
const CP_CLAMP = 1000;

/** Win % from the side-to-move view. Mate for the side to move = 100, against = 0. */
export function winPct(score: EngineScore): number {
  if (score.mate !== null) {
    return score.mate > 0 ? 100 : 0;
  }
  const cp = Math.max(-CP_CLAMP, Math.min(CP_CLAMP, score.cp ?? 0));
  return 50 + 50 * (2 / (1 + Math.exp(-WIN_K * cp)) - 1);
}

/** Mover's win % after the move. evalAfter is from the opponent's view. */
export function moverWinAfter(evalAfter: EngineScore): number {
  return 100 - winPct(evalAfter);
}

/** Negate a score. Mate 0 stays mate 0; callers must not flip it. */
export function flip(score: EngineScore): EngineScore {
  if (score.mate !== null) {
    return { cp: null, mate: 0 - score.mate };
  }
  return { cp: 0 - (score.cp ?? 0), mate: null };
}

export function classify(winBefore: number, winAfter: number, isBest: boolean): Classification {
  if (isBest) return 'best';
  if (winBefore < 5 || winAfter > 95) return 'good';
  const loss = winBefore - winAfter;
  if (loss >= 30) return 'blunder';
  if (loss >= 20) return 'mistake';
  if (loss >= 10) return 'inaccuracy';
  return 'good';
}

export function moveAccuracy(winLoss: number): number {
  const raw = 103.1668 * Math.exp(-0.04354 * winLoss) - 3.1669;
  return Math.max(0, Math.min(100, raw));
}

export function meanAccuracy(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

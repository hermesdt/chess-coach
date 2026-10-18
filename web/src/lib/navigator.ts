import type { GameDetail } from '../../../shared/types';

export interface NavState {
  ply: number;
  maxPly: number;
}

export type NavAction = 'first' | 'prev' | 'next' | 'last' | { goto: number };

export function navigate(state: NavState, action: NavAction): NavState {
  const { ply, maxPly } = state;
  let target: number;
  if (action === 'first') target = 0;
  else if (action === 'prev') target = ply - 1;
  else if (action === 'next') target = ply + 1;
  else if (action === 'last') target = maxPly;
  else target = action.goto;
  return { ply: Math.min(Math.max(target, 0), maxPly), maxPly };
}

export function fenAt(game: GameDetail, ply: number): string {
  return ply === 0 ? game.startFen : game.moves[ply - 1].fenAfter;
}

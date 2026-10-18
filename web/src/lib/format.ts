import type { GameSummary } from '../../../shared/types';

export const formatDate = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

type OpponentFields = Pick<GameSummary, 'userColor' | 'white' | 'black' | 'whiteElo' | 'blackElo'>;

/** Opponent name with rating. Games without a known user colour show both players. */
export function opponentLabel(g: OpponentFields): string {
  const withElo = (name: string, elo: number | null) => (elo !== null ? `${name} (${elo})` : name);
  if (g.userColor === null) return `${withElo(g.white, g.whiteElo)} vs ${withElo(g.black, g.blackElo)}`;
  return g.userColor === 'black' ? withElo(g.white, g.whiteElo) : withElo(g.black, g.blackElo);
}

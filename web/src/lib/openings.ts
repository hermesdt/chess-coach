import type { OpeningLeakGroup } from '../../../shared/types';

const TAB_ORDER = ['london', 'caro-kann', 'slav'];

/** Sort key for opening tabs: known ids in a fixed order, unknown ids last. */
export function tabRank(id: string): number {
  const i = TAB_ORDER.indexOf(id);
  return i === -1 ? TAB_ORDER.length : i;
}

/** "In 3 games you played 4…e6 instead of 4…Bf5". The move number comes from the node id path length. */
export function formatLeak(l: Pick<OpeningLeakGroup, 'nodeId' | 'expectedSan' | 'playedSan' | 'count'>): string {
  const ply = l.nodeId.split(' ').length;
  const number = Math.ceil(ply / 2);
  const prefix = ply % 2 === 1 ? `${number}.` : `${number}…`;
  const games = l.count === 1 ? '1 game' : `${l.count} games`;
  return `In ${games} you played ${prefix}${l.playedSan} instead of ${prefix}${l.expectedSan}`;
}

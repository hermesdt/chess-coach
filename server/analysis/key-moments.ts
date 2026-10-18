import type { Classification, KeyMoment, MoveAnalysis, Tag } from '../../shared/types.js';

const MAX_KEY_MOMENTS = 6;
const LEVEL2_INACCURACY_MIN_LOSS = 15;

type Reason = Classification | Tag;
/** Most severe first. */
const SEVERITY: Reason[] = ['blunder', 'mistake', 'missed_mate', 'missed_capture', 'inaccuracy'];

function reasonsFor(m: MoveAnalysis, level: 1 | 2 | 3): Reason[] {
  const reasons: Reason[] = [];
  if (m.classification === 'blunder' || m.classification === 'mistake') reasons.push(m.classification);
  if (m.tags.includes('missed_mate')) reasons.push('missed_mate');
  if (m.tags.includes('missed_capture')) reasons.push('missed_capture');
  if (level >= 2 && m.classification === 'inaccuracy' && m.winLoss >= LEVEL2_INACCURACY_MIN_LOSS) reasons.push('inaccuracy');
  return reasons;
}

export function selectKeyMoments(moves: MoveAnalysis[], level: 1 | 2 | 3 = 1): KeyMoment[] {
  const moments: KeyMoment[] = [];
  for (const m of moves) {
    if (!m.isUserMove) continue;
    const reasons = reasonsFor(m, level);
    if (reasons.length === 0) continue;
    const reason = reasons.sort((a, b) => SEVERITY.indexOf(a) - SEVERITY.indexOf(b))[0]!;
    moments.push({ ply: m.ply, reason, winLoss: m.winLoss });
  }
  return moments.sort((a, b) => b.winLoss - a.winLoss || a.ply - b.ply).slice(0, MAX_KEY_MOMENTS);
}

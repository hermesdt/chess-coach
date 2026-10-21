import { LEVEL_TAGS } from '../../shared/lessons.js';
import type { Classification, KeyMoment, MoveAnalysis, Tag } from '../../shared/types.js';

const MAX_KEY_MOMENTS = 6;
const LEVEL2_INACCURACY_MIN_LOSS = 15;
/** Tag-only moments need a real loss, to avoid noise in won positions. */
const TAG_MIN_LOSS = 10;

type Reason = Classification | Tag;
/** Most severe first. */
const SEVERITY: Reason[] = ['blunder', 'mistake', 'missed_mate', 'missed_capture', 'missed_fork', 'missed_pin', 'weak_back_rank', 'inaccuracy'];
/** Tags that can be a key-moment reason on their own. `bad_bishop` never is: it is a structure note, not a loss. */
const TAG_REASONS: Tag[] = ['missed_mate', 'missed_capture', 'missed_fork', 'missed_pin', 'weak_back_rank'];

function reasonsFor(m: MoveAnalysis, level: 1 | 2 | 3): Reason[] {
  const reasons: Reason[] = [];
  if (m.classification === 'blunder' || m.classification === 'mistake') reasons.push(m.classification);
  // Tags above the owner's level are not shown (Review Focus 1).
  const shown = LEVEL_TAGS[level];
  if (m.winLoss >= TAG_MIN_LOSS) {
    for (const tag of TAG_REASONS) if (shown.includes(tag) && m.tags.includes(tag)) reasons.push(tag);
  }
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

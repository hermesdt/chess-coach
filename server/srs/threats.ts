import { Chess } from 'chess.js';
import type { Color, MoveAnalysis } from '../../shared/types.js';
import { PIECE_VALUE, playUci } from '../analysis/tags-material.js';
import { winPct } from '../analysis/winpct.js';
import type { EngineLine } from '../engine/uci.js';
import { findMates } from './mates.js';

const MAX_WIN_DROP = 5;
const MIN_GAIN = 2;
const GAIN_PLIES = 4;
const MAX_MATE_DISTANCE = 2;
const PIECE_NAME: Record<string, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen' };

/** The same position with the other side to move and no en passant square. Null when the side to move is in check. */
export function nullMoveFen(fen: string): string | null {
  try {
    if (new Chess(fen).inCheck()) return null;
    const parts = fen.split(' ');
    parts[1] = parts[1] === 'w' ? 'b' : 'w';
    parts[3] = '-';
    return parts.join(' ');
  } catch {
    return null;
  }
}

/** Material gain (pawns) for the side to move at `fen`, from the start to after `plies`. Stops at the first illegal move. */
export function lineGain(fen: string, line: string[], plies: number): number {
  const chess = new Chess(fen);
  const side = chess.turn();
  let gain = 0;
  for (const uci of line.slice(0, plies)) {
    let m;
    try {
      m = playUci(chess, uci.toLowerCase());
    } catch {
      break;
    }
    const sign = m.color === side ? 1 : -1;
    if (m.captured) gain += sign * PIECE_VALUE[m.captured]!;
    if (m.promotion) gain += sign * (PIECE_VALUE[m.promotion]! - 1);
  }
  return gain;
}

export interface ThreatCandidate {
  ply: number; color: Color; fenBefore: string; nullFen: string;
  playedUci: string; playedSan: string;
  lastMove: { uci: string; san: string };
  replySan: string;
  threat: string;
  kind: 'capture' | 'mate';
  mateMoves: string[];
}

function isLegalCapture(fen: string, uci: string): boolean {
  try {
    return playUci(new Chess(fen), uci).captured !== undefined;
  } catch {
    return false;
  }
}

/** Mistakes by the owner where the opponent's next best move was a threat that the owner's move ignored. */
export function findThreatCandidates(moves: MoveAnalysis[], skipPlies: Set<number>): ThreatCandidate[] {
  const byPly = new Map(moves.map((m) => [m.ply, m]));
  const out: ThreatCandidate[] = [];
  for (const m of moves) {
    if (!m.isUserMove || (m.classification !== 'blunder' && m.classification !== 'mistake')) continue;
    if (skipPlies.has(m.ply)) continue;
    const prev = byPly.get(m.ply - 1);
    const next = byPly.get(m.ply + 1);
    if (!prev || !next) continue;
    const nullFen = nullMoveFen(m.fenBefore);
    if (!nullFen) continue;
    const threat = next.bestUci.toLowerCase();
    const mate = next.evalBefore.mate;
    let kind: 'capture' | 'mate' | null = null;
    let mateMoves: string[] = [];
    const mates = mate !== null && mate > 0 && mate <= MAX_MATE_DISTANCE ? findMates(nullFen) : null;
    if (mates) {
      kind = 'mate';
      mateMoves = mates.moves;
    } else if (isLegalCapture(nullFen, threat)) {
      kind = 'capture';
    }
    if (!kind) continue;
    out.push({
      ply: m.ply, color: m.color, fenBefore: m.fenBefore, nullFen,
      playedUci: m.uci, playedSan: m.san,
      lastMove: { uci: prev.uci, san: prev.san },
      replySan: next.san,
      threat, kind, mateMoves,
    });
  }
  return out;
}

/** Accepts the threat when it stays within 5 win % of the top line and wins 2 pawns of material. */
export function confirmThreat(
  nullFen: string, threat: string, lines: EngineLine[], threatLine: EngineLine | null,
): { accepted: string[]; best: string } | null {
  const top = lines[0];
  if (!top) return null;
  const t = threat.toLowerCase();
  const topWin = winPct(top.score);
  const good = (l: EngineLine): boolean =>
    topWin - winPct(l.score) <= MAX_WIN_DROP && lineGain(nullFen, l.pv, GAIN_PLIES) >= MIN_GAIN;
  const accepted = lines.filter((l) => l.pv.length > 0 && good(l)).map((l) => l.pv[0]!.toLowerCase());
  if (!lines.some((l) => l.pv[0]?.toLowerCase() === t) && threatLine && threatLine.pv.length > 0 && good(threatLine)) {
    accepted.push(threatLine.pv[0]!.toLowerCase());
  }
  if (!accepted.includes(t)) return null;
  return { accepted: [...new Set(accepted)], best: t };
}

/** One sentence that names the threat. */
export function threatText(nullFen: string, uci: string, mate: boolean): string {
  const m = playUci(new Chess(nullFen), uci.toLowerCase());
  if (mate) return `${m.san} is checkmate.`;
  const check = m.san.includes('+');
  if (m.captured) return `${m.san} takes your ${PIECE_NAME[m.captured]}${check ? ' with check' : ''}.`;
  return `${m.san} wins material.`;
}

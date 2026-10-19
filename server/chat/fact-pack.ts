import type { DatabaseSync } from 'node:sqlite';
import { Chess, type Move, type PieceSymbol } from 'chess.js';
import type { Classification, Color, EngineScore, Tag } from '../../shared/types.js';
import { gameFacts, type GameFacts } from '../ai/facts.js';
import { loadGame } from '../ai/game-review.js';
import { getAnalysis } from '../analysis/analysis-repo.js';
import { flip, winPct } from '../analysis/winpct.js';
import type { EnginePool } from '../engine/pool.js';
import type { EngineLine } from '../engine/uci.js';
import { currentLevel } from '../level.js';
import type { Repertoire } from '../repertoire/types.js';
import { parseNamedMoves } from './named-moves.js';

/** The game has no finished analysis, so the coach has no stored facts to use. */
export class NotAnalysedError extends Error {
  constructor(gameId: number) {
    super(`Game ${gameId} is not analysed yet`);
    this.name = 'NotAnalysedError';
  }
}

export const MAX_LINE_PLIES = 16;
const MULTIPV = 3;

export interface FactLine {
  id: string;
  kind: 'best' | 'refutation' | 'named' | 'repertoire';
  startFen: string;
  san: string[];
  uci: string[];
  /** Centipawns from the game user's view (positive = good for the user). Null when the engine reports a mate. */
  evalCp: number | null;
  /** Moves to mate from the game user's view (positive = the user mates). Null when there is no mate. */
  evalMate: number | null;
  /** Win % of the game user (0..100). */
  winPctForUser: number;
  materialEnd: { white: number; black: number };
  captures: { ply: number; piece: string; square: string; by: Color }[];
  checks: number;
  comment?: string;
}

export interface FactPack {
  turnPrefix: string;
  anchor: { fen: string; sideToMove: Color; ply: number; path: string[]; inBranch: boolean; isUserToMove: boolean; describe: string };
  /** Win values are from the mover's view, as stored in the move analysis. */
  played: { san: string; mover: Color; winBefore: number; winAfter: number; classification: Classification; tags: Tag[] } | null;
  lines: FactLine[];
  threat: { san: string; uci: string } | null;
  named: { text: string; status: 'legal' | 'illegal' | 'ambiguous'; lineId?: string }[];
  game: GameFacts;
  isFinal: 'checkmate' | 'stalemate' | null;
}

export interface FactPackDeps {
  db: DatabaseSync;
  pool: Pick<EnginePool, 'analyse'>;
  reps: Repertoire[];
  nodes: number;
}

export interface FactPackInput {
  gameId: number;
  anchor: { ply: number; path: string[] };
  question: string;
  turn: number;
}

const PIECE_VALUE: Record<PieceSymbol, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const PIECE_NAME: Record<PieceSymbol, string> = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };

const colorOf = (turn: 'w' | 'b'): Color => (turn === 'w' ? 'white' : 'black');
const fenKey = (fen: string): string => fen.split(' ').slice(0, 4).join(' ');
const toUci = (m: Move): string => m.from + m.to + (m.promotion ?? '');

function material(chess: Chess): { white: number; black: number } {
  const out = { white: 0, black: 0 };
  for (const row of chess.board()) {
    for (const sq of row) if (sq) out[colorOf(sq.color)] += PIECE_VALUE[sq.type];
  }
  return out;
}

function playUci(chess: Chess, uci: string): Move | null {
  try {
    return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci.slice(4) : undefined });
  } catch {
    return null;
  }
}

/** Move label such as "9...exf5" or "10. Nge2". */
const label = (fullmove: number, color: Color, san: string): string => (color === 'white' ? `${fullmove}. ${san}` : `${fullmove}...${san}`);

/** Same position with the other side to move and no en passant square. Null when the side to move is in check or the FEN is rejected. */
function nullMoveFen(fen: string): string | null {
  try {
    if (new Chess(fen).inCheck()) return null;
    const [placement, side, castling, , half, full] = fen.split(' ');
    const flipped = `${placement} ${side === 'w' ? 'b' : 'w'} ${castling} - ${half} ${full}`;
    new Chess(flipped);
    return flipped;
  } catch {
    return null;
  }
}

class LineBuilder {
  constructor(private readonly user: Color) {}

  /** Score is from the view of `scoreSide` (the side to move in the position the engine looked at). */
  build(
    meta: { id: string; kind: FactLine['kind']; comment?: string },
    startFen: string,
    uci: string[],
    score: EngineScore | null,
    scoreSide: Color,
  ): FactLine | null {
    const chess = new Chess(startFen);
    const played: string[] = [];
    const san: string[] = [];
    const captures: FactLine['captures'] = [];
    let checks = 0;
    for (const u of uci.slice(0, MAX_LINE_PLIES)) {
      const by = colorOf(chess.turn());
      const m = playUci(chess, u);
      if (!m) break;
      played.push(toUci(m));
      san.push(m.san);
      if (m.isCapture() || m.isEnPassant()) captures.push({ ply: san.length, piece: PIECE_NAME[m.captured ?? 'p'], square: m.isEnPassant() ? m.to[0]! + m.from[1]! : m.to, by });
      if (m.san.endsWith('+') || m.san.endsWith('#')) checks++;
    }
    if (san.length === 0) return null;
    const own: EngineScore | null = score === null ? null : scoreSide === this.user ? score : flip(score);
    let winPctForUser: number;
    if (own) winPctForUser = winPct(own);
    else if (chess.isCheckmate()) winPctForUser = colorOf(chess.turn()) === this.user ? 0 : 100;
    else winPctForUser = 50;
    return {
      id: meta.id, kind: meta.kind, startFen, san, uci: played, evalCp: own?.cp ?? null, evalMate: own?.mate ?? null,
      winPctForUser, materialEnd: material(chess), captures, checks, ...(meta.comment === undefined ? {} : { comment: meta.comment }),
    };
  }
}

function describeAnchor(
  game: { moves: { san: string }[] },
  ply: number,
  path: string[],
  anchorFen: string,
  mainFen: string,
  userToMove: boolean,
  pathSan: string[],
): string {
  const mainChess = new Chess(mainFen);
  const mainFull = Number(mainFen.split(' ')[5]);
  const mainLabel = ply === 0 ? 'the start position' : label(Math.ceil(ply / 2), ply % 2 === 1 ? 'white' : 'black', game.moves[ply - 1]!.san);
  if (path.length === 0) {
    if (ply === 0) return mainLabel;
    return `the position after ${mainLabel} (${userToMove ? 'your' : 'their'} move ${Number(anchorFen.split(' ')[5])})`;
  }
  let n = mainFull;
  let color = colorOf(mainChess.turn());
  const parts = pathSan.map((san, i) => {
    const text = color === 'white' ? `${n}. ${san}` : i === 0 ? `${n}...${san}` : san;
    if (color === 'black') n++;
    color = color === 'white' ? 'black' : 'white';
    return text;
  });
  return `a side line: ${parts.join(' ')} (after ${mainLabel})`;
}

export async function buildFactPack(deps: FactPackDeps, input: FactPackInput): Promise<FactPack> {
  const { db, pool, reps, nodes } = deps;
  const game = loadGame(db, input.gameId);
  if (!game) throw new Error(`Game ${input.gameId} not found`);
  const analysis = getAnalysis(db, input.gameId);
  if (!analysis || analysis.status !== 'done') throw new NotAnalysedError(input.gameId);

  const { ply, path } = input.anchor;
  if (!Number.isInteger(ply) || ply < 0 || ply > game.moves.length) throw new RangeError(`ply ${ply} is outside the game`);
  const mainFen = ply === 0 ? game.startFen : game.moves[ply - 1]!.fenAfter;
  const chess = new Chess(mainFen);
  const pathSan: string[] = [];
  for (const u of path) {
    const m = playUci(chess, u);
    if (!m) throw new Error(`Illegal move ${u} in the branch`);
    pathSan.push(m.san);
  }
  const fen = chess.fen();
  const sideToMove = colorOf(chess.turn());
  const user: Color = game.userColor ?? 'white';
  const isUserToMove = game.userColor !== null && sideToMove === game.userColor;
  const prefix = `t${input.turn}.`;
  const builder = new LineBuilder(user);
  const isFinal = chess.isCheckmate() ? 'checkmate' : chess.isStalemate() ? 'stalemate' : null;
  const level = currentLevel(db);

  const stored = path.length === 0 ? analysis.moves.find((m) => m.ply === ply + 1) : undefined;
  const played = stored
    ? { san: stored.san, mover: sideToMove, winBefore: stored.winBefore, winAfter: stored.winAfter, classification: stored.classification, tags: stored.tags }
    : null;

  const named = isFinal ? [] : parseNamedMoves(input.question, fen);
  const repMoves = new Map<string, { san: string; uci: string; comment: string | null }>();
  const anchorKey = fenKey(fen);
  for (const rep of reps) {
    for (const node of rep.byId.values()) {
      if (fenKey(node.fenBefore) === anchorKey && !repMoves.has(node.uci)) repMoves.set(node.uci, { san: node.san, uci: node.uci, comment: node.comment });
    }
  }

  const analyse = (f: string, multipv: number): Promise<EngineLine[]> => pool.analyse(f, { nodes, multipv });
  /** Engine look at the position after `uci` from the anchor. */
  const after = (uci: string): { fen: string; stm: Color; terminal: boolean } => {
    const c = new Chess(fen);
    playUci(c, uci);
    return { fen: c.fen(), stm: colorOf(c.turn()), terminal: c.isGameOver() };
  };
  const afterLines = (uci: string): Promise<EngineLine[]> => {
    const next = after(uci);
    return next.terminal ? Promise.resolve([]) : analyse(next.fen, 1);
  };

  const nullFen = isFinal ? null : nullMoveFen(fen);
  const refFen = played && !new Chess(game.moves[ply]!.fenAfter).isGameOver() ? game.moves[ply]!.fenAfter : null;
  const legalNamed = named.filter((n) => n.status === 'legal' && n.uci !== undefined);
  const repList = [...repMoves.values()];

  const [mainLines, refLines, nullLines, namedLines, repLines] = await Promise.all([
    isFinal ? Promise.resolve([]) : analyse(fen, MULTIPV),
    refFen ? analyse(refFen, 1) : Promise.resolve([]),
    nullFen ? analyse(nullFen, 1) : Promise.resolve([]),
    Promise.all(legalNamed.map((n) => afterLines(n.uci!))),
    Promise.all(repList.map((r) => afterLines(r.uci))),
  ]);

  const lines: FactLine[] = [];
  const push = (l: FactLine | null): FactLine | null => {
    if (l) lines.push(l);
    return l;
  };
  [...mainLines].sort((a, b) => a.multipv - b.multipv).slice(0, MULTIPV).forEach((l, i) => {
    push(builder.build({ id: `${prefix}L${i + 1}`, kind: 'best' }, fen, l.pv, l.score, sideToMove));
  });
  const ref = refLines[0];
  if (refFen && ref) {
    push(builder.build({ id: `${prefix}REF`, kind: 'refutation' }, refFen, ref.pv, ref.score, colorOf(new Chess(refFen).turn())));
  }
  const namedOut: FactPack['named'] = [];
  let q = 0;
  let legalIndex = 0;
  for (const n of named) {
    if (n.status !== 'legal' || n.uci === undefined) {
      namedOut.push({ text: n.text, status: n.status });
      continue;
    }
    const next = after(n.uci);
    const best = namedLines[legalIndex++]?.[0];
    const id = `${prefix}Q${q + 1}`;
    const built = builder.build({ id, kind: 'named' }, fen, [n.uci, ...(best?.pv ?? [])], best?.score ?? null, next.stm);
    if (push(built)) q++;
    namedOut.push(built ? { text: n.text, status: 'legal', lineId: id } : { text: n.text, status: 'legal' });
  }
  let r = 0;
  repList.forEach((move, i) => {
    const best = repLines[i]?.[0];
    const meta = { id: `${prefix}REP${r + 1}`, kind: 'repertoire' as const, ...(move.comment === null ? {} : { comment: move.comment }) };
    if (push(builder.build(meta, fen, [move.uci], best?.score ?? null, after(move.uci).stm))) r++;
  });

  let threat: FactPack['threat'] = null;
  const nullBest = nullLines[0]?.pv[0];
  if (nullFen && nullBest) {
    const m = playUci(new Chess(nullFen), nullBest);
    if (m) threat = { san: m.san, uci: toUci(m) };
  }

  return {
    turnPrefix: prefix,
    anchor: {
      fen, sideToMove, ply, path, inBranch: path.length > 0, isUserToMove,
      describe: describeAnchor(game, ply, path, fen, mainFen, isUserToMove, pathSan),
    },
    played,
    lines,
    threat,
    named: namedOut,
    game: gameFacts(game, analysis, level),
    isFinal,
  };
}

/** Every SAN in the lines, the threat and the played move. */
export function factPackSan(pack: FactPack): string[] {
  return [...pack.lines.flatMap((l) => l.san), ...(pack.threat ? [pack.threat.san] : []), ...(pack.played ? [pack.played.san] : [])];
}

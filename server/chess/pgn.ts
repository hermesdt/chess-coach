import { createHash } from 'node:crypto';
import { Chess, DEFAULT_POSITION } from 'chess.js';
import type { Color, GameResult, MoveInfo, NewGame, Source, TimeClass } from '../../shared/types.js';

export class PgnError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PgnError';
  }
}

const TAG_LINE = /^\[\w+\s+"/;

const normalise = (text: string): string => text.replace(/\r\n?/g, '\n');

export function splitPgn(text: string): string[] {
  const games: string[] = [];
  let current: string[] = [];
  let seenMoves = false;
  const flush = () => {
    const game = current.join('\n').trim();
    if (game) games.push(game);
    current = [];
    seenMoves = false;
  };
  for (const line of normalise(text).split('\n')) {
    const trimmed = line.trim();
    if (TAG_LINE.test(trimmed)) {
      if (seenMoves) flush();
    } else if (trimmed) {
      seenMoves = true;
    }
    current.push(line);
  }
  flush();
  return games;
}

export function parsePgn(pgn: string): { headers: Record<string, string>; startFen: string; moves: MoveInfo[] } {
  const chess = new Chess();
  try {
    chess.loadPgn(normalise(pgn));
  } catch (e) {
    throw new PgnError(e instanceof Error ? e.message : String(e));
  }
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(chess.getHeaders())) if (v != null) headers[k] = v;
  const startFen = headers.SetUp === '1' && headers.FEN ? headers.FEN : DEFAULT_POSITION;
  const replay = new Chess(startFen);
  const moves: MoveInfo[] = [];
  for (const m of chess.history({ verbose: true })) {
    const fenBefore = replay.fen();
    replay.move(m.san);
    moves.push({ ply: moves.length + 1, san: m.san, uci: m.from + m.to + (m.promotion ?? ''), fenBefore, fenAfter: replay.fen() });
  }
  return { headers, startFen, moves };
}

export function resolveUserColor(white: string, black: string, usernames: (string | null)[]): Color | null {
  const names = usernames.filter((u): u is string => !!u).map((u) => u.toLowerCase());
  const isWhite = names.includes(white.toLowerCase());
  const isBlack = names.includes(black.toLowerCase());
  if (isWhite === isBlack) return null;
  return isWhite ? 'white' : 'black';
}

export function resultForUser(rawResult: string, color: Color | null): GameResult | null {
  if (!color) return null;
  if (rawResult === '1/2-1/2') return 'draw';
  if (rawResult === '1-0') return color === 'white' ? 'win' : 'loss';
  if (rawResult === '0-1') return color === 'black' ? 'win' : 'loss';
  return null;
}

function timeClassOf(tc: string | undefined): TimeClass {
  if (!tc) return 'unknown';
  if (tc === '-' || tc.includes('/')) return 'daily';
  const [base, inc] = tc.split('+');
  const seconds = Number(base) + 40 * Number(inc ?? 0);
  if (!Number.isFinite(seconds)) return 'unknown';
  if (seconds < 30) return 'ultrabullet';
  if (seconds < 180) return 'bullet';
  if (seconds < 480) return 'blitz';
  if (seconds < 1500) return 'rapid';
  return 'classical';
}

function playedAtOf(h: Record<string, string>): number {
  const parse = (date: string | undefined, time: string) => {
    const m = /^(\d{4})\.(\d{2})\.(\d{2})$/.exec(date ?? '');
    if (!m) return null;
    const t = /^(\d{2}):(\d{2}):(\d{2})$/.exec(time);
    return Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, t ? +t[1]! : 0, t ? +t[2]! : 0, t ? +t[3]! : 0);
  };
  return parse(h.UTCDate, h.UTCTime ?? '') ?? parse(h.Date, '') ?? Date.now();
}

function openingOf(h: Record<string, string>): string | null {
  if (h.Opening && h.Opening !== '?') return h.Opening;
  if (h.ECOUrl) {
    const last = h.ECOUrl.split('/').filter(Boolean).pop();
    if (last) return last.replace(/-/g, ' ');
  }
  return null;
}

const known = (v: string | undefined): string | null => (v && v !== '?' ? v : null);
const elo = (v: string | undefined): number | null => (v && /^\d+$/.test(v) ? Number(v) : null);

function movetextOf(pgn: string): string {
  const lines = normalise(pgn).split('\n');
  return lines.filter((l) => !l.trim().startsWith('[')).join(' ').replace(/\s+/g, ' ').trim();
}

export function gameFromPgn(
  pgn: string,
  opts: { source: Source; sourceId?: string; usernames: (string | null)[]; userColor?: Color | null },
): NewGame | { skipped: string } {
  const text = normalise(pgn).trim();
  const variant = /^\[Variant\s+"([^"]*)"\]/im.exec(text)?.[1];
  if (variant && !['standard', 'from position'].includes(variant.toLowerCase())) return { skipped: 'non-standard variant' };
  let parsed: ReturnType<typeof parsePgn>;
  try {
    parsed = parsePgn(text);
  } catch (e) {
    return { skipped: `invalid PGN: ${e instanceof Error ? e.message : String(e)}` };
  }
  const { headers: h, moves } = parsed;

  const white = h.White ?? '?';
  const black = h.Black ?? '?';
  const userColor = opts.userColor !== undefined ? opts.userColor : resolveUserColor(white, black, opts.usernames);
  const sourceId =
    opts.sourceId ??
    createHash('sha1').update([movetextOf(text), h.White ?? '', h.Black ?? '', h.Date ?? ''].join('\n')).digest('hex');
  const url = [h.Site, h.Link].find((v) => v?.startsWith('http')) ?? null;

  return {
    source: opts.source,
    sourceId,
    playedAt: playedAtOf(h),
    timeClass: timeClassOf(h.TimeControl),
    rated: /^rated/i.test(h.Event ?? ''),
    white,
    black,
    whiteElo: elo(h.WhiteElo),
    blackElo: elo(h.BlackElo),
    userColor,
    result: resultForUser(h.Result ?? '*', userColor),
    termination: known(h.Termination),
    eco: known(h.ECO),
    openingName: openingOf(h),
    pgn: text,
    url,
    plyCount: moves.length,
  };
}

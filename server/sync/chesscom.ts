import type { NewGame, TimeClass } from '../../shared/types.js';
import { gameFromPgn, resultForUser } from '../chess/pgn.js';
import { SyncError } from './errors.js';

interface ChesscomPlayer {
  username: string;
  rating?: number;
}

export interface ChesscomGame {
  url: string;
  pgn: string;
  uuid?: string;
  end_time: number;
  rated: boolean;
  time_class: string;
  rules: string;
  white: ChesscomPlayer;
  black: ChesscomPlayer;
}

const API = 'https://api.chess.com/pub/player';
const HEADERS = { 'User-Agent': 'chess-coach-local/0.1 (personal use)' };
const TIME_CLASSES: readonly string[] = ['bullet', 'blitz', 'rapid', 'daily'];

export function mapChesscomGame(g: ChesscomGame, username: string): NewGame | null {
  if (g.rules !== 'chess') return null;
  const parsed = gameFromPgn(g.pgn, { source: 'chesscom', usernames: [username] });
  if ('skipped' in parsed) return null;
  const is = (p: ChesscomPlayer) => p.username.toLowerCase() === username.toLowerCase();
  const userColor = is(g.white) === is(g.black) ? null : is(g.white) ? 'white' : 'black';
  const rawResult = /^\[Result\s+"([^"]*)"\]/m.exec(g.pgn)?.[1] ?? '*';
  return {
    ...parsed,
    sourceId: g.uuid ?? g.url,
    playedAt: g.end_time * 1000,
    timeClass: (TIME_CLASSES.includes(g.time_class) ? g.time_class : 'unknown') as TimeClass,
    rated: g.rated,
    white: g.white.username,
    black: g.black.username,
    whiteElo: g.white.rating ?? null,
    blackElo: g.black.rating ?? null,
    userColor,
    result: resultForUser(rawResult, userColor),
    url: g.url,
  };
}

async function getJson<T>(fetchFn: typeof fetch, url: string): Promise<T> {
  const res = await fetchFn(url, { headers: HEADERS });
  if (!res.ok) throw new SyncError(`chess.com request failed with status ${res.status}: ${url}`);
  return (await res.json()) as T;
}

const monthKey = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export async function fetchChesscomGames(
  username: string,
  opts: { sinceMs: number; fetchFn?: typeof fetch; onMonth?: (games: NewGame[], monthUrl: string) => void },
): Promise<number> {
  const fetchFn = opts.fetchFn ?? fetch;
  const user = username.toLowerCase();
  const { archives } = await getJson<{ archives: string[] }>(fetchFn, `${API}/${user}/games/archives`);
  const first = monthKey(opts.sinceMs);
  const months = archives.filter((u) => u.split('/').slice(-2).join('/') >= first).sort();
  let total = 0;
  for (const monthUrl of months) {
    const { games } = await getJson<{ games: ChesscomGame[] }>(fetchFn, monthUrl);
    const mapped = games.flatMap((g) => mapChesscomGame(g, username) ?? []);
    total += mapped.length;
    opts.onMonth?.(mapped, monthUrl);
  }
  return total;
}

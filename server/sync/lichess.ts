import type { NewGame, TimeClass } from '../../shared/types.js';
import { gameFromPgn, resultForUser } from '../chess/pgn.js';
import { LichessTokenRequiredError, SyncError } from './errors.js';

interface LichessPlayer {
  user?: { name: string };
  rating?: number;
  aiLevel?: number;
}

export interface LichessGame {
  id: string;
  rated: boolean;
  variant: string;
  speed: string;
  lastMoveAt: number;
  players: { white: LichessPlayer; black: LichessPlayer };
  opening?: { eco: string; name: string };
  pgn: string;
}

const API = 'https://lichess.org/api/games/user';
const BATCH_SIZE = 100;
const TIME_CLASSES: readonly string[] = ['ultrabullet', 'bullet', 'blitz', 'rapid', 'classical'];

const nameOf = (p: LichessPlayer): string =>
  p.user?.name ?? (p.aiLevel !== undefined ? `Stockfish level ${p.aiLevel}` : 'Anonymous');

function timeClassOf(speed: string): TimeClass {
  if (speed === 'correspondence') return 'daily';
  return (TIME_CLASSES.includes(speed) ? speed : 'unknown') as TimeClass;
}

export function mapLichessGame(g: LichessGame, username: string): NewGame | null {
  if (g.variant !== 'standard' && g.variant !== 'fromPosition') return null;
  const parsed = gameFromPgn(g.pgn, { source: 'lichess', sourceId: g.id, usernames: [username] });
  if ('skipped' in parsed) return null;
  const is = (p: LichessPlayer) => p.user?.name.toLowerCase() === username.toLowerCase();
  const userColor = is(g.players.white) === is(g.players.black) ? null : is(g.players.white) ? 'white' : 'black';
  const rawResult = /^\[Result\s+"([^"]*)"\]/m.exec(g.pgn)?.[1] ?? '*';
  return {
    ...parsed,
    sourceId: g.id,
    playedAt: g.lastMoveAt,
    timeClass: timeClassOf(g.speed),
    rated: g.rated,
    white: nameOf(g.players.white),
    black: nameOf(g.players.black),
    whiteElo: g.players.white.rating ?? null,
    blackElo: g.players.black.rating ?? null,
    userColor,
    result: resultForUser(rawResult, userColor),
    eco: g.opening?.eco ?? null,
    openingName: g.opening?.name ?? null,
    url: `https://lichess.org/${g.id}`,
    pgn: g.pgn,
  };
}

export async function fetchLichessGames(
  username: string,
  opts: { sinceMs: number; token: string | null; fetchFn?: typeof fetch; onBatch?: (games: NewGame[]) => void },
): Promise<number> {
  const fetchFn = opts.fetchFn ?? fetch;
  const query = new URLSearchParams({
    since: String(opts.sinceMs),
    sort: 'dateAsc',
    pgnInJson: 'true',
    opening: 'true',
    clocks: 'true',
    evals: 'false',
  });
  const headers: Record<string, string> = { Accept: 'application/x-ndjson' };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

  let res: Response;
  try {
    res = await fetchFn(`${API}/${encodeURIComponent(username)}?${query}`, { headers });
  } catch (e) {
    throw new SyncError(`lichess request failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (res.status === 404) {
    if (!opts.token) throw new LichessTokenRequiredError();
    throw new SyncError('Lichess user not found');
  }
  if (res.status === 401 || res.status === 403) {
    throw new SyncError('Lichess rejected the token. Create a new one in Settings.');
  }
  if (!res.ok) throw new SyncError(`lichess request failed with status ${res.status}`);
  if (!res.body) throw new SyncError('lichess response had no body');

  let total = 0;
  let batch: NewGame[] = [];
  const handleLine = (line: string): void => {
    if (!line.trim()) return;
    const mapped = mapLichessGame(JSON.parse(line) as LichessGame, username);
    if (!mapped) return;
    batch.push(mapped);
    total += 1;
    if (batch.length >= BATCH_SIZE) {
      opts.onBatch?.(batch);
      batch = [];
    }
  };

  try {
    const decoder = new TextDecoder();
    let buffer = '';
    for await (const chunk of res.body) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      lines.forEach(handleLine);
    }
    handleLine(buffer + decoder.decode());
  } catch (e) {
    if (e instanceof SyncError) throw e;
    throw new SyncError(`lichess stream failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (batch.length > 0) opts.onBatch?.(batch);
  return total;
}

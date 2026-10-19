import { Chess } from 'chess.js';
import { Hono } from 'hono';
import type { Color, LiveEvalDTO, LiveSupersededDTO } from '../../shared/types.js';
import type { EngineCache } from '../engine/cache.js';
import { isAbortError, LIVE_MOVETIME_MS, type LiveEngine } from '../engine/live.js';

const MAX_PLIES = 8;

/** SAN and UCI of the first plies of a line. Stops at the first illegal move. */
function playLine(fen: string, pv: string[]): { san: string[]; uci: string[] } {
  const chess = new Chess(fen);
  const san: string[] = [];
  const uci: string[] = [];
  for (const u of pv.slice(0, MAX_PLIES)) {
    try {
      const m = chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u.slice(4) : undefined });
      san.push(m.san);
      uci.push(m.from + m.to + (m.promotion ?? ''));
    } catch {
      break;
    }
  }
  return { san, uci };
}

export function liveRoutes(live: Pick<LiveEngine, 'analyse'>, cache: EngineCache): Hono {
  return new Hono().get('/live', async (c) => {
    const fen = c.req.query('fen') ?? '';
    let chess: Chess;
    try {
      chess = new Chess(fen);
    } catch {
      return c.json({ error: 'invalid fen' }, 400);
    }
    const sideToMove: Color = chess.turn() === 'w' ? 'white' : 'black';
    if (chess.isGameOver()) return c.json({ fen, sideToMove, lines: [] } satisfies LiveEvalDTO);
    try {
      const found = await live.analyse(fen, { multipv: 3, movetimeMs: LIVE_MOVETIME_MS, signal: c.req.raw.signal });
      if (found.nodes !== undefined && found.length > 0) cache.set(fen, 3, found, found.nodes);
      const lines = found
        .map((l) => ({ ...playLine(fen, l.pv), evalCp: l.score.cp, evalMate: l.score.mate }))
        .filter((l) => l.san.length > 0);
      return c.json({ fen, sideToMove, lines } satisfies LiveEvalDTO);
    } catch (e) {
      // The client went away or asked for another position: nobody reads this answer.
      if (isAbortError(e)) return c.json({ superseded: true } satisfies LiveSupersededDTO);
      return c.json({ error: 'Engine not available.' }, 503);
    }
  });
}

import { Chess } from 'chess.js';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { ChatMessageDTO, GameAnalysis, MoveAnalysis, NewGame } from '../../shared/types.js';
import type { AiProvider } from '../ai/types.js';
import { createRegistry } from '../ai/registry.js';
import { saveAnalysis } from '../analysis/analysis-repo.js';
import { createApp } from '../app.js';
import { insertPending, markInterruptedChats } from '../chat/chat-repo.js';
import { parsePgn } from '../chess/pgn.js';
import { openDb } from '../db/db.js';
import { insertGames } from '../db/games-repo.js';
import { setSetting } from '../db/settings-repo.js';
import { waitForJob } from '../jobs.js';

const PGN = '1. d4 Nf6 2. Bg5 h6 3. Bxh6 gxh6 *';
const newGame = (id: string): NewGame => ({
  source: 'chesscom', sourceId: id, playedAt: 1, timeClass: 'blitz', rated: true, white: 'Me', black: 'Opp', whiteElo: 600, blackElo: 650,
  userColor: 'white', result: 'loss', termination: null, eco: null, openingName: null, pgn: PGN, url: null, plyCount: 6,
});
function analysis(gameId: number, status: GameAnalysis['status'] = 'done'): GameAnalysis {
  const ms: MoveAnalysis[] = parsePgn(PGN).moves.map((m) => ({
    ply: m.ply, san: m.san, uci: m.uci, color: m.ply % 2 === 1 ? 'white' : 'black', fenBefore: m.fenBefore,
    evalBefore: { cp: 20, mate: null }, evalAfter: { cp: -20, mate: null }, bestUci: m.uci, bestSan: m.san, pvSan: [m.san],
    winBefore: 55, winAfter: 50, winLoss: 5, classification: 'good', tags: [], isUserMove: m.ply % 2 === 1,
  }));
  return { gameId, version: 1, status, error: null, accuracyUser: 50, accuracyOpp: 50, counts: { blunder: 0, mistake: 0, inaccuracy: 0 }, moves: ms, keyMoments: [], analysedAt: 1 };
}

/** Three legal moves of any position, best first. */
const pool = {
  analyse: async (fen: string) =>
    new Chess(fen).moves({ verbose: true }).slice(0, 3).map((m, i) => ({ multipv: i + 1, score: { cp: 40 - i * 10, mate: null }, pv: [m.from + m.to + (m.promotion ?? '')] })),
};

let db: DatabaseSync;
let app: ReturnType<typeof createApp>;
let reply: () => Promise<string>;
let calls: number;
let available: boolean;
const ANSWER = JSON.stringify({ answer: 'Look at the centre.', lines: [{ id: 't1.L1', why: 'It is the best try.' }], rule: 'Control the centre.', lessonId: null });

beforeEach(() => {
  db = openDb(':memory:');
  insertGames(db, [newGame('a'), newGame('b')]);
  db.prepare('UPDATE games SET duplicate_of = 1 WHERE id = 2').run();
  saveAnalysis(db, analysis(1));
  calls = 0;
  available = true;
  reply = async () => ANSWER;
  const provider: AiProvider = {
    id: 'claude-cli', label: 'Fake', available: async () => ({ ok: available }),
    complete: async () => ((calls += 1), { text: await reply(), model: 'm-1' }),
  };
  app = createApp({ db, pool, repertoires: [], ai: createRegistry({ db, providers: [provider] }) });
});

const post = (path: string, body: unknown = {}) =>
  app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const ask = (id: number, question = 'What now?', anchor: { ply: number; path: string[] } = { ply: 2, path: [] }) => post(`/api/games/${id}/chat`, { question, anchor });
const list = async (id = 1) => (await (await app.request(`/api/games/${id}/chat`)).json()) as ChatMessageDTO[];
async function askAndWait(id = 1, question = 'What now?', anchor = { ply: 2, path: [] as string[] }) {
  const res = await ask(id, question, anchor);
  const { messageId, jobId } = (await res.json()) as { messageId: number; jobId: number };
  await waitForJob(db, jobId);
  return messageId;
}

describe('chat routes', () => {
  it('runs the job and returns a done message with resolved lines', async () => {
    const res = await ask(1);
    expect(res.status).toBe(200);
    const { messageId, jobId } = (await res.json()) as { messageId: number; jobId: number };
    await waitForJob(db, jobId);
    const [m] = await list();
    expect(m).toMatchObject({
      id: messageId, turn: 1, question: 'What now?', status: 'done', error: null, provider: 'claude-cli', model: 'm-1',
      anchor: { ply: 2, path: [], describe: expect.stringContaining('1...Nf6') },
    });
    expect(m!.answer).toMatchObject({ text: 'Look at the centre.', rule: 'Control the centre.', lessonId: null });
    expect(m!.answer!.lines).toHaveLength(1);
    expect(m!.answer!.lines[0]).toMatchObject({ id: 't1.L1', label: 'Line 1', why: 'It is the best try.', winPctForUser: expect.any(Number) });
    expect(m!.answer!.lines[0]!.san.length).toBeGreaterThan(0);
  });

  it('numbers the turns and lets a later turn use earlier answers as history', async () => {
    await askAndWait();
    reply = async () => ANSWER.replaceAll('t1.', 't2.');
    await askAndWait(1, 'And then?');
    expect((await list()).map((m) => [m.turn, m.status])).toEqual([[1, 'done'], [2, 'done']]);
  });

  it('answers 404, 400 and 409 before starting a job', async () => {
    expect((await ask(99)).status).toBe(404);
    expect((await post('/api/games/1/chat', { question: '  ', anchor: { ply: 0, path: [] } })).status).toBe(400);
    expect((await ask(1, 'x', { ply: 99, path: [] })).status).toBe(400);
    expect((await ask(1, 'x', { ply: 0, path: ['e2e5'] })).status).toBe(400);
    expect((await post('/api/games/1/chat', { question: 'x', anchor: { ply: 0, path: [] }, provider: 'nope' })).status).toBe(400);
    expect((await app.request('/api/games/99/chat')).status).toBe(404);
    saveAnalysis(db, analysis(1, 'pending'));
    const res = await ask(1);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Analyse this game first.' });
    expect(await list()).toEqual([]);
  });

  it('refuses a second question while one is pending', async () => {
    let release: (v: string) => void = () => undefined;
    reply = () => new Promise<string>((r) => (release = r));
    const first = (await (await ask(1)).json()) as { jobId: number };
    expect((await list())[0]!.status).toBe('pending');
    const second = await ask(1);
    expect(second.status).toBe(409);
    expect((await second.json() as { error: string }).error).toMatch(/already/i);
    release(ANSWER);
    await waitForJob(db, first.jobId);
    expect((await ask(1)).status).toBe(200);
  });

  it('stores an error when no provider is available', async () => {
    available = false;
    await askAndWait();
    expect(await list()).toMatchObject([{ status: 'error', error: 'No AI coach is set up. Open Settings.', answer: null }]);
    expect(calls).toBe(0);
  });

  it('stores an error when the provider setting is none', async () => {
    setSetting(db, 'ai_provider', 'none');
    await askAndWait();
    expect((await list())[0]).toMatchObject({ status: 'error', error: 'No AI coach is set up. Open Settings.' });
  });

  it('stores the error text when the provider fails, and retry re-runs it', async () => {
    reply = async () => {
      throw new Error('boom');
    };
    const id = await askAndWait();
    expect((await list())[0]).toMatchObject({ status: 'error', error: 'boom' });
    reply = async () => ANSWER;
    const retry = await post(`/api/chat/${id}/retry`);
    expect(retry.status).toBe(200);
    await waitForJob(db, ((await retry.json()) as { jobId: number }).jobId);
    expect(await list()).toMatchObject([{ id, turn: 1, status: 'done', error: null }]);
  });

  it('retry is 404 for an unknown message and 409 for one that is not an error', async () => {
    expect((await post('/api/chat/99/retry')).status).toBe(404);
    const id = await askAndWait();
    expect((await post(`/api/chat/${id}/retry`)).status).toBe(409);
  });

  it('shares the thread of the canonical game with its duplicate', async () => {
    await askAndWait(2);
    expect(await list(1)).toHaveLength(1);
    expect(await list(2)).toHaveLength(1);
    expect(db.prepare('SELECT game_id FROM chat_messages').get()!.game_id).toBe(1);
  });

  it('shows interrupted messages as errors after a restart', async () => {
    insertPending(db, { gameId: 1, question: 'q', anchor: { ply: 0, path: [] } });
    markInterruptedChats(db);
    expect((await list())[0]).toMatchObject({ status: 'error', error: 'The server restarted. Try again.' });
  });

  describe('review card', () => {
    it('creates a card from the anchor with the best lines', async () => {
      const id = await askAndWait();
      const res = await post(`/api/chat/${id}/review-card`);
      expect(res.status).toBe(200);
      const { cardId } = (await res.json()) as { cardId: number };
      const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId)!;
      const fen = parsePgn(PGN).moves[1]!.fenAfter;
      expect(card).toMatchObject({ fen, prompt: 'Find the best move.', side_to_move: 'white' });
      expect(JSON.parse(card.refs_json as string)).toEqual([{ gameId: 1, ply: 2, source: 'chat' }]);
      expect(JSON.parse(card.solution_json as string).accepted).toHaveLength(3);
      const again = await post(`/api/chat/${id}/review-card`, { lineId: 't1.L2' });
      expect(((await again.json()) as { cardId: number }).cardId).toBe(cardId);
    });

    it('does not overwrite an existing mistake card at the same position', async () => {
      const id = await askAndWait();
      const fen = parsePgn(PGN).moves[1]!.fenAfter;
      const key = fen.split(' ').slice(0, 4).join(' ');
      db.prepare("INSERT INTO cards (kind, position_key, fen, side_to_move, prompt, solution_json, refs_json, created_at) VALUES ('mistake', ?, ?, 'white', 'old', '{\"accepted\":[\"a\"],\"best\":\"a\",\"explanation\":null}', '[]', 1)").run(key, fen);
      const { cardId } = (await (await post(`/api/chat/${id}/review-card`)).json()) as { cardId: number };
      expect(db.prepare('SELECT prompt FROM cards WHERE id = ?').get(cardId)!.prompt).toBe('old');
    });

    it('is 404 without a done answer or a known message, and 400 for an unknown line', async () => {
      expect((await post('/api/chat/99/review-card')).status).toBe(404);
      available = false;
      const failed = await askAndWait();
      expect((await post(`/api/chat/${failed}/review-card`)).status).toBe(404);
      available = true;
      reply = async () => ANSWER.replaceAll('t1.', 't2.');
      const ok = await askAndWait();
      expect((await post(`/api/chat/${ok}/review-card`, { lineId: 'nope' })).status).toBe(400);
    });
  });
});

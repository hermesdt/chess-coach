import { Chess } from 'chess.js';
import { beforeEach, describe, expect, it } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import type { GameAnalysis, MoveAnalysis, NewGame } from '../../shared/types.js';
import type { AiProvider } from '../ai/types.js';
import { createRegistry } from '../ai/registry.js';
import { saveAnalysis } from '../analysis/analysis-repo.js';
import { createApp } from '../app.js';
import { getRecord } from '../chat/chat-repo.js';
import { StreamHub } from '../chat/stream-hub.js';
import { parsePgn } from '../chess/pgn.js';
import { openDb } from '../db/db.js';
import { insertGames } from '../db/games-repo.js';
import { waitForJob } from '../jobs.js';

const PGN = '1. d4 Nf6 2. Bg5 h6 3. Bxh6 gxh6 *';
const newGame = (id: string): NewGame => ({
  source: 'chesscom', sourceId: id, playedAt: 1, timeClass: 'blitz', rated: true, white: 'Me', black: 'Opp', whiteElo: 600, blackElo: 650,
  userColor: 'white', result: 'loss', termination: null, eco: null, openingName: null, pgn: PGN, url: null, plyCount: 6,
});
function analysis(gameId: number): GameAnalysis {
  const ms: MoveAnalysis[] = parsePgn(PGN).moves.map((m) => ({
    ply: m.ply, san: m.san, uci: m.uci, color: m.ply % 2 === 1 ? 'white' : 'black', fenBefore: m.fenBefore,
    evalBefore: { cp: 20, mate: null }, evalAfter: { cp: -20, mate: null }, bestUci: m.uci, bestSan: m.san, pvSan: [m.san],
    winBefore: 55, winAfter: 50, winLoss: 5, classification: 'good', tags: [], isUserMove: m.ply % 2 === 1,
  }));
  return { gameId, version: 1, status: 'done', error: null, accuracyUser: 50, accuracyOpp: 50, counts: { blunder: 0, mistake: 0, inaccuracy: 0 }, moves: ms, keyMoments: [], analysedAt: 1 };
}
const pool = {
  analyse: async (fen: string) =>
    new Chess(fen).moves({ verbose: true }).slice(0, 3).map((m, i) => ({ multipv: i + 1, score: { cp: 40 - i * 10, mate: null }, pv: [m.from + m.to + (m.promotion ?? '')] })),
};
const json = (answer: string) => JSON.stringify({ answer, lines: [{ id: 't1.L1', why: 'It is the best try.' }], rule: 'Control the centre.', lessonId: null });
const tick = () => new Promise((r) => setTimeout(r, 5));

type Script = (onText: (raw: string) => void) => Promise<string>;
let db: DatabaseSync;
let hub: StreamHub;
let app: ReturnType<typeof createApp>;
let scripts: Script[];
let streamCalls: number;
let completeCalls: number;
let withStream: boolean;

beforeEach(() => {
  db = openDb(':memory:');
  insertGames(db, [newGame('a')]);
  saveAnalysis(db, analysis(1));
  hub = new StreamHub();
  scripts = [];
  streamCalls = 0;
  completeCalls = 0;
  withStream = true;
  const provider: AiProvider = {
    id: 'claude-cli', label: 'Fake', available: async () => ({ ok: true }),
    complete: async () => ((completeCalls += 1), { text: json('Whole answer.'), model: 'm-1' }),
    stream: async (_req, opts) => {
      const script = scripts[streamCalls++]!;
      return { text: await script(opts.onText), model: 'm-1' };
    },
  };
  if (!withStream) delete provider.stream;
  app = createApp({ db, pool, repertoires: [], ai: createRegistry({ db, providers: [provider] }), hub });
});

/** Runs a script that writes the JSON in pieces with small awaits. */
const pieces = (full: string, n = 12): Script => async (onText) => {
  const size = Math.ceil(full.length / n);
  for (let i = size; i < full.length + size; i += size) {
    onText(full.slice(0, Math.min(i, full.length)));
    await tick();
  }
  return full;
};

async function ask() {
  const res = await app.request('/api/games/1/chat', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'What now?', anchor: { ply: 2, path: [] } }),
  });
  return (await res.json()) as { messageId: number; jobId: number };
}

interface Sse { event: string; data: unknown }
function parseSse(buf: string): Sse[] {
  return buf.split('\n\n').flatMap((block) => {
    const ev = /^event: (.*)$/m.exec(block)?.[1];
    const data = /^data: (.*)$/m.exec(block)?.[1];
    return ev ? [{ event: ev, data: data ? JSON.parse(data) : null }] : [];
  });
}
async function readAll(res: Response): Promise<Sse[]> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
  }
  return parseSse(buf);
}

describe('GET /api/chat/:messageId/stream', () => {
  it('streams growing text, then done; the row holds the validated answer', async () => {
    scripts = [pieces(json('Look at the centre now.'))];
    const { messageId, jobId } = await ask();
    const events = await readAll(await app.request(`/api/chat/${messageId}/stream`));
    await waitForJob(db, jobId);
    const deltas = events.filter((e) => e.event === 'delta').map((e) => (e.data as { text: string }).text);
    expect(deltas.length).toBeGreaterThan(1);
    expect(deltas.at(-1)).toBe('Look at the centre now.');
    for (let i = 1; i < deltas.length; i++) expect(deltas[i]!.length).toBeGreaterThanOrEqual(deltas[i - 1]!.length);
    expect(events.at(-1)!.event).toBe('done');
    const rec = getRecord(db, messageId)!;
    expect(rec.status).toBe('done');
    expect(rec.answer!.answer).toBe('Look at the centre now.');
  });

  it('sets the status to streaming on the first delta', async () => {
    let seen: string | undefined;
    scripts = [async (onText) => {
      const raw = json('Hello there.');
      onText(raw.slice(0, 14));
      await tick();
      await tick();
      return raw;
    }];
    const { messageId, jobId } = await ask();
    for (let i = 0; i < 50 && seen !== 'streaming'; i++) {
      await tick();
      seen = getRecord(db, messageId)?.status === 'streaming' ? 'streaming' : seen;
    }
    await waitForJob(db, jobId);
    expect(seen).toBe('streaming');
  });

  it('a late subscriber gets the text so far first', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    scripts = [async (onText) => {
      const raw = json('Late text.');
      onText(raw.slice(0, 22));
      await gate;
      return raw;
    }];
    const { messageId, jobId } = await ask();
    for (let i = 0; i < 50 && !hub.last(messageId)?.text; i++) await tick();
    const res = await app.request(`/api/chat/${messageId}/stream`);
    release();
    const events = await readAll(res);
    await waitForJob(db, jobId);
    expect(events[0]).toMatchObject({ event: 'delta' });
    expect((events[0]!.data as { text: string }).text.length).toBeGreaterThan(0);
    expect(events.at(-1)!.event).toBe('done');
  });

  it('after a grounding failure sends retry, then the second answer, then done', async () => {
    scripts = [pieces(json('Play Qh5 at once.')), pieces(json('Fine second answer.'))];
    const { messageId, jobId } = await ask();
    const events = await readAll(await app.request(`/api/chat/${messageId}/stream`));
    await waitForJob(db, jobId);
    const names = events.map((e) => e.event);
    const retryAt = names.indexOf('retry');
    expect(retryAt).toBeGreaterThan(0);
    expect(names.slice(retryAt + 1)).toContain('delta');
    expect(names.at(-1)).toBe('done');
    expect(streamCalls).toBe(2);
    const rec = getRecord(db, messageId)!;
    expect(rec.status).toBe('done');
    expect(rec.answer!.answer).toBe('Fine second answer.');
    expect(JSON.stringify(rec.answer)).not.toContain('Qh5');
  });

  it('a client that disconnects mid-stream does not stop the job', async () => {
    scripts = [pieces(json('Still stored.'), 6)];
    const { messageId, jobId } = await ask();
    const res = await app.request(`/api/chat/${messageId}/stream`);
    const reader = res.body!.getReader();
    await reader.read();
    await reader.cancel();
    await waitForJob(db, jobId);
    const rec = getRecord(db, messageId)!;
    expect(rec.status).toBe('done');
    expect(rec.answer!.answer).toBe('Still stored.');
  });

  it('a stream that ends without a result turns the message into an error and sends error', async () => {
    scripts = [async (onText) => {
      onText(json('Partial').slice(0, 15));
      await tick();
      throw new Error('The coach CLI crashed.');
    }];
    const { messageId, jobId } = await ask();
    const events = await readAll(await app.request(`/api/chat/${messageId}/stream`));
    await waitForJob(db, jobId);
    expect(events.at(-1)!.event).toBe('error');
    expect((events.at(-1)!.data as { message: string }).message).toEqual(expect.any(String));
    const rec = getRecord(db, messageId)!;
    expect(rec.status).toBe('error');
    expect(rec.answer).toBeNull();
    expect(rec.error).toEqual(expect.any(String));
  });

  it('a provider without stream gives no delta, only done', async () => {
    withStream = false;
    const provider: AiProvider = {
      id: 'claude-cli', label: 'Fake', available: async () => ({ ok: true }),
      complete: async () => ((completeCalls += 1), { text: json('Whole answer.'), model: 'm-1' }),
    };
    app = createApp({ db, pool, repertoires: [], ai: createRegistry({ db, providers: [provider] }), hub });
    const { messageId, jobId } = await ask();
    const events = await readAll(await app.request(`/api/chat/${messageId}/stream`));
    await waitForJob(db, jobId);
    expect(events.map((e) => e.event)).toEqual(['done']);
    expect(completeCalls).toBe(1);
    expect(streamCalls).toBe(0);
  });

  it('sends the end event at once for a finished message, even without hub state', async () => {
    scripts = [pieces(json('Done already.'))];
    const { messageId, jobId } = await ask();
    await waitForJob(db, jobId);
    const fresh = createApp({ db, pool, repertoires: [], ai: createRegistry({ db, providers: [] }), hub: new StreamHub() });
    expect((await readAll(await fresh.request(`/api/chat/${messageId}/stream`))).map((e) => e.event)).toEqual(['done']);
    db.prepare("UPDATE chat_messages SET status = 'error', error = 'Boom.' WHERE id = ?").run(messageId);
    const events = await readAll(await fresh.request(`/api/chat/${messageId}/stream`));
    expect(events).toEqual([{ event: 'error', data: { message: 'Boom.' } }]);
  });

  it('answers 404 for an unknown message and keeps the local-only Host guard', async () => {
    expect((await app.request('/api/chat/999/stream')).status).toBe(404);
    expect((await app.request('/api/chat/999/stream', { headers: { host: 'evil.example' } })).status).toBe(403);
  });

  it('refuses a second question while a message is streaming', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    scripts = [async (onText) => {
      const raw = json('Slow.');
      onText(raw.slice(0, 20));
      await gate;
      return raw;
    }];
    const { messageId, jobId } = await ask();
    for (let i = 0; i < 50 && getRecord(db, messageId)?.status !== 'streaming'; i++) await tick();
    const second = await app.request('/api/games/1/chat', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: 'Again?', anchor: { ply: 2, path: [] } }),
    });
    expect(second.status).toBe(409);
    release();
    await waitForJob(db, jobId);
  });
});

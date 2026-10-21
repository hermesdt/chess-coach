import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { GameAnalysis, MoveAnalysis } from '../../shared/types.js';
import { saveAnalysis } from '../analysis/analysis-repo.js';
import { createApp } from '../app.js';
import { parsePgn } from '../chess/pgn.js';
import { openDb } from '../db/db.js';
import { waitForJob } from '../jobs.js';
import { listCardsByRef, upsertCard } from '../srs/cards-repo.js';
import { reviewGame, coachErrorMessage, promptVersionFor, GAME_REVIEW_JSON_SCHEMA } from './game-review.js';
import { listNotes } from './notes-repo.js';
import { createRegistry } from './registry.js';
import { AiCancelledError, AiGroundingError, AiRefusalError, AiTimeoutError, type AiProvider, type ProviderId } from './types.js';

const PGN = '1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0';
const { moves } = parsePgn(PGN);

function mv(ply: number, over: Partial<MoveAnalysis> = {}): MoveAnalysis {
  const info = moves[ply - 1]!;
  return {
    ply, san: info.san, uci: info.uci, color: ply % 2 === 1 ? 'white' : 'black', fenBefore: info.fenBefore,
    evalBefore: { cp: 0, mate: null }, evalAfter: { cp: 0, mate: null },
    bestUci: 'g1f3', bestSan: 'Nf3', pvSan: ['Nf3', 'Nc6', 'Bc4'], winBefore: 80, winAfter: 40, winLoss: 40,
    classification: 'blunder', tags: ['hung_piece'], isUserMove: ply % 2 === 1, ...over,
  };
}
const analysis: GameAnalysis = {
  gameId: 1, version: 1, status: 'done', error: null, accuracyUser: 70, accuracyOpp: 60,
  counts: { blunder: 1, mistake: 0, inaccuracy: 0 }, analysedAt: 1, keyMoments: [],
  moves: [mv(1, { classification: 'best', tags: [], winLoss: 0 }), mv(3)],
};

const review = (over: Record<string, unknown> = {}) => ({
  summary: 'You played an active game.',
  openingNote: 'You opened with e4. Good start.',
  moments: [{ ply: 3, whatHappened: 'You played Qh5 too early.', whyItMatters: 'The queen can be chased. Nf3 builds your game.', principle: 'Develop knights first.', lessonId: 'develop' }],
  oneThingToPractice: 'Develop your knights before your queen.',
  ...over,
});

let db: DatabaseSync;
let calls: { provider: ProviderId; user: string; model: string | null }[];
let reply: (id: ProviderId) => string;

function fake(id: ProviderId): AiProvider {
  return {
    id, label: id, available: async () => ({ ok: true }),
    complete: async (req, o) => {
      calls.push({ provider: id, user: req.user, model: o.model });
      return { text: reply(id), model: `${id}-model` };
    },
  };
}
const registry = () => createRegistry({ db, providers: [fake('claude-cli'), fake('codex-cli')] });

beforeEach(() => {
  db = openDb(':memory:');
  db.exec(`INSERT INTO games (id, source, source_id, played_at, time_class, rated, white, black, white_elo, black_elo, user_color, result, opening_name, pgn, ply_count, imported_at)
    VALUES (1, 'chesscom', 'a', 1, 'blitz', 1, 'Me', 'Opp', 800, 850, 'white', 'win', 'King''s Pawn Game', '${PGN}', 7, 1)`);
  saveAnalysis(db, analysis);
  calls = [];
  reply = () => JSON.stringify(review());
});

describe('reviewGame', () => {
  it('returns a note, stores it, and sends facts with the level', async () => {
    const note = await reviewGame(db, registry(), 1, {});
    expect(note).toMatchObject({ provider: 'claude-cli', model: 'claude-cli-model' });
    expect(note.review.moments).toHaveLength(1);
    expect(calls[0]!.user).toContain('"played": "Qh5"');
    expect(listNotes(db, 'game:1', promptVersionFor(1), 1)).toHaveLength(1);
  });

  it('drops moments with a ply that is not a key moment', async () => {
    reply = () => JSON.stringify(review({ moments: [...review().moments, { ply: 9, whatHappened: 'x', whyItMatters: 'y', principle: 'z', lessonId: null }] }));
    const note = await reviewGame(db, registry(), 1, {});
    expect(note.review.moments.map((m) => m.ply)).toEqual([3]);
  });

  it('keeps only the first moment of a duplicated ply', async () => {
    const dup = { ...review().moments[0]!, whatHappened: 'Second take.' };
    reply = () => JSON.stringify(review({ moments: [...review().moments, dup] }));
    const note = await reviewGame(db, registry(), 1, {});
    expect(note.review.moments).toHaveLength(1);
    expect(note.review.moments[0]!.whatHappened).toBe('You played Qh5 too early.');
  });

  it('accepts a review without moments', async () => {
    reply = () => JSON.stringify(review({ moments: [] }));
    expect((await reviewGame(db, registry(), 1, {})).review.moments).toEqual([]);
  });

  it('flags a moment that recommends a move played later in the game', async () => {
    const moment = { ...review().moments[0]!, whyItMatters: 'Qxf7 would have been stronger.' };
    reply = () => JSON.stringify(review({ moments: [moment] }));
    await expect(reviewGame(db, registry(), 1, {})).rejects.toBeInstanceOf(AiGroundingError);
    reply = () => JSON.stringify(review({ summary: 'The game ended with Qxf7.', moments: [] }));
    await expect(reviewGame(db, registry(), 1, {})).resolves.toBeDefined();
  });

  it('keys the cache by the requested model, not by the model the provider reports', async () => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('ai_model_claude-cli', 'sonnet')").run();
    const first = await reviewGame(db, registry(), 1, {});
    expect(first.model).toBe('claude-cli-model');
    const again = await reviewGame(db, registry(), 1, {});
    expect(calls).toHaveLength(1);
    expect(again.model).toBe('claude-cli-model');
    expect(listNotes(db, 'game:1', promptVersionFor(1), 1)[0]!.model).toBe('claude-cli-model');
  });

  it('asks again when the configured model changes', async () => {
    await reviewGame(db, registry(), 1, {});
    db.prepare("INSERT INTO settings (key, value) VALUES ('ai_model_claude-cli', 'opus')").run();
    await reviewGame(db, registry(), 1, {});
    expect(calls).toHaveLength(2);
  });

  it('tells the caller which provider it asks', async () => {
    const asked: string[] = [];
    await reviewGame(db, registry(), 1, { onProvider: (p) => asked.push(p.label) });
    await reviewGame(db, registry(), 1, { onProvider: (p) => asked.push(p.label) });
    expect(asked).toEqual(['claude-cli']);
  });

  it('serves the cache on the second call', async () => {
    await reviewGame(db, registry(), 1, {});
    const again = await reviewGame(db, registry(), 1, {});
    expect(calls).toHaveLength(1);
    expect(again.review.summary).toBe('You played an active game.');
  });

  it('creates a second note for a second provider without calling the first again', async () => {
    await reviewGame(db, registry(), 1, {});
    await reviewGame(db, registry(), 1, { provider: 'codex-cli' });
    await reviewGame(db, registry(), 1, { provider: 'codex-cli' });
    await reviewGame(db, registry(), 1, { provider: 'claude-cli' });
    expect(calls.map((c) => c.provider)).toEqual(['claude-cli', 'codex-cli']);
  });

  it('rejects a reply with a move that is not in the facts', async () => {
    reply = () => JSON.stringify(review({ summary: 'You should have played Bb5 and then Qxd7.' }));
    await expect(reviewGame(db, registry(), 1, {})).rejects.toBeInstanceOf(AiGroundingError);
    expect(calls).toHaveLength(2);
  });

  it('fails when no provider is available', async () => {
    const none = createRegistry({ db, providers: [] });
    await expect(reviewGame(db, none, 1, {})).rejects.toThrow('AI not configured. Choose a provider in Settings.');
  });

  it('fails when the game is not analysed', async () => {
    db.exec('DELETE FROM game_analysis');
    await expect(reviewGame(db, registry(), 1, {})).rejects.toThrow('Analyse this game first.');
  });

  it('uses the whyItMatters of the note as mistake card explanation, only for that ply', async () => {
    const card = (key: string, ref: { gameId: number; ply: number }) => upsertCard(db, {
      kind: 'mistake', positionKey: key, fen: key, sideToMove: 'white', prompt: 'p',
      solution: { accepted: ['g1f3'], best: 'g1f3', explanation: 'Blunder — You left a piece undefended.' }, refs: [ref], lastMove: null,
    });
    const hit = card('k1', { gameId: 1, ply: 3 });
    const other = card('k2', { gameId: 1, ply: 5 });
    const elsewhere = card('k3', { gameId: 2, ply: 3 });
    await reviewGame(db, registry(), 1, {});
    const byId = (id: number) => listCardsByRef(db, 1).find((c) => c.id === id);
    expect(byId(hit.id)!.solution.explanation).toBe('Blunder — You left a piece undefended. The queen can be chased. Nf3 builds your game.');
    expect(byId(other.id)!.solution.explanation).toBe('Blunder — You left a piece undefended.');
    expect(listCardsByRef(db, 2).find((c) => c.id === elsewhere.id)!.solution.explanation).toBe('Blunder — You left a piece undefended.');
  });
});

describe('schema and errors', () => {
  it('uses a strict JSON schema', () => {
    const s = GAME_REVIEW_JSON_SCHEMA as { additionalProperties: boolean; required: string[]; properties: { moments: { items: { additionalProperties: boolean; required: string[] } } } };
    expect(s.additionalProperties).toBe(false);
    expect([...s.required].sort()).toEqual(['moments', 'oneThingToPractice', 'openingNote', 'summary']);
    const item = s.properties.moments.items;
    expect(item.additionalProperties).toBe(false);
    expect([...item.required].sort()).toEqual(['lessonId', 'ply', 'principle', 'whatHappened', 'whyItMatters']);
  });

  it('maps errors to plain messages', () => {
    expect(coachErrorMessage(new AiGroundingError(['Bb5']))).toBe('The coach answer mentioned moves I could not verify. Try again or use another provider.');
    expect(coachErrorMessage(new AiTimeoutError('x'))).toBe('The coach took too long. Try again or use another provider.');
    expect(coachErrorMessage(new AiCancelledError('x'))).toBe('Cancelled.');
    expect(coachErrorMessage(new AiRefusalError('x'))).toBe('The provider declined this request. Try another provider.');
    expect(coachErrorMessage(new Error('boom'))).toBe('boom');
  });
});

describe('notes after a re-analysis', () => {
  it('shows the notes of an older analysis version, marked, until a new review exists', async () => {
    const app = createApp({ db, ai: registry() });
    const post = () => app.request('/api/games/1/coach', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    await waitForJob(db, ((await (await post()).json()) as { jobId: number }).jobId);
    const read = async () => (await (await app.request('/api/games/1/coach')).json()) as { provider: string; olderAnalysis?: boolean }[];
    expect(await read()).toEqual([expect.not.objectContaining({ olderAnalysis: true })]);
    // Re-analysis: the stored analysis gets a newer version.
    db.prepare('UPDATE game_analysis SET version = version + 1 WHERE game_id = 1').run();
    expect(await read()).toEqual([expect.objectContaining({ provider: 'claude-cli', olderAnalysis: true })]);
    // A new review for the new version replaces the fallback.
    await waitForJob(db, ((await (await post()).json()) as { jobId: number }).jobId);
    const fresh = await read();
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).not.toHaveProperty('olderAnalysis');
  });
});

describe('routes', () => {
  it('POST starts a coach job and GET lists notes newest first', async () => {
    const app = createApp({ db, ai: registry() });
    const post = (body: unknown) => app.request('/api/games/1/coach', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const { jobId } = (await (await post({})).json()) as { jobId: number };
    expect((await waitForJob(db, jobId)).status).toBe('done');
    const second = (await (await post({ provider: 'codex-cli' })).json()) as { jobId: number };
    await waitForJob(db, second.jobId);
    const notes = (await (await app.request('/api/games/1/coach')).json()) as { provider: string; review: unknown }[];
    expect(notes.map((n) => n.provider)).toEqual(['codex-cli', 'claude-cli']);
    expect(notes[0]).toHaveProperty('review.summary');
  });

  it('shows who the coach job asks while it runs', async () => {
    let seen: string | null = null;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const slow: AiProvider = { ...fake('claude-cli'), label: 'Claude Code CLI', complete: async () => { await gate; return { text: reply('claude-cli'), model: 'm' }; } };
    const app = createApp({ db, ai: createRegistry({ db, providers: [slow] }) });
    const res = await app.request('/api/games/1/coach', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const { jobId } = (await res.json()) as { jobId: number };
    for (let i = 0; i < 50 && seen === null; i++) {
      await new Promise((r) => setTimeout(r, 10));
      seen = ((await (await app.request(`/api/jobs/${jobId}`)).json()) as { message: string | null }).message;
    }
    release();
    await waitForJob(db, jobId);
    expect(seen).toBe('Asking Claude Code CLI…');
  });

  it('reports a friendly job error', async () => {
    reply = () => JSON.stringify(review({ summary: 'Try Bb5 now.' }));
    const app = createApp({ db, ai: registry() });
    const res = await app.request('/api/games/1/coach', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const { jobId } = (await res.json()) as { jobId: number };
    const job = await waitForJob(db, jobId);
    expect(job).toMatchObject({ kind: 'coach', status: 'error', error: 'The coach answer mentioned moves I could not verify. Try again or use another provider.' });
  });

  it('validates the game and the provider', async () => {
    const app = createApp({ db, ai: registry() });
    const post = (path: string, body: unknown) => app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect((await post('/api/games/99/coach', {})).status).toBe(404);
    expect((await post('/api/games/1/coach', { provider: 'nope' })).status).toBe(400);
    expect((await app.request('/api/games/99/coach')).status).toBe(404);
  });
});

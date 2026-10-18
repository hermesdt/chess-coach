import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import type { GameAnalysis, MoveAnalysis, Tag } from '../../shared/types.js';
import { saveAnalysis } from '../analysis/analysis-repo.js';
import { createApp } from '../app.js';
import { openDb } from '../db/db.js';
import { waitForJob } from '../jobs.js';
import { createRegistry } from './registry.js';
import { AiGroundingError, type AiProvider, type ProviderId } from './types.js';
import { WEAKNESS_JSON_SCHEMA, latestWeakness, weaknessFacts, weaknessReport } from './weakness.js';

let db: DatabaseSync;
let calls: { provider: ProviderId; user: string }[];
let reply: () => string;

function mv(ply: number, over: Partial<MoveAnalysis> = {}): MoveAnalysis {
  return {
    ply, san: 'Qh5', uci: 'd1h5', color: ply % 2 === 1 ? 'white' : 'black', fenBefore: 'x',
    evalBefore: { cp: 0, mate: null }, evalAfter: { cp: 0, mate: null },
    bestUci: 'g1f3', bestSan: 'Nf3', pvSan: ['Nf3', 'Nc6'], winBefore: 80, winAfter: 40, winLoss: 40,
    classification: 'blunder', tags: ['hung_piece'], isUserMove: ply % 2 === 1, ...over,
  };
}
function game(id: number, playedAt: number, opts: { moves: MoveAnalysis[]; status?: GameAnalysis['status']; opening?: string; result?: string }): void {
  db.prepare(`INSERT INTO games (id, source, source_id, played_at, time_class, rated, white, black, white_elo, black_elo, user_color, result, opening_name, pgn, ply_count, imported_at)
    VALUES (?, 'chesscom', ?, ?, 'blitz', 1, 'Me', 'Opp', 800, 850, 'white', ?, ?, '1. e4 *', 7, 1)`)
    .run(id, `g${id}`, playedAt, opts.result ?? 'loss', opts.opening ?? 'Scotch Game');
  saveAnalysis(db, {
    gameId: id, version: 1, status: opts.status ?? 'done', error: null, accuracyUser: 70, accuracyOpp: 60,
    counts: { blunder: 0, mistake: 0, inaccuracy: 0 }, analysedAt: 1, keyMoments: [], moves: opts.moves,
  });
}
const report = (over: Record<string, unknown> = {}) => ({
  headline: 'You hang pieces a lot.',
  weaknesses: [{ title: 'Hanging pieces', rule: 'Check what each piece defends before you move.', lessonId: 'blunder-check', focus: 'Look at the square you move to.' }],
  encouragement: 'You are improving. Keep going.',
  ...over,
});

function fake(id: ProviderId): AiProvider {
  return { id, label: id, available: async () => ({ ok: true }), complete: async (req) => { calls.push({ provider: id, user: req.user }); return { text: reply(), model: `${id}-model` }; } };
}
const registry = () => createRegistry({ db, providers: [fake('claude-cli'), fake('codex-cli')] });

beforeEach(() => {
  db = openDb(':memory:');
  calls = [];
  reply = () => JSON.stringify(report());
});

describe('weaknessFacts', () => {
  it('counts tags only from user moves of analysed games within the last N', () => {
    game(1, 1, { moves: [mv(1, { tags: ['no_castle'] })] }); // oldest, outside last 2
    game(2, 2, { moves: [mv(1), mv(2, { tags: ['hung_piece'], isUserMove: false }), mv(3, { tags: ['hung_piece', 'bad_trade'] })] });
    game(3, 3, { moves: [mv(1)] });
    game(4, 4, { status: 'pending', moves: [mv(1), mv(3)] });
    const facts = weaknessFacts(db, 2);
    expect(facts.games).toBe(2);
    expect(facts.tagCounts).toMatchObject({ hung_piece: 3, bad_trade: 1, no_castle: 0 } satisfies Partial<Record<Tag, number>>);
    expect(Object.keys(facts.tagCounts)).toHaveLength(9);
  });

  it('groups openings by name and result, and returns up to 6 recent examples', () => {
    for (let i = 1; i <= 4; i++) game(i, i, { opening: i < 4 ? 'Scotch Game' : 'Italian', result: i === 1 ? 'win' : 'loss', moves: [mv(1), mv(3)] });
    const facts = weaknessFacts(db);
    expect(facts.byOpening).toContainEqual({ name: 'Scotch Game', color: 'white', games: 3, win: 1, draw: 0, loss: 2 });
    expect(facts.examples).toHaveLength(6);
    expect(facts.examples[0]).toMatchObject({ played: 'Qh5', best: 'Nf3' });
  });

  it('prefers the repertoire name from opening events', () => {
    game(1, 1, { opening: 'Scotch Game', moves: [mv(1)] });
    db.prepare("INSERT INTO opening_events (game_id, repertoire_id, kind) VALUES (1, 'london', 'leak')").run();
    const facts = weaknessFacts(db, 30, [{ id: 'london', name: 'London System', color: 'white' } as never]);
    expect(facts.byOpening.map((o) => o.name)).toEqual(['London System']);
  });
});

describe('weaknessReport', () => {
  it('fails without calling the AI when no game is analysed', async () => {
    game(1, 1, { status: 'pending', moves: [mv(1)] });
    await expect(weaknessReport(db, registry(), {})).rejects.toThrow('Analyse a few games first.');
    expect(calls).toHaveLength(0);
  });

  it('stores the report and reuses the cache for identical facts', async () => {
    game(1, 1, { moves: [mv(1)] });
    const first = await weaknessReport(db, registry(), {});
    const again = await weaknessReport(db, registry(), {});
    expect(calls).toHaveLength(1);
    expect(again.report).toEqual(first.report);
    expect(latestWeakness(db)?.report.headline).toBe('You hang pieces a lot.');
  });

  it('keys the cache by the requested model, not the reported one', async () => {
    db.prepare("INSERT INTO settings (key, value) VALUES ('ai_model_claude-cli', 'sonnet')").run();
    game(1, 1, { moves: [mv(1)] });
    const first = await weaknessReport(db, registry(), {});
    const again = await weaknessReport(db, registry(), {});
    expect(calls).toHaveLength(1);
    expect(first.model).toBe('claude-cli-model');
    expect(again.model).toBe('claude-cli-model');
  });

  it('calls again when the facts change, and per provider', async () => {
    game(1, 1, { moves: [mv(1)] });
    await weaknessReport(db, registry(), {});
    await weaknessReport(db, registry(), { provider: 'codex-cli' });
    game(2, 2, { moves: [mv(1)] });
    await weaknessReport(db, registry(), {});
    expect(calls.map((c) => c.provider)).toEqual(['claude-cli', 'codex-cli', 'claude-cli']);
  });

  it('rejects an unknown lessonId', async () => {
    game(1, 1, { moves: [mv(1)] });
    reply = () => JSON.stringify(report({ weaknesses: [{ ...report().weaknesses[0], lessonId: 'nope' }] }));
    await expect(weaknessReport(db, registry(), {})).rejects.toThrow(/lessonId/);
    expect(calls).toHaveLength(2);
  });

  it('rejects more than 3 weaknesses and none when tags exist', async () => {
    game(1, 1, { moves: [mv(1)] });
    reply = () => JSON.stringify(report({ weaknesses: Array(4).fill(report().weaknesses[0]) }));
    await expect(weaknessReport(db, registry(), {})).rejects.toThrow();
    reply = () => JSON.stringify(report({ weaknesses: [] }));
    await expect(weaknessReport(db, registry(), {})).rejects.toThrow();
  });

  it('allows no weaknesses when there are no tags', async () => {
    game(1, 1, { moves: [mv(1, { tags: [], classification: 'best', winLoss: 0 })] });
    reply = () => JSON.stringify(report({ weaknesses: [] }));
    expect((await weaknessReport(db, registry(), {})).report.weaknesses).toEqual([]);
  });

  it('rejects a move that is not in the facts', async () => {
    game(1, 1, { moves: [mv(1)] });
    reply = () => JSON.stringify(report({ headline: 'You should play Bb5 and Qxd7.' }));
    await expect(weaknessReport(db, registry(), {})).rejects.toBeInstanceOf(AiGroundingError);
  });

  it('has a strict JSON schema', () => {
    const s = WEAKNESS_JSON_SCHEMA as { required: string[]; additionalProperties: boolean };
    expect(s.additionalProperties).toBe(false);
    expect([...s.required].sort()).toEqual(['encouragement', 'headline', 'weaknesses']);
  });
});

describe('routes', () => {
  it('GET is null at first, POST runs a job, GET returns the note', async () => {
    game(1, 1, { moves: [mv(1)] });
    const app = createApp({ db, ai: registry(), repertoires: [] });
    expect(await (await app.request('/api/coach/weakness')).json()).toBeNull();
    const post = (body: unknown) => app.request('/api/coach/weakness', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const { jobId } = (await (await post({})).json()) as { jobId: number };
    expect((await waitForJob(db, jobId)).status).toBe('done');
    const note = (await (await app.request('/api/coach/weakness')).json()) as { provider: string; report: { headline: string } };
    expect(note).toMatchObject({ provider: 'claude-cli', report: { headline: 'You hang pieces a lot.' } });
    expect((await post({ provider: 'nope' })).status).toBe(400);
  });

  it('answers 400 when no game is analysed and gives a friendly job error', async () => {
    const app = createApp({ db, ai: registry(), repertoires: [] });
    const res = await app.request('/api/coach/weakness', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Analyse a few games first.' });
    game(1, 1, { moves: [mv(1)] });
    reply = () => JSON.stringify(report({ headline: 'Try Bb5 now.' }));
    const { jobId } = (await (await app.request('/api/coach/weakness', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json()) as { jobId: number };
    expect(await waitForJob(db, jobId)).toMatchObject({ status: 'error', error: 'The coach answer mentioned moves I could not verify. Try again or use another provider.' });
  });
});

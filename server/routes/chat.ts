import type { DatabaseSync } from 'node:sqlite';
import { Chess } from 'chess.js';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { askCoach } from '../ai/chat.js';
import { coachErrorMessage, loadGame } from '../ai/game-review.js';
import type { Registry } from '../ai/registry.js';
import { PROVIDER_IDS, type ProviderId } from '../ai/types.js';
import { getAnalysis } from '../analysis/analysis-repo.js';
import { chatCard } from '../chat/chat-card.js';
import {
  canonicalGameId, completeMessage, doneTurns, failMessage, getRecord, hasPending, insertPending, listRecords, markStreaming, resetToPending, savePack, toDto,
  type ChatRecord,
} from '../chat/chat-repo.js';
import type { StreamEvent, StreamHub } from '../chat/stream-hub.js';
import { buildFactPack, describeAnchorOf } from '../chat/fact-pack.js';
import { getSettings, type ResolvedSettings } from '../config.js';
import type { EnginePool } from '../engine/pool.js';
import { runJob } from '../jobs.js';
import { currentLevel } from '../level.js';
import type { Repertoire } from '../repertoire/types.js';
import { upsertCard } from '../srs/cards-repo.js';

export const NO_COACH = 'No AI coach is set up. Open Settings.';
const MAX_QUESTION = 2000;
const UCI = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

const parseId = (raw: string): number | null => (/^\d+$/.test(raw) ? Number(raw) : null);

/** Checks the anchor against the game. Returns an error text, or null when the anchor is fine. */
function anchorError(db: DatabaseSync, gameId: number, anchor: unknown): string | null {
  const a = anchor as { ply?: unknown; path?: unknown } | null;
  if (!a || !Number.isInteger(a.ply) || !Array.isArray(a.path) || !a.path.every((u) => typeof u === 'string' && UCI.test(u))) return 'Bad anchor.';
  const game = loadGame(db, gameId);
  const ply = a.ply as number;
  if (!game || ply < 0 || ply > game.moves.length) return 'The position is outside the game.';
  const chess = new Chess(ply === 0 ? game.startFen : game.moves[ply - 1]!.fenAfter);
  for (const u of a.path as string[]) {
    try {
      chess.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u.length > 4 ? u.slice(4) : undefined });
    } catch {
      return 'The branch has an illegal move.';
    }
  }
  return null;
}

export function chatRoutes(db: DatabaseSync, registry: Registry, pool: Pick<EnginePool, 'analyse'>, getReps: () => Repertoire[], hub: StreamHub): Hono {
  const HEARTBEAT_MS = 15_000;

  /** Runs the answer for a pending message as a job. The result goes on the message row. */
  function startAnswer(rec: ChatRecord, requested: ProviderId | undefined): number {
    hub.reset(rec.id);
    return runJob(db, 'chat', async (report) => {
      let settings: ResolvedSettings | null = null;
      let providerId: ProviderId | null = null;
      try {
        settings = getSettings(db);
        const provider = await registry.pick(requested ?? settings.aiProvider);
        if (!provider) {
          failMessage(db, rec.id, NO_COACH);
          hub.publish(rec.id, { type: 'error', message: NO_COACH });
          return;
        }
        providerId = provider.id;
        report(0, null, `Asking ${provider.label}…`);
        const pack = await buildFactPack(
          { db, pool, reps: getReps(), nodes: settings.engineNodes },
          { gameId: rec.gameId, anchor: { ply: rec.anchor.ply, path: rec.anchor.path }, question: rec.question, turn: rec.turn },
        );
        savePack(db, rec.id, pack);
        const prior = doneTurns(db, rec.gameId, rec.turn);
        const { level, rating } = currentLevel(db);
        let streaming = false;
        const { answer, model } = await askCoach(provider, {
          pack,
          question: rec.question,
          history: prior.map((t) => ({ question: t.question, anchorDescribe: t.anchor.describe, answer: t.answer })),
          earlierPacks: prior.map((t) => t.pack),
          level,
          rating,
          model: settings.aiModels[provider.id] ?? null,
          onText: (text) => {
            if (!streaming) {
              streaming = true;
              markStreaming(db, rec.id);
            }
            hub.publish(rec.id, { type: 'delta', text });
          },
          onRetry: () => hub.publish(rec.id, { type: 'retry' }),
        });
        completeMessage(db, rec.id, { answer, provider: provider.id, model });
        hub.publish(rec.id, { type: 'done' });
      } catch (err) {
        const message = coachErrorMessage(err, [settings?.openrouterApiKey ?? null, settings?.anthropicApiKey ?? null]);
        failMessage(db, rec.id, message, providerId);
        hub.publish(rec.id, { type: 'error', message });
      }
    }).id;
  }

  const providerOf = (body: { provider?: unknown } | null): ProviderId | undefined | 'bad' => {
    const p = body?.provider;
    if (p === undefined) return undefined;
    return (PROVIDER_IDS as readonly unknown[]).includes(p) ? (p as ProviderId) : 'bad';
  };

  return new Hono()
    .get('/games/:id/chat', (c) => {
      const id = parseId(c.req.param('id'));
      const gameId = id === null ? null : canonicalGameId(db, id);
      if (gameId === null) return c.json({ error: 'not found' }, 404);
      return c.json(listRecords(db, gameId).map(toDto));
    })
    .post('/games/:id/chat', async (c) => {
      const id = parseId(c.req.param('id'));
      const gameId = id === null ? null : canonicalGameId(db, id);
      if (gameId === null) return c.json({ error: 'not found' }, 404);
      const body = (await c.req.json().catch(() => null)) as { question?: unknown; anchor?: unknown; provider?: unknown } | null;
      const question = typeof body?.question === 'string' ? body.question.trim() : '';
      if (question === '' || question.length > MAX_QUESTION) return c.json({ error: 'Write a question of up to 2000 characters.' }, 400);
      const provider = providerOf(body);
      if (provider === 'bad') return c.json({ error: 'unknown provider' }, 400);
      const bad = anchorError(db, gameId, body?.anchor);
      if (bad) return c.json({ error: bad }, 400);
      if (getAnalysis(db, gameId)?.status !== 'done') return c.json({ error: 'Analyse this game first.' }, 409);
      if (hasPending(db, gameId)) return c.json({ error: 'The coach is already answering. Wait for the answer.' }, 409);
      const anchor = body!.anchor as { ply: number; path: string[] };
      const describe = describeAnchorOf(loadGame(db, gameId)!, anchor);
      const rec = insertPending(db, { gameId, question, anchor: { ply: anchor.ply, path: anchor.path, describe } });
      return c.json({ messageId: rec.id, jobId: startAnswer(rec, provider) });
    })
    .get('/chat/:messageId/stream', (c) => {
      const id = parseId(c.req.param('messageId'));
      const rec = id === null ? null : getRecord(db, id);
      if (!rec) return c.json({ error: 'not found' }, 404);
      return streamSSE(c, async (stream) => {
        const send = (e: StreamEvent) => stream.writeSSE({ event: e.type, data: JSON.stringify(e.type === 'delta' ? { text: e.text } : e.type === 'error' ? { message: e.message } : {}) });
        const now = getRecord(db, rec.id) ?? rec;
        if (now.status === 'done' || now.status === 'error') {
          await send(now.status === 'done' ? { type: 'done' } : { type: 'error', message: now.error ?? 'The coach could not answer.' });
          return;
        }
        let finish!: () => void;
        const finished = new Promise<void>((resolve) => (finish = resolve));
        let chain: Promise<unknown> = Promise.resolve();
        const push = (e: StreamEvent) => {
          chain = chain.then(() => send(e)).catch(() => finish());
          if (e.type === 'done' || e.type === 'error') chain = chain.then(finish);
        };
        const unsubscribe = hub.subscribe(rec.id, push);
        const heartbeat = setInterval(() => void stream.write(': ping\n\n').catch(() => finish()), HEARTBEAT_MS);
        stream.onAbort(finish);
        const known = hub.last(rec.id);
        if (known?.text) push({ type: 'delta', text: known.text });
        if (known?.end) push(known.end);
        await finished;
        clearInterval(heartbeat);
        unsubscribe();
        await chain;
      });
    })
    .post('/chat/:messageId/retry', async (c) => {
      const id = parseId(c.req.param('messageId'));
      const rec = id === null ? null : getRecord(db, id);
      if (!rec) return c.json({ error: 'not found' }, 404);
      const provider = providerOf((await c.req.json().catch(() => null)) as { provider?: unknown } | null);
      if (provider === 'bad') return c.json({ error: 'unknown provider' }, 400);
      if (rec.status !== 'error') return c.json({ error: 'Only a failed answer can be tried again.' }, 409);
      if (hasPending(db, rec.gameId)) return c.json({ error: 'The coach is already answering. Wait for the answer.' }, 409);
      resetToPending(db, rec.id);
      return c.json({ jobId: startAnswer({ ...rec, status: 'pending' }, provider) });
    })
    .post('/chat/:messageId/review-card', async (c) => {
      const id = parseId(c.req.param('messageId'));
      const rec = id === null ? null : getRecord(db, id);
      if (!rec || rec.status !== 'done' || !rec.pack) return c.json({ error: 'not found' }, 404);
      const body = (await c.req.json().catch(() => null)) as { lineId?: unknown } | null;
      if (body?.lineId !== undefined && typeof body.lineId !== 'string') return c.json({ error: 'Bad line.' }, 400);
      let draft;
      try {
        draft = chatCard(rec.pack, { id: rec.gameId }, body?.lineId);
      } catch (err) {
        return c.json({ error: err instanceof Error ? err.message : 'Bad line.' }, 400);
      }
      // A mistake card of the same position already trains it; keep its solution.
      const existing = db.prepare("SELECT id FROM cards WHERE kind = 'mistake' AND position_key = ?").get(draft.positionKey);
      if (existing) return c.json({ cardId: existing.id as number });
      return c.json({ cardId: upsertCard(db, draft).id });
    });
}

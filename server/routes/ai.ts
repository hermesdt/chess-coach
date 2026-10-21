import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { z } from 'zod';
import { toStrictJsonSchema } from '../ai/json-schema.js';
import { runStructured } from '../ai/runner.js';
import type { Registry } from '../ai/registry.js';
import { getSettings } from '../config.js';
import { analysisStatus } from '../analysis/analysis-repo.js';
import { coachErrorMessage, gameNotes, reviewGame } from '../ai/game-review.js';
import { weaknessFacts, latestWeakness, weaknessReport, NO_GAMES } from '../ai/weakness.js';
import type { Repertoire } from '../repertoire/types.js';
import { PROVIDER_IDS, type ProviderId } from '../ai/types.js';
import { getGameRow } from '../db/games-repo.js';
import { runJob } from '../jobs.js';

const TEST_TIMEOUT_MS = 60_000;
const testSchema = z.object({ ok: z.boolean() });

/** Removes API keys (the stored ones and anything key-shaped) from text that may reach the client. */
function redact(text: string, secrets: (string | null)[]): string {
  let out = text;
  for (const secret of secrets) if (secret && secret.length >= 4) out = out.replaceAll(secret, '[redacted]');
  return out
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, '[redacted]');
}

export function aiRoutes(db: DatabaseSync, registry: Registry, timeoutMs = TEST_TIMEOUT_MS, getReps: () => Repertoire[] = () => []): Hono {
  return new Hono()
    .get('/ai/providers', async (c) => {
      const { aiModels } = getSettings(db);
      const rows = await Promise.all(
        registry.list().map(async (p) => {
          const a = await p.available().catch(() => ({ ok: false, reason: 'Availability check failed' }));
          return { id: p.id, label: p.label, ok: a.ok, reason: a.reason ?? null, model: aiModels[p.id] };
        }),
      );
      return c.json(rows);
    })
    .get('/games/:id/coach', (c) => {
      const id = c.req.param('id');
      if (!/^\d+$/.test(id) || !getGameRow(db, Number(id))) return c.json({ error: 'not found' }, 404);
      return c.json(gameNotes(db, Number(id)));
    })
    .post('/games/:id/coach', async (c) => {
      const id = c.req.param('id');
      const game = /^\d+$/.test(id) ? getGameRow(db, Number(id)) : null;
      if (!game) return c.json({ error: 'not found' }, 404);
      const body = (await c.req.json().catch(() => null)) as { provider?: unknown } | null;
      const requested = body?.provider;
      if (requested !== undefined && !(PROVIDER_IDS as readonly unknown[]).includes(requested)) return c.json({ error: 'unknown provider' }, 400);
      if (analysisStatus(db, game.id) !== 'done') return c.json({ error: 'Analyse this game first.' }, 400);
      const provider = requested as ProviderId | undefined;
      const job = runJob(db, 'coach', async (report) => {
        try {
          await reviewGame(db, registry, game.id, { provider, onProvider: (p) => report(0, null, `Asking ${p.label}…`) });
        } catch (err) {
          const settings = getSettings(db);
          throw new Error(coachErrorMessage(err, [settings.openrouterApiKey, settings.anthropicApiKey]), { cause: err });
        }
      });
      return c.json({ jobId: job.id });
    })
    .get('/coach/weakness', (c) => c.json(latestWeakness(db)))
    .post('/coach/weakness', async (c) => {
      const body = (await c.req.json().catch(() => null)) as { provider?: unknown } | null;
      const requested = body?.provider;
      if (requested !== undefined && !(PROVIDER_IDS as readonly unknown[]).includes(requested)) return c.json({ error: 'unknown provider' }, 400);
      if (weaknessFacts(db, 1).games === 0) return c.json({ error: NO_GAMES }, 400);
      const provider = requested as ProviderId | undefined;
      const job = runJob(db, 'coach', async (report) => {
        try {
          await weaknessReport(db, registry, { provider, reps: getReps(), onProvider: (p) => report(0, null, `Asking ${p.label}…`) });
        } catch (err) {
          const settings = getSettings(db);
          throw new Error(coachErrorMessage(err, [settings.openrouterApiKey, settings.anthropicApiKey]), { cause: err });
        }
      });
      return c.json({ jobId: job.id });
    })
    .post('/ai/providers/:id/test', async (c) => {
      const id = c.req.param('id');
      const known = registry.list().find((p) => p.id === id);
      if (!known) return c.json({ error: 'unknown provider' }, 404);
      const settings = getSettings(db);
      const secrets = [settings.openrouterApiKey, settings.anthropicApiKey];
      const fail = (error: string) => c.json({ ok: false, error: redact(error, secrets) });
      const availability = await known.available().catch(() => ({ ok: false, reason: 'Availability check failed' }));
      if (!availability.ok) return fail(availability.reason ?? 'Provider is not available');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const started = Date.now();
      try {
        const run = runStructured(
          known,
          {
            system: 'You reply with one JSON object only.',
            user: 'Reply with {"ok": true}.',
            schemaName: 'ping',
            jsonSchema: toStrictJsonSchema(testSchema),
          },
          testSchema,
          { model: settings.aiModels[known.id], allowedSan: new Set(), textOf: () => [], signal: controller.signal },
        );
        const aborted = new Promise<never>((_, reject) =>
          controller.signal.addEventListener('abort', () => reject(new Error('timeout')), { once: true }),
        );
        const { model } = await Promise.race([run, aborted]);
        return c.json({ ok: true, model, ms: Date.now() - started });
      } catch (err) {
        if (controller.signal.aborted) return fail(`Timed out after ${timeoutMs >= 1000 ? `${Math.round(timeoutMs / 1000)} s` : `${timeoutMs} ms`}`);
        return fail(err instanceof Error ? err.message : 'Provider call failed');
      } finally {
        clearTimeout(timer);
      }
    });
}

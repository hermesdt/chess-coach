import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { getSetting, setSetting } from '../db/settings-repo.js';
import { currentLevel } from '../level.js';
import { scanLeaks } from './leaks.js';
import { syncOpeningCards } from './opening-cards.js';
import type { RepNode, Repertoire } from './types.js';

const HASH_KEY = 'repertoire_hash';

const shape = (n: RepNode): unknown => [n.san, n.level, n.children.map(shape)];

/**
 * Hash of what leak events depend on: repertoire ids, colours and the move trees with levels (sorted by
 * id). Comments are left out, so a text edit does not trigger a rescan.
 */
export function repertoireHash(reps: Repertoire[]): string {
  const sorted = [...reps].sort((a, b) => a.id.localeCompare(b.id));
  const json = JSON.stringify(sorted.map((r) => [r.id, r.color, r.roots.map(shape)]));
  return createHash('sha1').update(json).digest('hex');
}

/**
 * Make opening cards and leak events match the repertoires and the games. When the repertoire content
 * changed since the last run, every game is scanned again. Leaks that were already recorded for the
 * same game and node do not flag their card again.
 */
export function refreshOpenings(db: DatabaseSync, reps: Repertoire[], now: number = Date.now()): void {
  syncOpeningCards(db, reps, currentLevel(db).level);
  const hash = repertoireHash(reps);
  const changed = getSetting(db, HASH_KEY) !== hash;
  scanLeaks(db, reps, now, { rescan: changed });
  if (changed) setSetting(db, HASH_KEY, hash);
}

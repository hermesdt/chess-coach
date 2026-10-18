import type { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import type { GameResult, OpeningDetail, OpeningLeakGroup, OpeningSummary, RepNodeDTO } from '../../shared/types.js';
import { currentLevel } from '../level.js';
import { scanLeaks } from '../repertoire/leaks.js';
import type { RepNode, Repertoire } from '../repertoire/types.js';
import { listCardsByKind } from '../srs/cards-repo.js';

/** W/D/L from the stored opening events: the scan already classified each game. */
function stats(db: DatabaseSync, rep: Repertoire): OpeningSummary['stats'] {
  const rows = db.prepare(`SELECT g.result AS result FROM opening_events e JOIN games g ON g.id = e.game_id
    WHERE e.repertoire_id = ? AND g.user_color = ?`).all(rep.id, rep.color) as unknown as { result: GameResult | null }[];
  const out = { games: 0, win: 0, draw: 0, loss: 0 };
  for (const r of rows) {
    out.games += 1;
    if (r.result) out[r.result] += 1;
  }
  return out;
}

function toDto(node: RepNode, level: number): RepNodeDTO {
  return {
    id: node.id, san: node.san, uci: node.uci, comment: node.comment, tags: node.tags, level: node.level,
    ply: node.ply, mover: node.mover, fenAfter: node.fenAfter, locked: node.level > level,
    children: node.children.map((c) => toDto(c, level)),
  };
}

export function openingsRoutes(db: DatabaseSync, getReps: () => Repertoire[]): Hono {
  return new Hono()
    .get('/openings', (c) => {
      try {
        scanLeaks(db, getReps());
      } catch (e) {
        console.error('could not scan opening leaks', e);
      }
      const cards = listCardsByKind(db, 'opening').filter((card) => !card.suspended);
      const list: OpeningSummary[] = getReps().map((rep) => ({
        id: rep.id, name: rep.name, color: rep.color, nodeCount: rep.byId.size,
        cardCount: cards.filter((card) => card.refs.some((r) => r.repertoire === rep.id)).length,
        stats: stats(db, rep),
      }));
      return c.json(list);
    })
    .get('/openings/:id', (c) => {
      const rep = getReps().find((r) => r.id === c.req.param('id'));
      if (!rep) return c.json({ error: 'not found' }, 404);
      const { level } = currentLevel(db);
      const body: OpeningDetail = { id: rep.id, name: rep.name, color: rep.color, level, roots: rep.roots.map((n) => toDto(n, level)) };
      return c.json(body);
    })
    .get('/openings/:id/leaks', (c) => {
      const id = c.req.param('id');
      if (!getReps().some((r) => r.id === id)) return c.json({ error: 'not found' }, 404);
      const rows = db.prepare(`SELECT node_id, expected_san, played_san, game_id FROM opening_events
        WHERE repertoire_id = ? AND kind = 'leak' ORDER BY game_id`).all(id) as unknown as
        { node_id: string; expected_san: string; played_san: string; game_id: number }[];
      const groups = new Map<string, OpeningLeakGroup>();
      for (const r of rows) {
        const key = `${r.node_id}|${r.played_san}`;
        const g = groups.get(key) ?? { nodeId: r.node_id, expectedSan: r.expected_san, playedSan: r.played_san, count: 0, gameIds: [] };
        g.count += 1;
        g.gameIds.push(r.game_id);
        groups.set(key, g);
      }
      const list = [...groups.values()].sort((a, b) => b.count - a.count || a.nodeId.localeCompare(b.nodeId));
      return c.json(list);
    });
}

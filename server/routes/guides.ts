import type { DatabaseSync } from 'node:sqlite';
import { Chess } from 'chess.js';
import { Hono } from 'hono';
import type { PlanFile } from '../../shared/plans.js';
import type { GuideDTO, GuideMove, GuideVariationDTO } from '../../shared/types.js';
import { personalBoxes, type ReplayCache } from '../guides/personal.js';
import type { GuideFile, GuideVariation } from '../guides/types.js';
import { currentLevel } from '../level.js';
import { scanLeaks } from '../repertoire/leaks.js';
import type { RepNode, Repertoire } from '../repertoire/types.js';

/** The node and its ancestors, from the first move. */
function line(rep: Repertoire, nodeId: string): RepNode[] {
  const nodes: RepNode[] = [];
  for (let n = rep.byId.get(nodeId); n; n = n.parentId === null ? undefined : rep.byId.get(n.parentId)) nodes.unshift(n);
  return nodes;
}

function node(rep: Repertoire, nodeId: string): RepNode {
  const n = rep.byId.get(nodeId);
  if (!n) throw new Error(`Guide node "${nodeId}" is not a node of ${rep.id}`);
  return n;
}

const sans = (rep: Repertoire, nodeId: string) => line(rep, node(rep, nodeId).id).map((n) => n.san);

function fenAfter(moves: string[]): string {
  const chess = new Chess();
  for (const san of moves) chess.move(san);
  return chess.fen();
}

/** Resolves a SAN move at the position after `moves` to its squares. */
function resolveMove(moves: string[], san: string): GuideMove {
  const chess = new Chess();
  for (const m of moves) chess.move(m);
  const move = chess.move(san);
  return { san: move.san, from: move.from, to: move.to };
}

function toDto(rep: Repertoire, v: GuideVariation, level: number, personal: GuideVariationDTO['personal'], plans: readonly PlanFile[]): GuideVariationDTO {
  const final = line(rep, v.finalForm.nodeId);
  const requiredLevel = Math.max(1, ...final.map((n) => n.level)) as 1 | 2 | 3;
  const personalOpp = new Map((personal?.opponentMoves ?? []).map((o) => [o.nodeId ? `${o.nodeId} ${o.playedSan}` : o.playedSan, o.count]));
  const deviations = v.deviations.map((d) => {
    const n = node(rep, d.nodeId);
    return {
      nodeId: d.nodeId, san: n.san, plan: d.plan, level: n.level,
      ...(d.showNodeId === undefined ? {} : { showMoves: sans(rep, d.showNodeId) }),
    };
  }).sort((a, b) => (personalOpp.get(b.nodeId) ?? 0) - (personalOpp.get(a.nodeId) ?? 0));
  return {
    key: v.key, name: v.name, roots: v.roots,
    finalForm: {
      nodeId: v.finalForm.nodeId, moves: final.map((n) => n.san), fen: node(rep, v.finalForm.nodeId).fenAfter,
      jobs: v.finalForm.jobs, level: node(rep, v.finalForm.nodeId).level,
    },
    route: v.route.map((r) => ({ nodeId: r.nodeId, san: node(rep, r.nodeId).san, why: r.why, level: node(rep, r.nodeId).level })),
    deviations,
    middlegame: v.middlegame,
    mistakes: v.mistakes.map((m) => ({
      moves: m.moves, fen: fenAfter(m.moves), text: m.text,
      ...(m.bad === undefined ? {} : { bad: resolveMove(m.moves, m.bad) }),
      ...(m.good === undefined ? {} : { good: m.good.map((g) => resolveMove(m.moves, g)) }),
    })),
    locked: requiredLevel > level,
    requiredLevel,
    personal,
    plans: plans
      .filter((p) => p.guideLinks.some((l) => l.repertoireId === rep.id && l.variation === v.key))
      .map((p) => ({ id: p.id, title: p.title })),
  };
}

export function guidesRoutes(db: DatabaseSync, getReps: () => Repertoire[], getGuides: () => GuideFile[], getPlans: () => PlanFile[] = () => []): Hono {
  const replays: ReplayCache = new Map();
  return new Hono().get('/openings/:id/guide', (c) => {
    const rep = getReps().find((r) => r.id === c.req.param('id'));
    const guide = rep && getGuides().find((g) => g.repertoireId === rep.id);
    if (!rep || !guide) return c.json({ error: 'not found' }, 404);
    try {
      scanLeaks(db, getReps());
    } catch (e) {
      console.error('could not scan opening leaks', e);
    }
    const { level } = currentLevel(db);
    const boxes = personalBoxes(db, rep, guide, level, replays);
    const body: GuideDTO = {
      repertoireId: rep.id, name: rep.name, color: rep.color, level, why: guide.why,
      variations: guide.variations.map((v) => toDto(rep, v, level, boxes.get(v.key) ?? null, getPlans())),
    };
    return c.json(body);
  });
}

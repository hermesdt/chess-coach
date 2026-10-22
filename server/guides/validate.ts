import { Chess } from 'chess.js';
import { inRoot } from '../../shared/guide-roots.js';
import { moverWinAfter, winPct } from '../analysis/winpct.js';
import type { EnginePool } from '../engine/pool.js';
import type { EngineLine } from '../engine/uci.js';
import type { RepNode, Repertoire, ValidationIssue } from '../repertoire/types.js';
import { MAX_WIN_LOSS } from '../repertoire/validate.js';
import type { GuideFile, GuideVariation } from './types.js';

export const MAX_GOOD = 3;
export const MIN_JOBS = 3;
export const MAX_JOBS = 6;
const DEFAULT_NODES = 1_000_000;

export interface GuideValidateOptions {
  nodes?: number;
}

function textFields(guide: GuideFile): { nodeId: string; text: string }[] {
  const out = [{ nodeId: '(why)', text: guide.why }];
  for (const v of guide.variations) {
    for (const j of v.finalForm.jobs) out.push({ nodeId: `${v.key}/${j.square}`, text: j.text });
    for (const r of v.route) out.push({ nodeId: r.nodeId, text: r.why });
    for (const d of v.deviations) out.push({ nodeId: d.nodeId, text: d.plan });
    out.push({ nodeId: `${v.key}/middlegame`, text: v.middlegame });
    for (const m of v.mistakes) out.push({ nodeId: m.moves.join(' '), text: m.text });
  }
  return out;
}

export async function validateGuide(
  guide: GuideFile,
  rep: Repertoire,
  engine?: Pick<EnginePool, 'analyse'>,
  opts: GuideValidateOptions = {},
): Promise<ValidationIssue[]> {
  const file = `${guide.repertoireId}.json`;
  const issues: ValidationIssue[] = [];
  const add = (nodeId: string, rule: string, detail: string) => issues.push({ file, nodeId, rule, detail });

  for (const { nodeId, text } of textFields(guide)) {
    if (/engine line/i.test(text)) add(nodeId, 'engine-line-text', 'Text must not say "engine line"');
    if (text.includes('%')) add(nodeId, 'percent-text', 'Text must not contain a "%" sign');
  }

  interface Checked { key: string; fenBefore: string; san: string; uci: string; fenAfter: string }
  const offTreeOwn: Checked[] = [];
  const goodMoves: Checked[] = [];

  const seenKeys = new Set<string>();
  const seenRoots = new Set<string>();
  for (const v of guide.variations) {
    if (seenKeys.has(v.key)) add(v.key, 'duplicate-variation', `Variation key "${v.key}" is used twice`);
    seenKeys.add(v.key);
    checkVariation(v);
  }

  /** Looks up a node and reports an unknown id; also checks it lies in a root of the variation (route nodes may sit above the roots). */
  function node(v: GuideVariation, id: string, what: string, needRoot = true): RepNode | null {
    const n = rep.byId.get(id);
    if (!n) {
      add(id, 'unknown-node', `${what} "${id}" is not a node of ${rep.id} (variation "${v.key}")`);
      return null;
    }
    if (needRoot && !v.roots.some((r) => inRoot(id, r))) {
      add(id, 'node-outside-roots', `${what} "${id}" is outside every root of variation "${v.key}"`);
    }
    return n;
  }

  function checkVariation(v: GuideVariation): void {
    for (const r of v.roots) {
      if (seenRoots.has(r)) add(r, 'duplicate-root', `Root "${r}" is used twice (variation "${v.key}")`);
      seenRoots.add(r);
      if (!rep.byId.has(r)) add(r, 'unknown-root', `Root "${r}" is not a node of ${rep.id} (variation "${v.key}")`);
    }

    const ff = node(v, v.finalForm.nodeId, 'Final form');
    if (ff) {
      const board = new Chess(ff.fenAfter);
      const ownColor = rep.color === 'white' ? 'w' : 'b';
      const squares = new Set<string>();
      for (const j of v.finalForm.jobs) {
        if (squares.has(j.square)) add(v.finalForm.nodeId, 'duplicate-job', `Two jobs on square "${j.square}" (variation "${v.key}")`);
        squares.add(j.square);
        const piece = /^[a-h][1-8]$/.test(j.square) ? board.get(j.square as Parameters<Chess['get']>[0]) : undefined;
        if (!piece || piece.color !== ownColor) {
          add(v.finalForm.nodeId, 'job-square', `Job square "${j.square}" has no ${rep.color} piece on the final-form board (variation "${v.key}")`);
        }
      }
    }
    if (v.finalForm.jobs.length < MIN_JOBS || v.finalForm.jobs.length > MAX_JOBS) {
      add(v.finalForm.nodeId, 'job-count', `Final form has ${v.finalForm.jobs.length} jobs, needs ${MIN_JOBS} to ${MAX_JOBS} (variation "${v.key}")`);
    }

    let lastPly = 0;
    for (const step of v.route) {
      const n = node(v, step.nodeId, 'Route node', false);
      if (!n) continue;
      if (!inRoot(v.finalForm.nodeId, step.nodeId)) {
        add(step.nodeId, 'route-off-line', `Route node "${step.nodeId}" is not on the final-form line (variation "${v.key}")`);
      }
      if (n.ply <= lastPly) add(step.nodeId, 'route-order', `Route node "${step.nodeId}" is out of order (variation "${v.key}")`);
      lastPly = n.ply;
      if (n.mover !== rep.color) add(step.nodeId, 'route-not-own', `Route node "${step.nodeId}" is not a ${rep.color} move (variation "${v.key}")`);
    }

    for (const d of v.deviations) {
      const n = node(v, d.nodeId, 'Deviation node');
      if (n && n.mover === rep.color) add(d.nodeId, 'deviation-not-opponent', `Deviation node "${d.nodeId}" is not an opponent move (variation "${v.key}")`);
      if (d.showNodeId !== undefined) {
        node(v, d.showNodeId, 'Deviation show node');
        if (!inRoot(d.showNodeId, d.nodeId)) {
          add(d.showNodeId, 'show-not-descendant', `Show node "${d.showNodeId}" is not below deviation node "${d.nodeId}" (variation "${v.key}")`);
        }
      }
    }

    for (const m of v.mistakes) checkMistake(v, m);
  }

  function checkMistake(v: GuideVariation, mistake: GuideVariation['mistakes'][number]): void {
    const { moves } = mistake;
    const game = new Chess();
    let id = '';
    let onTree = true;
    for (const san of moves) {
      const fenBefore = game.fen();
      const mover = game.turn() === 'w' ? 'white' : 'black';
      let move;
      try {
        move = game.move(san);
      } catch {
        add(moves.join(' '), 'illegal-san', `Illegal move "${san}" in mistake line "${moves.join(' ')}" (variation "${v.key}")`);
        return;
      }
      id = id === '' ? move.san : `${id} ${move.san}`;
      if (onTree && !rep.byId.has(id)) onTree = false;
      if (!onTree && mover === rep.color) {
        offTreeOwn.push({ key: `${v.key}: ${moves.join(' ')}`, fenBefore, san: move.san, uci: move.from + move.to + (move.promotion ?? ''), fenAfter: game.fen() });
      }
    }
    checkBadGood(v, mistake, game);
  }

  /** `game` stands at the position after the mistake line. */
  function checkBadGood(v: GuideVariation, m: GuideVariation['mistakes'][number], game: Chess): void {
    if (m.bad === undefined && m.good === undefined) return;
    const line = m.moves.join(' ');
    const where = `mistake line "${line}" (variation "${v.key}")`;
    const good = m.good ?? [];
    if (m.bad === undefined || good.length === 0) {
      add(line, 'bad-good-pair', `A mistake needs both a bad move and at least one good move; ${where}`);
    }
    if (good.length > MAX_GOOD) add(line, 'good-count', `Mistake has ${good.length} good moves, at most ${MAX_GOOD} are allowed; ${where}`);
    const legal = (san: string) => {
      const board = new Chess(game.fen());
      try {
        const move = board.move(san);
        return { san: move.san, uci: move.from + move.to + (move.promotion ?? ''), fenAfter: board.fen() };
      } catch {
        return null;
      }
    };
    const bad = m.bad === undefined ? null : legal(m.bad);
    if (m.bad !== undefined && !bad) add(line, 'illegal-bad', `Illegal bad move "${m.bad}" in ${where}`);
    const seen = new Set<string>();
    for (const g of good) {
      const move = legal(g);
      if (!move) {
        add(line, 'illegal-good', `Illegal good move "${g}" in ${where}`);
        continue;
      }
      if (seen.has(move.san)) add(line, 'duplicate-good', `Good move "${move.san}" is listed twice in ${where}`);
      seen.add(move.san);
      if (bad && bad.san === move.san) add(line, 'bad-in-good', `Move "${move.san}" is both bad and good in ${where}`);
      goodMoves.push({ key: `${v.key}: ${line}`, fenBefore: game.fen(), ...move });
    }
  }

  if (engine) {
    const nodes = opts.nodes ?? DEFAULT_NODES;
    const cache = new Map<string, EngineLine[]>();
    const search = async (fen: string): Promise<EngineLine[]> => {
      const hit = cache.get(fen);
      if (hit) return hit;
      const lines = await engine.analyse(fen, { nodes, multipv: 1, newGame: true });
      cache.set(fen, lines);
      return lines;
    };
    const checkLoss = async (m: Checked, rule: string): Promise<void> => {
      const best = (await search(m.fenBefore))[0];
      if (!best || best.pv[0] === m.uci) return;
      const after = await search(m.fenAfter);
      const winAfter = after.length === 0 ? (new Chess(m.fenAfter).isCheckmate() ? 100 : 50) : moverWinAfter(after[0]!.score);
      const loss = winPct(best.score) - winAfter;
      if (loss >= MAX_WIN_LOSS) add(m.key, rule, `${m.san} loses ${loss.toFixed(1)} win % (mistake line ${m.key})`);
    };
    for (const m of offTreeOwn) await checkLoss(m, 'engine-loss');
    for (const m of goodMoves) await checkLoss(m, 'engine-loss-good');
  }
  return issues;
}

import { Chess } from 'chess.js';
import { moverWinAfter, winPct } from '../analysis/winpct.js';
import type { EnginePool } from '../engine/pool.js';
import type { EngineLine } from '../engine/uci.js';
import type { RepNode, Repertoire, ValidationIssue } from './types.js';

export const MAX_COMMENT_LENGTH = 220;
export const MAX_WIN_LOSS = 15;

export type EngineCache = Map<string, EngineLine[]>;

export interface ValidateOptions {
  nodes: number;
  /** Called after each repertoire-side position is checked, with the running count. */
  onProgress?: (checked: number) => void;
}

function sanFromUci(fen: string, uci: string | undefined): string {
  if (!uci) return '?';
  try {
    return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  } catch {
    return uci;
  }
}

function staticIssues(rep: Repertoire, file: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (nodeId: string, rule: string, detail: string) => issues.push({ file, nodeId, rule, detail });

  const checkSiblings = (parentId: string, siblings: RepNode[]) => {
    const seen = new Set<string>();
    for (const s of siblings) {
      if (seen.has(s.san)) add(parentId, 'duplicate-sibling', `Duplicate move ${s.san}`);
      seen.add(s.san);
    }
    if (siblings.length > 1 && siblings[0]!.mover === rep.color) {
      add(parentId, 'multiple-children', `Repertoire side has ${siblings.length} moves here: ${siblings.map((s) => s.san).join(', ')}`);
    }
  };

  const walk = (node: RepNode) => {
    if (node.mover === rep.color) {
      if (!node.comment || node.comment.trim() === '') add(node.id, 'missing-comment', 'Repertoire move has no comment');
      else if (node.comment.length > MAX_COMMENT_LENGTH) add(node.id, 'comment-too-long', `Comment has ${node.comment.length} characters (max ${MAX_COMMENT_LENGTH})`);
    }
    checkSiblings(node.id, node.children);
    for (const c of node.children) {
      if (c.level < node.level) add(c.id, 'level-order', `Level ${c.level} is lower than the parent level ${node.level}`);
      walk(c);
    }
  };

  checkSiblings('(root)', rep.roots);
  for (const r of rep.roots) walk(r);
  return issues;
}

export async function validateRepertoire(
  rep: Repertoire,
  engine: Pick<EnginePool, 'analyse'>,
  opts: ValidateOptions,
  cache: EngineCache = new Map(),
): Promise<ValidationIssue[]> {
  const file = `${rep.id}.json`;
  const issues = staticIssues(rep, file);

  const search = async (fen: string): Promise<EngineLine[]> => {
    const hit = cache.get(fen);
    if (hit) return hit;
    const lines = await engine.analyse(fen, { nodes: opts.nodes, multipv: 1 });
    cache.set(fen, lines);
    return lines;
  };

  /** Mover's win % after the move; the position may be game over (no engine lines). */
  const winAfterMove = async (node: RepNode): Promise<number> => {
    const lines = await search(node.fenAfter);
    if (lines.length === 0) return new Chess(node.fenAfter).isCheckmate() ? 100 : 50;
    return moverWinAfter(lines[0]!.score);
  };

  let checked = 0;
  const visit = async (node: RepNode): Promise<void> => {
    if (node.mover === rep.color) {
      const best = (await search(node.fenBefore))[0];
      if (best && best.pv[0] !== node.uci) {
        const loss = winPct(best.score) - (await winAfterMove(node));
        if (loss >= MAX_WIN_LOSS) {
          issues.push({
            file,
            nodeId: node.id,
            rule: 'engine-loss',
            detail: `${node.san} loses ${loss.toFixed(1)} win % (best: ${sanFromUci(node.fenBefore, best.pv[0])})`,
          });
        }
      }
      checked++;
      opts.onProgress?.(checked);
    }
    for (const c of node.children) await visit(c);
  };
  for (const r of rep.roots) await visit(r);
  return issues;
}

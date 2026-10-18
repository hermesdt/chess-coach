import type { DatabaseSync } from 'node:sqlite';
import type { Card, CardRef } from '../../shared/types.js';
import { transaction } from '../db/db.js';
import { listCardsByKind, positionKey, setSuspended, upsertCard } from '../srs/cards-repo.js';
import type { RepNode, Repertoire } from './types.js';

type Draft = Omit<Card, 'id' | 'createdAt' | 'suspended'> & { sortOrder: number };

/**
 * One draft per position where the repertoire side is to move and the repertoire move is allowed
 * at `level`. Depth-first preorder gives `sortOrder`. Transpositions merge into one draft.
 */
function collectDrafts(reps: Repertoire[], level: number): Map<string, Draft> {
  const drafts = new Map<string, Draft>();
  let order = 0;
  const add = (rep: Repertoire, fen: string, child: RepNode, lastMove: string | null) => {
    if (child.level > level) return;
    const key = positionKey(fen);
    const ref: CardRef = { repertoire: rep.id, nodeId: child.id };
    const existing = drafts.get(key);
    if (existing) {
      existing.refs.push(ref);
      if (!existing.solution.accepted.includes(child.uci)) existing.solution.accepted.push(child.uci);
      return;
    }
    drafts.set(key, {
      kind: 'opening', positionKey: key, fen, sideToMove: rep.color,
      prompt: `${rep.name}: your move.`,
      solution: { accepted: [child.uci], best: child.uci, explanation: child.comment },
      refs: [ref], lastMove: lastMove ? { uci: lastMove } : null, sortOrder: order++,
    });
  };
  const visit = (rep: Repertoire, node: RepNode) => {
    const repMove = node.mover !== rep.color ? node.children[0] : undefined;
    if (repMove) add(rep, node.fenAfter, repMove, node.uci);
    for (const child of node.children) visit(rep, child);
  };
  for (const rep of reps) {
    // A white repertoire starts with its own move from the initial position.
    const first = rep.color === 'white' ? rep.roots[0] : undefined;
    if (first) add(rep, first.fenBefore, first, null);
    for (const root of rep.roots) visit(rep, root);
  }
  return drafts;
}

const sameContent = (a: Card, b: Draft): boolean =>
  a.fen === b.fen && a.prompt === b.prompt && a.lastMove?.uci === b.lastMove?.uci &&
  JSON.stringify(a.solution) === JSON.stringify(b.solution) && JSON.stringify(a.refs) === JSON.stringify(b.refs);

/**
 * Make the opening cards match the repertoires at `level`. Idempotent. Cards that no longer match
 * any allowed node (removed line, or above the level) are suspended; FSRS state is never touched.
 */
export function syncOpeningCards(
  db: DatabaseSync,
  reps: Repertoire[],
  level: number,
): { created: number; updated: number; suspended: number } {
  return transaction(db, () => {
    const drafts = collectDrafts(reps, level);
    const existing = new Map(listCardsByKind(db, 'opening').map((c) => [c.positionKey, c]));
    let created = 0;
    let updated = 0;
    let suspended = 0;
    for (const draft of drafts.values()) {
      const old = existing.get(draft.positionKey);
      const sortChanged = old === undefined || sortOrderOf(db, old.id) !== draft.sortOrder;
      const card = upsertCard(db, draft, { mergeRefs: false });
      if (!old) created += 1;
      else if (!sameContent(old, draft) || sortChanged || (old.suspended && !card.suspended)) updated += 1;
    }
    for (const old of existing.values()) {
      if (drafts.has(old.positionKey) || old.suspended) continue;
      setSuspended(db, old.id, true);
      suspended += 1;
    }
    return { created, updated, suspended };
  });
}

function sortOrderOf(db: DatabaseSync, id: number): number | null {
  return (db.prepare('SELECT sort_order FROM cards WHERE id = ?').get(id)?.sort_order as number | null) ?? null;
}

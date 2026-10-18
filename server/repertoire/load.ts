import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Chess } from 'chess.js';
import type { Color } from '../../shared/types';
import type { RepNode, Repertoire } from './types.js';

export type { RepNode, Repertoire, ValidationIssue } from './types.js';
export { validateRepertoire } from './validate.js';

export class RepertoireError extends Error {
  constructor(
    readonly nodeId: string,
    message: string,
  ) {
    super(`${message} (node "${nodeId}")`);
    this.name = 'RepertoireError';
  }
}

interface RawNode {
  san?: unknown;
  comment?: unknown;
  tags?: unknown;
  level?: unknown;
  children?: unknown;
}

const DEFAULT_DIR = 'content/repertoires';

function isLevel(v: unknown): v is 1 | 2 | 3 {
  return v === 1 || v === 2 || v === 3;
}

export function loadRepertoire(json: unknown): Repertoire {
  const raw = json as { id?: unknown; name?: unknown; color?: unknown; moves?: unknown } | null;
  if (!raw || typeof raw.id !== 'string' || typeof raw.name !== 'string' || !Array.isArray(raw.moves)) {
    throw new RepertoireError('(root)', 'Repertoire needs id, name and moves');
  }
  if (raw.color !== 'white' && raw.color !== 'black') {
    throw new RepertoireError('(root)', 'Repertoire color must be "white" or "black"');
  }
  const byId = new Map<string, RepNode>();

  const build = (rawNode: RawNode, game: Chess, parent: RepNode | null): RepNode => {
    const san = rawNode.san;
    const id = parent ? `${parent.id} ${String(san)}` : String(san);
    if (typeof san !== 'string') throw new RepertoireError(id, 'Move needs a san string');
    const level = rawNode.level === undefined ? (parent?.level ?? 1) : rawNode.level;
    if (!isLevel(level)) throw new RepertoireError(id, 'level must be 1, 2 or 3');
    const fenBefore = game.fen();
    const mover: Color = game.turn() === 'w' ? 'white' : 'black';
    let move;
    try {
      move = game.move(san);
    } catch {
      throw new RepertoireError(id, `Illegal move "${san}"`);
    }
    const node: RepNode = {
      id,
      san: move.san,
      uci: move.from + move.to + (move.promotion ?? ''),
      comment: typeof rawNode.comment === 'string' ? rawNode.comment : null,
      tags: Array.isArray(rawNode.tags) ? rawNode.tags.filter((t): t is string => typeof t === 'string') : [],
      level,
      fenBefore,
      fenAfter: game.fen(),
      ply: (parent?.ply ?? 0) + 1,
      mover,
      parentId: parent?.id ?? null,
      children: [],
    };
    byId.set(id, node);
    if (Array.isArray(rawNode.children)) {
      for (const child of rawNode.children as RawNode[]) {
        node.children.push(build(child, new Chess(node.fenAfter), node));
      }
    }
    return node;
  };

  const roots = (raw.moves as RawNode[]).map((m) => build(m, new Chess(), null));
  return { id: raw.id, name: raw.name, color: raw.color, roots, byId };
}

/** Top-level `*.json` files only, so `__test__/` fixtures are never picked up. */
export function listRepertoireFiles(dir: string = DEFAULT_DIR): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.json'))
    .map((e) => join(dir, e.name))
    .sort();
}

export function loadAllRepertoires(dir: string = DEFAULT_DIR): Repertoire[] {
  return listRepertoireFiles(dir).map((f) => loadRepertoire(JSON.parse(readFileSync(f, 'utf8'))));
}

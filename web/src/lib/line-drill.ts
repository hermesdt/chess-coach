import type { Color, RepNodeDTO } from '../../../shared/types';

export type DrillStep =
  | { kind: 'opponent'; san: string }
  | { kind: 'user'; expectedSan: string }
  | { kind: 'done' };

/** Node reached by following `path` (SAN moves from the start). Null for an empty or unknown path. */
export function nodeAtPath(roots: RepNodeDTO[], path: string[]): RepNodeDTO | null {
  let level = roots;
  let node: RepNodeDTO | null = null;
  for (const san of path) {
    node = level.find((n) => n.san === san) ?? null;
    if (!node) return null;
    level = node.children;
  }
  return node;
}

/**
 * Next step of a line drill after `path`. The opponent picks a random unlocked child.
 * The user must play the single unlocked repertoire child.
 */
export function nextDrillStep(
  roots: RepNodeDTO[],
  path: string[],
  userColor: Color,
  random: () => number = Math.random,
): DrillStep {
  const parent = nodeAtPath(roots, path);
  if (path.length > 0 && !parent) return { kind: 'done' };
  const children = (parent ? parent.children : roots).filter((n) => !n.locked);
  if (children.length === 0) return { kind: 'done' };
  const toMove: Color = path.length % 2 === 0 ? 'white' : 'black';
  if (toMove === userColor) return { kind: 'user', expectedSan: children[0]!.san };
  const pick = children[Math.min(children.length - 1, Math.floor(random() * children.length))]!;
  return { kind: 'opponent', san: pick.san };
}

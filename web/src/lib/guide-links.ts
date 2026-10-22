import type { Color, GuideIndexEntry } from '../../../shared/types';

export type GuidePart = 'route' | 'deviations' | 'mistakes';

/** Link into a guide. Without a variation the guide opens at its intro (#why), which always exists. */
export function guideLink(repertoireId: string, variationKey: string | null, part: GuidePart | null): string {
  const base = `/openings/${encodeURIComponent(repertoireId)}/guide`;
  if (variationKey === null) return `${base}#why`;
  return `${base}?v=${encodeURIComponent(variationKey)}${part ? `#${part}-${variationKey}` : ''}`;
}

const inRoot = (nodeId: string, root: string) => nodeId === root || nodeId.startsWith(`${root} `);

/** Same rule as the server: the variation whose root is the longest prefix of the node id, or null. */
export function variationKeyOf(index: GuideIndexEntry[], nodeId: string): string | null {
  let best: string | null = null;
  let bestLength = -1;
  for (const v of index) {
    for (const root of v.roots) {
      if (inRoot(nodeId, root) && root.length > bestLength) {
        best = v.key;
        bestLength = root.length;
      }
    }
  }
  return best;
}

/** "route" when the node is a move of the repertoire side, "deviations" when it is an opponent move. */
export function partForNode(nodeId: string, repColor: Color): GuidePart {
  const mover: Color = nodeId.split(' ').length % 2 === 1 ? 'white' : 'black';
  return mover === repColor ? 'route' : 'deviations';
}

/** Href of the "Plan" link, or null when the repertoire has no guide (index null or missing). */
export function planHref(
  index: GuideIndexEntry[] | null | undefined,
  repertoireId: string,
  nodeId: string,
  part: GuidePart,
): string | null {
  if (!index) return null;
  const key = variationKeyOf(index, nodeId);
  return guideLink(repertoireId, key, key === null ? null : part);
}

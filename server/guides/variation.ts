import type { GuideFile, GuideVariation } from './types.js';

const inRoot = (nodeId: string, root: string) => nodeId === root || nodeId.startsWith(`${root} `);

/** The variation whose root is the longest prefix of the node's SAN path, or null when no root fits. */
export function variationOf(guide: GuideFile, nodeId: string): GuideVariation | null {
  let best: GuideVariation | null = null;
  let bestLength = -1;
  for (const v of guide.variations) {
    for (const root of v.roots) {
      if (inRoot(nodeId, root) && root.length > bestLength) {
        best = v;
        bestLength = root.length;
      }
    }
  }
  return best;
}

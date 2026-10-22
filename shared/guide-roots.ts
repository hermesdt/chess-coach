/** True when the node id is the root or lies below it in the SAN path (a whole-move prefix, never a partial move name). */
export const inRoot = (nodeId: string, root: string): boolean => nodeId === root || nodeId.startsWith(`${root} `);

/** The entry whose root is the longest prefix of the node id, or null when no root fits. */
export function variationKeyOf<T extends { roots: string[] }>(entries: T[], nodeId: string): T | null {
  let best: T | null = null;
  let bestLength = -1;
  for (const entry of entries) {
    for (const root of entry.roots) {
      if (inRoot(nodeId, root) && root.length > bestLength) {
        best = entry;
        bestLength = root.length;
      }
    }
  }
  return best;
}

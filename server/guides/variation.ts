import { variationKeyOf } from '../../shared/guide-roots.js';
import type { GuideFile, GuideVariation } from './types.js';

/** The variation whose root is the longest prefix of the node's SAN path, or null when no root fits. */
export function variationOf(guide: GuideFile, nodeId: string): GuideVariation | null {
  return variationKeyOf(guide.variations, nodeId);
}

import { useEffect, useState } from 'react';
import type { GuideIndexEntry } from '../../../shared/types';
import { api } from '../api';

/**
 * Variation index of the guide of a repertoire, from the openings list (one request, no 404 for a repertoire
 * without a guide). null while loading, when there is no guide, or when the list cannot load: no "Plan" link then.
 * It does nothing without a repertoire id.
 */
export function useGuideIndex(repertoireId: string | undefined): GuideIndexEntry[] | null {
  const [state, setState] = useState<{ id: string; index: GuideIndexEntry[] | null } | null>(null);
  useEffect(() => {
    if (!repertoireId) return;
    let stale = false;
    api.listOpenings().then(
      (list) => {
        if (!stale) setState({ id: repertoireId, index: list.find((o) => o.id === repertoireId)?.variationIndex ?? null });
      },
      () => {},
    );
    return () => {
      stale = true;
    };
  }, [repertoireId]);
  return state && state.id === repertoireId ? state.index : null;
}

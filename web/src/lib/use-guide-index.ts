import { useEffect, useState } from 'react';
import type { GuideIndexEntry, OpeningSummary } from '../../../shared/types';
import { api } from '../api';

/** The openings list is fetched once per session; a failed fetch is forgotten so the next hook asks again. */
let openings: Promise<OpeningSummary[]> | null = null;

function loadOpenings(): Promise<OpeningSummary[]> {
  if (!openings) {
    openings = api.listOpenings();
    openings.catch(() => {
      openings = null;
    });
  }
  return openings;
}

/** For tests: forget the cached openings list. */
export function resetGuideIndexCache(): void {
  openings = null;
}

/**
 * Variation index of the guide of a repertoire, from the openings list (one request per session, no 404 for a
 * repertoire without a guide). null while loading, when there is no guide, or when the list cannot load: no
 * "Plan" link then. It does nothing without a repertoire id.
 */
export function useGuideIndex(repertoireId: string | undefined): GuideIndexEntry[] | null {
  const [state, setState] = useState<{ id: string; index: GuideIndexEntry[] | null } | null>(null);
  useEffect(() => {
    if (!repertoireId) return;
    let stale = false;
    loadOpenings().then(
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

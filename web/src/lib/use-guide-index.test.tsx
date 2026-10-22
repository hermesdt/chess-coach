// @vitest-environment jsdom
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpeningSummary } from '../../../shared/types';
import { api } from '../api';
import { resetGuideIndexCache, useGuideIndex } from './use-guide-index';

const index = [{ key: 'advance', roots: ['e4 c6 d4 d5 e5'] }];
const opening = (variationIndex: OpeningSummary['variationIndex']): OpeningSummary => ({
  id: 'caro-kann', name: 'Caro-Kann', color: 'black', nodeCount: 1, cardCount: 0, stats: { games: 0, win: 0, draw: 0, loss: 0 }, variationIndex,
});

beforeEach(resetGuideIndexCache);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useGuideIndex', () => {
  it('loads the openings list once for several hooks and remounts', async () => {
    const list = vi.spyOn(api, 'listOpenings').mockResolvedValue([opening(index)]);
    const first = renderHook(() => useGuideIndex('caro-kann'));
    await waitFor(() => expect(first.result.current).toEqual(index));
    first.unmount();
    const second = renderHook(() => useGuideIndex('caro-kann'));
    await waitFor(() => expect(second.result.current).toEqual(index));
    expect(list).toHaveBeenCalledTimes(1);
  });

  it('asks again after a failed load', async () => {
    const list = vi.spyOn(api, 'listOpenings').mockRejectedValueOnce(new Error('down')).mockResolvedValue([opening(index)]);
    const first = renderHook(() => useGuideIndex('caro-kann'));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));
    expect(first.result.current).toBeNull();
    first.unmount();
    const second = renderHook(() => useGuideIndex('caro-kann'));
    await waitFor(() => expect(second.result.current).toEqual(index));
    expect(list).toHaveBeenCalledTimes(2);
  });

  it('does nothing without a repertoire id', () => {
    const list = vi.spyOn(api, 'listOpenings').mockResolvedValue([]);
    renderHook(() => useGuideIndex(undefined));
    expect(list).not.toHaveBeenCalled();
  });
});

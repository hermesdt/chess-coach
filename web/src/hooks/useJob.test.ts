// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Job } from '../../../shared/types';
import { api } from '../api';
import { useJob } from './useJob';

const job = (status: Job['status'], progress = 0): Job => ({
  id: 1, kind: 'sync', status, progress, total: null, message: null, error: null, createdAt: 0, finishedAt: null,
});

describe('useJob', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('polls while running and stops when done', async () => {
    const getJob = vi
      .spyOn(api, 'getJob')
      .mockResolvedValueOnce(job('running', 1))
      .mockResolvedValueOnce(job('running', 2))
      .mockResolvedValue(job('done', 3));
    const { result } = renderHook(() => useJob(1, 1000));
    expect(result.current.job).toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.job?.status).toBe('running');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.job?.progress).toBe(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(result.current.job?.status).toBe('done');
    expect(getJob).toHaveBeenCalledTimes(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(getJob).toHaveBeenCalledTimes(3);
  });

  it('does nothing when jobId is null', async () => {
    const getJob = vi.spyOn(api, 'getJob');
    const { result } = renderHook(() => useJob(null));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(result.current).toEqual({ job: null, error: null });
    expect(getJob).not.toHaveBeenCalled();
  });

  it('stops after 3 consecutive errors and exposes the error', async () => {
    const getJob = vi.spyOn(api, 'getJob').mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useJob(1, 1000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(getJob).toHaveBeenCalledTimes(3);
    expect(result.current).toEqual({ job: null, error: 'offline' });
  });

  it('resets the error count after a success', async () => {
    const getJob = vi
      .spyOn(api, 'getJob')
      .mockRejectedValueOnce(new Error('x'))
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValueOnce(job('running', 1))
      .mockRejectedValueOnce(new Error('x'))
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValue(job('done', 2));
    const { result } = renderHook(() => useJob(1, 1000));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(getJob).toHaveBeenCalledTimes(6);
    expect(result.current.error).toBeNull();
    expect(result.current.job?.status).toBe('done');
  });
});

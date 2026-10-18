import { useEffect, useState } from 'react';
import type { Job } from '../../../shared/types';
import { api } from '../api';

const MAX_CONSECUTIVE_ERRORS = 3;

export interface UseJobResult {
  job: Job | null;
  /** Set when polling stopped after repeated request failures. */
  error: string | null;
}

/** Polls a job until it is `done` or `error`, or until 3 requests in a row fail. */
export function useJob(jobId: number | null, intervalMs = 1000): UseJobResult {
  const [state, setState] = useState<{ jobId: number; job: Job | null; error: string | null } | null>(null);

  useEffect(() => {
    setState(null);
    if (jobId === null) return;
    let cancelled = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const next = await api.getJob(jobId);
        if (cancelled) return;
        failures = 0;
        setState({ jobId, job: next, error: null });
        if (next.status === 'done' || next.status === 'error') return;
      } catch (e) {
        if (cancelled) return;
        failures += 1;
        if (failures >= MAX_CONSECUTIVE_ERRORS) {
          setState((prev) => ({ jobId, job: prev?.job ?? null, error: (e as Error).message }));
          return;
        }
      }
      timer = setTimeout(() => void poll(), intervalMs);
    };
    void poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId, intervalMs]);

  const current = state?.jobId === jobId ? state : null;
  return { job: current?.job ?? null, error: current?.error ?? null };
}

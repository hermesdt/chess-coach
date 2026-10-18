import { useEffect, useState } from 'react';
import type { Job } from '../../../shared/types';
import { api } from '../api';

/** Polls a job until it is `done` or `error`. Returns null before the first response. */
export function useJob(jobId: number | null, intervalMs = 1000): Job | null {
  const [job, setJob] = useState<Job | null>(null);

  useEffect(() => {
    setJob(null);
    if (jobId === null) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      let next: Job | null = null;
      try {
        next = await api.getJob(jobId);
      } catch {
        // transient failure: keep polling
      }
      if (cancelled) return;
      if (next) setJob(next);
      if (next && (next.status === 'done' || next.status === 'error')) return;
      timer = setTimeout(() => void poll(), intervalMs);
    };
    void poll();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId, intervalMs]);

  return job?.id === jobId ? job : null;
}

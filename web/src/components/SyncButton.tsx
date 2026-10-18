import { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { useJob } from '../hooks/useJob';

/** Starts a sync job, shows its progress, and reports the final message. */
export function SyncButton({ onFinished }: { onFinished?: () => void }) {
  const [jobId, setJobId] = useState<number | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const job = useJob(jobId);
  const reported = useRef<number | null>(null);

  const finished = job?.status === 'done' || job?.status === 'error';
  const running = jobId !== null && !finished;

  useEffect(() => {
    if (job && finished && reported.current !== job.id) {
      reported.current = job.id;
      onFinished?.();
    }
  }, [job, finished, onFinished]);

  const start = async () => {
    setStartError(null);
    try {
      setJobId((await api.startSync()).jobId);
    } catch (e) {
      setStartError((e as Error).message);
    }
  };

  return (
    <div className="sync">
      <button type="button" disabled={running} onClick={() => void start()}>
        {running ? 'Syncing...' : 'Sync now'}
      </button>
      {running && job && <span className="muted">{job.message ?? `${job.progress} games`}</span>}
      {job?.status === 'done' && <span className="ok">{job.message ?? 'Sync finished.'}</span>}
      {job?.status === 'error' && <span className="error">{job.error ?? 'Sync failed.'}</span>}
      {startError && <span className="error">{startError}</span>}
    </div>
  );
}

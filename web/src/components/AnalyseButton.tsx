import { useEffect, useRef, useState } from 'react';
import { useJob } from '../hooks/useJob';

interface Props {
  label: string;
  runningLabel: string;
  /** Starts the job and returns its id, or null when there is nothing to analyse. */
  start: () => Promise<number | null>;
  onFinished?: () => void;
}

/** A button that starts an analysis job, shows its progress, and reports when it ends. */
export function AnalyseButton({ label, runningLabel, start, onFinished }: Props) {
  const [jobId, setJobId] = useState<number | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const [nothing, setNothing] = useState(false);
  const { job, error: pollError } = useJob(jobId);
  const reported = useRef<number | null>(null);

  const finished = job?.status === 'done' || job?.status === 'error';
  const running = jobId !== null && !finished && !pollError;

  useEffect(() => {
    if (job && finished && reported.current !== job.id) {
      reported.current = job.id;
      onFinished?.();
    }
  }, [job, finished, onFinished]);

  const click = async () => {
    setStartError(null);
    setNothing(false);
    try {
      const id = await start();
      setJobId(id);
      if (id === null) {
        setNothing(true);
        onFinished?.();
      }
    } catch (e) {
      setStartError((e as Error).message);
    }
  };

  return (
    <div className="sync">
      <button type="button" disabled={running} onClick={() => void click()}>
        {running ? runningLabel : label}
      </button>
      {running && job && (
        <span className="muted">
          {job.message ?? `${job.progress}${job.total ? ` of ${job.total}` : ''} games`}
        </span>
      )}
      {job?.status === 'error' && <span className="error">{job.error ?? 'Analysis failed.'}</span>}
      {pollError && <span className="error">Lost contact with the server: {pollError}</span>}
      {nothing && <span className="muted">Nothing to analyse</span>}
      {startError && <span className="error">{startError}</span>}
    </div>
  );
}

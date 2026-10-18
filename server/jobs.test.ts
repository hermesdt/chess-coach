import { describe, expect, it, vi } from 'vitest';
import { openDb } from './db/db.js';
import { createJob, getJob, recoverInterruptedJobs, runJob, updateJob, waitForJob } from './jobs.js';

describe('recoverInterruptedJobs', () => {
  it('marks queued and running jobs as error and leaves finished ones', () => {
    const db = openDb(':memory:');
    const queued = createJob(db, 'sync');
    const running = createJob(db, 'sync');
    updateJob(db, running.id, { status: 'running' });
    const done = createJob(db, 'sync');
    updateJob(db, done.id, { status: 'done', finishedAt: 5 });

    expect(recoverInterruptedJobs(db, 1234)).toBe(2);

    for (const id of [queued.id, running.id]) {
      expect(getJob(db, id)).toMatchObject({ status: 'error', error: 'interrupted by restart', finishedAt: 1234 });
    }
    expect(getJob(db, done.id)).toMatchObject({ status: 'done', error: null, finishedAt: 5 });
  });
});

describe('runJob', () => {
  it('records a failing job as error', async () => {
    const db = openDb(':memory:');
    const job = runJob(db, 'x', async () => {
      throw new Error('boom');
    });
    expect(await waitForJob(db, job.id)).toMatchObject({ status: 'error', error: 'boom' });
  });

  it('logs instead of rejecting when the error status cannot be saved', async () => {
    const db = openDb(':memory:');
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      runJob(db, 'x', async () => {
        await Promise.resolve();
        db.close();
        throw new Error('boom');
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(logged).toHaveBeenCalledTimes(1);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off('unhandledRejection', unhandled);
      logged.mockRestore();
    }
  });
});

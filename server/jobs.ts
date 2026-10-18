import type { DatabaseSync } from 'node:sqlite';
import type { Job, JobStatus } from '../shared/types.js';

type Row = Record<string, unknown>;
type JobPatch = Partial<Pick<Job, 'status' | 'progress' | 'total' | 'message' | 'error' | 'finishedAt'>>;
export type Report = (progress: number, total: number | null, message?: string) => void;

const COLUMNS: Record<keyof JobPatch, string> = {
  status: 'status',
  progress: 'progress',
  total: 'total',
  message: 'message',
  error: 'error',
  finishedAt: 'finished_at',
};

function toJob(r: Row): Job {
  return {
    id: r.id as number,
    kind: r.kind as string,
    status: r.status as JobStatus,
    progress: r.progress as number,
    total: r.total as number | null,
    message: r.message as string | null,
    error: r.error as string | null,
    createdAt: r.created_at as number,
    finishedAt: r.finished_at as number | null,
  };
}

export function getJob(db: DatabaseSync, id: number): Job | null {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  return row ? toJob(row) : null;
}

export function createJob(db: DatabaseSync, kind: string): Job {
  const res = db.prepare("INSERT INTO jobs (kind, status, created_at) VALUES (?, 'queued', ?)").run(kind, Date.now());
  return getJob(db, Number(res.lastInsertRowid))!;
}

export function updateJob(db: DatabaseSync, id: number, patch: JobPatch): void {
  const keys = (Object.keys(patch) as (keyof JobPatch)[]).filter((k) => patch[k] !== undefined);
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${COLUMNS[k]} = ?`).join(', ');
  db.prepare(`UPDATE jobs SET ${sets} WHERE id = ?`).run(...keys.map((k) => patch[k] as string | number | null), id);
}

export function findActiveJob(db: DatabaseSync, kind: string): Job | null {
  const row = db
    .prepare("SELECT * FROM jobs WHERE kind = ? AND status IN ('queued', 'running') ORDER BY id DESC LIMIT 1")
    .get(kind);
  return row ? toJob(row) : null;
}

/** Marks jobs left over from a previous process as failed. Call once on startup. */
export function recoverInterruptedJobs(db: DatabaseSync, now: number): number {
  const res = db
    .prepare("UPDATE jobs SET status = 'error', error = 'interrupted by restart', finished_at = ? WHERE status IN ('queued', 'running')")
    .run(now);
  return Number(res.changes);
}

export function runJob(db: DatabaseSync, kind: string, work: (report: Report) => Promise<string | void>): Job {
  const job = createJob(db, kind);
  updateJob(db, job.id, { status: 'running' });
  const report: Report = (progress, total, message) => updateJob(db, job.id, { progress, total, message });
  void (async () => {
    try {
      const message = await work(report);
      updateJob(db, job.id, { status: 'done', message: message ?? undefined, finishedAt: Date.now() });
    } catch (e) {
      try {
        updateJob(db, job.id, { status: 'error', error: e instanceof Error ? e.message : String(e), finishedAt: Date.now() });
      } catch (updateError) {
        console.error(`job ${job.id} could not be marked as failed`, updateError);
      }
    }
  })();
  return getJob(db, job.id)!;
}

export async function waitForJob(db: DatabaseSync, id: number, timeoutMs = 5000): Promise<Job> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const job = getJob(db, id);
    if (!job) throw new Error(`Job ${id} not found`);
    if (job.status === 'done' || job.status === 'error') return job;
    if (Date.now() >= deadline) throw new Error(`Job ${id} did not finish within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

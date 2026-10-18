import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './app.js';
import { openDb } from './db/db.js';
import { backupDb } from './db/backup.js';
import { backfillMistakeCards } from './srs/backfill.js';
import { requeuePending } from './analysis/queue.js';
import { closeEnginePool, lazyEnginePool } from './engine/pool.js';
import { recoverInterruptedJobs } from './jobs.js';
import { syncLessonCards } from './course/lesson-cards.js';
import { loadLessons } from './course/load.js';
import type { Lesson } from '../shared/types.js';
import { loadAllRepertoires } from './repertoire/load.js';
import { refreshOpenings } from './repertoire/refresh.js';
import type { Repertoire } from './repertoire/types.js';

if (existsSync('.env')) process.loadEnvFile('.env');

const DEFAULT_DB_PATH = 'data/chess.db';
const dbPath = process.env.CHESS_DB_PATH || DEFAULT_DB_PATH;
const port = Number(process.env.PORT) || 8787;
let handler: ((req: Request) => Response | Promise<Response>) | null = null;
const server = serve(
  { fetch: (req) => (handler ? handler(req) : new Response('starting', { status: 503 })), hostname: '127.0.0.1', port },
  (info) => {
    // The port is ours: only now touch the DB and start background work.
    mkdirSync(dirname(dbPath), { recursive: true });
    const db = openDb(dbPath);

    const backupDir =
      process.env.BACKUP_DIR || (dbPath === DEFAULT_DB_PATH ? join(dirname(dbPath), 'backups') : null);
    if (backupDir) {
      const runBackup = () => {
        try {
          backupDb(db, backupDir, new Date());
        } catch (err) {
          console.error('db backup failed:', err);
        }
      };
      runBackup();
      setInterval(runBackup, 24 * 60 * 60 * 1000).unref();
    }
    recoverInterruptedJobs(db, Date.now());
    requeuePending(db, { pool: lazyEnginePool });
    backfillMistakeCards(db, lazyEnginePool);
    let repertoires: Repertoire[] = [];
    try {
      repertoires = loadAllRepertoires();
      refreshOpenings(db, repertoires);
    } catch (err) {
      console.error('opening card sync or leak scan failed:', err);
    }
    let lessons: Lesson[] = [];
    try {
      lessons = loadLessons();
      syncLessonCards(db, lessons);
    } catch (err) {
      console.error('lesson card sync failed:', err);
    }
    const app = createApp({ db, repertoires, lessons });

    if (existsSync('dist')) {
      app.use('/*', serveStatic({ root: './dist' }));
      app.get('*', serveStatic({ path: './dist/index.html' }));
    }
    handler = app.fetch;
    console.log(`chess-coach listening on http://127.0.0.1:${info.port}`);
  },
);

server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use — another chess-coach server is running?`);
    process.exit(1);
  }
  throw err;
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void closeEnginePool().finally(() => process.exit(0));
  });
}

import { availableParallelism } from 'node:os';
import { UciEngine, type EngineLine } from './uci.js';
import { resolveStockfishPath } from './stockfish-path.js';

export interface Engine {
  analyse: UciEngine['analyse'];
  quit(): Promise<void>;
  readonly alive: boolean;
}

interface Waiter {
  resolve: (e: Engine) => void;
  reject: (e: Error) => void;
}

export function defaultPoolSize(): number {
  return Math.max(1, Math.min(availableParallelism() - 2, 8));
}

export class EnginePool {
  private readonly size: number;
  private readonly create: () => Promise<Engine>;
  private idle: Engine[] = [];
  private all = new Set<Engine>();
  private starting = 0;
  private waiters: Waiter[] = [];
  private closed = false;

  constructor(opts: { size: number; create: () => Promise<Engine> }) {
    this.size = Math.max(1, opts.size);
    this.create = opts.create;
  }

  async analyse(fen: string, opts: { nodes: number; multipv?: number }): Promise<EngineLine[]> {
    const engine = await this.acquire();
    try {
      const lines = await engine.analyse(fen, opts);
      this.release(engine);
      return lines;
    } catch (e) {
      this.discard(engine);
      throw e;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const w of this.waiters.splice(0)) w.reject(new Error('Engine pool is closed'));
    const engines = [...this.all];
    this.all.clear();
    this.idle = [];
    await Promise.all(engines.map((e) => e.quit().catch(() => undefined)));
  }

  private acquire(): Promise<Engine> {
    if (this.closed) return Promise.reject(new Error('Engine pool is closed'));
    return new Promise<Engine>((resolve, reject) => {
      this.waiters.push({ resolve, reject });
      this.pump();
    });
  }

  private release(engine: Engine): void {
    if (this.closed) return;
    if (!engine.alive) return this.discard(engine);
    this.idle.push(engine);
    this.pump();
  }

  private discard(engine: Engine): void {
    this.all.delete(engine);
    void engine.quit().catch(() => undefined);
    this.pump();
  }

  // Hand idle engines to waiters in FIFO order; start new engines up to `size`.
  private pump(): void {
    while (this.waiters.length > 0 && this.idle.length > 0) {
      this.waiters.shift()!.resolve(this.idle.pop()!);
    }
    while (this.waiters.length > this.starting && this.all.size + this.starting < this.size && !this.closed) {
      this.starting++;
      this.create().then(
        (engine) => {
          this.starting--;
          if (this.closed) {
            void engine.quit().catch(() => undefined);
            return;
          }
          this.all.add(engine);
          this.idle.push(engine);
          this.pump();
        },
        (err: Error) => {
          this.starting--;
          this.waiters.shift()?.reject(err);
          this.pump();
        },
      );
    }
  }
}

async function createStockfish(): Promise<Engine> {
  const engine = await UciEngine.start(resolveStockfishPath());
  try {
    await engine.setOptions({ Threads: 1, Hash: 64 });
  } catch (e) {
    await engine.quit().catch(() => undefined);
    throw e;
  }
  return engine;
}

let singleton: EnginePool | null = null;

export function getEnginePool(): EnginePool {
  singleton ??= new EnginePool({ size: defaultPoolSize(), create: createStockfish });
  return singleton;
}

export async function closeEnginePool(): Promise<void> {
  const pool = singleton;
  singleton = null;
  await pool?.close();
}

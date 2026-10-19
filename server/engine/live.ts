import { UciEngine, type EngineLines } from './uci.js';
import { resolveStockfishPath } from './stockfish-path.js';

export const LIVE_MOVETIME_MS = 700;

export interface LiveOptions { multipv: 3; movetimeMs: number; signal: AbortSignal }

interface LiveProcess {
  analyse: UciEngine['analyse'];
  stop(): Promise<void>;
  quit(): Promise<void>;
  readonly alive: boolean;
}

const abortError = (): Error => Object.assign(new Error('The live analysis was stopped'), { name: 'AbortError' });
export const isAbortError = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError';

async function createStockfish(): Promise<LiveProcess> {
  const engine = await UciEngine.start(resolveStockfishPath());
  try {
    await engine.setOptions({ Threads: 1, Hash: 64 });
  } catch (e) {
    await engine.quit().catch(() => undefined);
    throw e;
  }
  return engine;
}

/** One dedicated Stockfish process for the live eval. Starts on first use. One search at a time: a new call stops the old one. */
export class LiveEngine {
  private readonly create: () => Promise<LiveProcess>;
  private process: Promise<LiveProcess> | null = null;
  private running: Promise<unknown> | null = null;
  private seq = 0;
  private closed = false;

  constructor(opts: { create?: () => Promise<LiveProcess> } = {}) {
    this.create = opts.create ?? createStockfish;
  }

  /** Rejects with an AbortError when a newer call or the signal stopped this search. */
  async analyse(fen: string, opts: LiveOptions): Promise<EngineLines> {
    if (opts.signal.aborted) throw abortError();
    const ticket = ++this.seq;
    const engine = await this.engine();
    const previous = this.running;
    if (previous) {
      await engine.stop();
      await previous.catch(() => undefined);
    }
    if (ticket !== this.seq || opts.signal.aborted) throw abortError();
    const onAbort = () => void engine.stop();
    opts.signal.addEventListener('abort', onAbort, { once: true });
    const run = engine.analyse(fen, { movetimeMs: opts.movetimeMs, multipv: opts.multipv });
    this.running = run;
    try {
      const lines = await run;
      if (ticket !== this.seq || opts.signal.aborted) throw abortError();
      return lines;
    } finally {
      opts.signal.removeEventListener('abort', onAbort);
      if (this.running === run) this.running = null;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    this.seq++;
    const process = this.process;
    this.process = null;
    if (!process) return;
    const engine = await process.catch(() => null);
    await engine?.stop();
    await engine?.quit().catch(() => undefined);
  }

  private engine(): Promise<LiveProcess> {
    if (this.closed) return Promise.reject(new Error('Live engine is closed'));
    this.process ??= this.create().then(
      (p) => p,
      (e: Error) => {
        this.process = null;
        throw e;
      },
    );
    return this.process.then((p) => {
      if (p.alive) return p;
      this.process = null;
      return this.engine();
    });
  }
}

let singleton: LiveEngine | null = null;

export async function closeLiveEngine(): Promise<void> {
  const live = singleton;
  singleton = null;
  await live?.close();
}

/** Facade that creates the real live engine on first use. */
export const lazyLiveEngine: Pick<LiveEngine, 'analyse'> = {
  analyse: (fen, opts) => (singleton ??= new LiveEngine()).analyse(fen, opts),
};

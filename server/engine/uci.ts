import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { EngineScore } from '../../shared/types.js';
import { parseInfoLine, selectLines, type ParsedInfo } from './uci-parse.js';

export interface EngineLine { multipv: number; score: EngineScore; pv: string[] }
/** The lines of a search. `nodes` is the node count the search reached (UCI `info nodes`), when known. */
export type EngineLines = EngineLine[] & { nodes?: number };

const NODES = / nodes (\d+)/;

export class EngineTimeoutError extends Error {
  constructor(message = 'Engine timed out') {
    super(message);
    this.name = 'EngineTimeoutError';
  }
}

interface Pending {
  onLine: (line: string) => boolean; // returns true when the request is complete
  resolve: () => void;
  reject: (e: Error) => void;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export class UciEngine {
  private pending: Pending | null = null;
  private buffer = '';
  private _alive = true;
  private busy = false;
  private searching: Promise<void> | null = null;

  private constructor(private readonly proc: ChildProcessWithoutNullStreams) {
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk: string) => this.onData(chunk));
    proc.stderr.resume();
    proc.stdin.on('error', (e) => this.onExit(e));
    proc.on('error', (e) => this.onExit(e));
    proc.on('exit', () => this.onExit(new Error('Engine process exited')));
  }

  get alive(): boolean {
    return this._alive;
  }

  static async start(path: string): Promise<UciEngine> {
    const engine = new UciEngine(spawn(path, [], { stdio: ['pipe', 'pipe', 'pipe'] }));
    try {
      await engine.request('uci', (l) => l === 'uciok', 10_000);
      await engine.isReady();
    } catch (e) {
      engine.kill();
      throw e;
    }
    return engine;
  }

  async setOptions(o: Record<string, string | number>): Promise<void> {
    await this.exclusive(async () => {
      for (const [name, value] of Object.entries(o)) this.send(`setoption name ${name} value ${value}`);
      await this.isReady();
    });
  }

  /** Searches with `go nodes` or, when `movetimeMs` is set, `go movetime`. */
  async analyse(
    fen: string,
    opts: { nodes?: number; movetimeMs?: number; multipv?: number; timeoutMs?: number },
  ): Promise<EngineLines> {
    return this.exclusive(async () => {
      const multipv = opts.multipv ?? 1;
      const limit = opts.movetimeMs !== undefined ? `movetime ${opts.movetimeMs}` : `nodes ${opts.nodes}`;
      this.send(`setoption name MultiPV value ${multipv}`);
      await this.isReady();
      this.send(`position fen ${fen}`);
      const infos: ParsedInfo[] = [];
      let nodes = 0;
      const search = this.request(`go ${limit}`, (l) => {
        const info = parseInfoLine(l);
        if (info) infos.push(info);
        const n = l.startsWith('info') ? NODES.exec(l)?.[1] : undefined;
        if (n !== undefined) nodes = Math.max(nodes, Number(n));
        return l.startsWith('bestmove');
      }, opts.timeoutMs ?? (opts.movetimeMs ?? 0) + DEFAULT_TIMEOUT_MS);
      this.searching = search;
      try {
        await search;
      } finally {
        this.searching = null;
      }
      const lines: EngineLines = selectLines(infos, multipv);
      if (nodes > 0) lines.nodes = nodes;
      return lines;
    });
  }

  /** Sends `stop` and waits for the search to end with its `bestmove`. Does nothing when no search runs. */
  async stop(): Promise<void> {
    const search = this.searching;
    if (!search) return;
    try {
      this.send('stop');
    } catch {
      // The engine is gone; the search promise rejects by itself.
    }
    await search.catch(() => undefined);
  }

  // Reject a concurrent call before anything is written to stdin.
  private async exclusive<T>(fn: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('Engine is busy');
    this.busy = true;
    try {
      return await fn();
    } finally {
      this.busy = false;
    }
  }

  async quit(): Promise<void> {
    if (!this._alive) return;
    const exited = new Promise<void>((resolve) => this.proc.once('exit', () => resolve()));
    try {
      this.send('quit');
    } catch {
      this.kill();
    }
    const timer = setTimeout(() => this.kill(), 2000);
    await exited;
    clearTimeout(timer);
  }

  private isReady(): Promise<void> {
    return this.request('isready', (l) => l === 'readyok', 10_000);
  }

  private send(cmd: string): void {
    if (!this._alive) throw new Error('Engine is not running');
    this.proc.stdin.write(`${cmd}\n`);
  }

  private request(cmd: string, onLine: (line: string) => boolean, timeoutMs: number): Promise<void> {
    if (!this._alive) return Promise.reject(new Error('Engine is not running'));
    if (this.pending) return Promise.reject(new Error('Engine is busy'));
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new EngineTimeoutError());
        this.kill();
      }, timeoutMs);
      this.pending = {
        onLine,
        resolve: () => { clearTimeout(timer); resolve(); },
        reject: (e) => { clearTimeout(timer); reject(e); },
      };
      try {
        this.send(cmd);
      } catch (e) {
        this.fail(e as Error);
      }
    });
  }

  private fail(e: Error): void {
    const p = this.pending;
    this.pending = null;
    p?.reject(e);
  }

  private onData(chunk: string): void {
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim();
      this.buffer = this.buffer.slice(idx + 1);
      const p = this.pending;
      if (p && line && p.onLine(line)) {
        this.pending = null;
        p.resolve();
      }
    }
  }

  private onExit(e: Error): void {
    this._alive = false;
    this.fail(e);
  }

  private kill(): void {
    this._alive = false;
    this.proc.kill('SIGKILL');
  }
}

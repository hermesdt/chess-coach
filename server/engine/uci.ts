import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { EngineScore } from '../../shared/types.js';
import { parseInfoLine } from './uci-parse.js';

export interface EngineLine { multipv: number; score: EngineScore; pv: string[] }

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

  async analyse(
    fen: string,
    opts: { nodes: number; multipv?: number; timeoutMs?: number },
  ): Promise<EngineLine[]> {
    return this.exclusive(async () => {
      const multipv = opts.multipv ?? 1;
      this.send(`setoption name MultiPV value ${multipv}`);
      await this.isReady();
      this.send(`position fen ${fen}`);
      const best = new Map<number, EngineLine>();
      await this.request(`go nodes ${opts.nodes}`, (l) => {
        const info = parseInfoLine(l);
        if (info) best.set(info.multipv, { multipv: info.multipv, score: info.score, pv: info.pv });
        return l.startsWith('bestmove');
      }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
      return [...best.values()].sort((a, b) => a.multipv - b.multipv);
    });
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

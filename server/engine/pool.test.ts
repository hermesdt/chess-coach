import { describe, expect, it } from 'vitest';
import { EnginePool, defaultPoolSize, type Engine } from './pool.js';
import type { EngineLine } from './uci.js';

interface Call { fen: string; resolve: (l: EngineLine[]) => void; reject: (e: Error) => void }

class FakeEngine implements Engine {
  alive = true;
  quit_ = 0;
  calls: Call[] = [];
  constructor(private readonly log: Call[]) {}
  analyse(fen: string): Promise<EngineLine[]> {
    return new Promise((resolve, reject) => {
      const c = { fen, resolve, reject };
      this.calls.push(c);
      this.log.push(c);
    });
  }
  async quit(): Promise<void> {
    this.alive = false;
    this.quit_++;
  }
}

const tick = () => new Promise((r) => setTimeout(r, 0));
const LINE: EngineLine[] = [{ multipv: 1, score: { cp: 0, mate: null }, pv: [] }];

function setup(size: number) {
  const engines: FakeEngine[] = [];
  const log: Call[] = [];
  const pool = new EnginePool({
    size,
    create: async () => {
      const e = new FakeEngine(log);
      engines.push(e);
      return e;
    },
  });
  return { pool, engines, log };
}

describe('EnginePool', () => {
  it('never runs more than size calls concurrently, and starts engines lazily', async () => {
    const { pool, engines, log } = setup(2);
    expect(engines).toHaveLength(0);
    const ps = ['a', 'b', 'c', 'd'].map((f) => pool.analyse(f, { nodes: 1 }));
    await tick();
    expect(engines).toHaveLength(2);
    expect(log.map((c) => c.fen)).toEqual(['a', 'b']);
    log[0]!.resolve(LINE);
    await tick();
    expect(log.map((c) => c.fen)).toEqual(['a', 'b', 'c']);
    log[1]!.resolve(LINE);
    await tick();
    expect(log.map((c) => c.fen)).toEqual(['a', 'b', 'c', 'd']);
    log[2]!.resolve(LINE);
    log[3]!.resolve(LINE);
    await Promise.all(ps);
    expect(engines).toHaveLength(2);
  });

  it('serves the queue in FIFO order', async () => {
    const { pool, log } = setup(1);
    const ps = ['1', '2', '3'].map((f) => pool.analyse(f, { nodes: 1 }));
    for (let i = 0; i < 3; i++) {
      await tick();
      expect(log[i]!.fen).toBe(String(i + 1));
      log[i]!.resolve(LINE);
    }
    await Promise.all(ps);
  });

  it('replaces an engine after a rejection, propagates the error to that caller only, and continues', async () => {
    const { pool, engines, log } = setup(1);
    const p1 = pool.analyse('x', { nodes: 1 });
    const p2 = pool.analyse('y', { nodes: 1 });
    const p3 = pool.analyse('z', { nodes: 1 });
    const r1 = expect(p1).rejects.toThrow('boom');
    await tick();
    log[0]!.reject(new Error('boom'));
    await r1;
    await tick();
    expect(engines).toHaveLength(2);
    expect(engines[0]!.quit_).toBe(1);
    expect(log[1]!.fen).toBe('y');
    log[1]!.resolve(LINE);
    await expect(p2).resolves.toEqual(LINE);
    await tick();
    expect(log[2]!.fen).toBe('z');
    log[2]!.resolve(LINE);
    await expect(p3).resolves.toEqual(LINE);
    expect(engines).toHaveLength(2);
  });

  it('propagates a create failure to one waiter and keeps going', async () => {
    let n = 0;
    const good = new FakeEngine([]);
    const pool = new EnginePool({
      size: 1,
      create: async () => {
        if (n++ === 0) throw new Error('spawn failed');
        return good;
      },
    });
    const p1 = pool.analyse('a', { nodes: 1 });
    const p2 = pool.analyse('b', { nodes: 1 });
    const r1 = expect(p1).rejects.toThrow('spawn failed');
    await r1;
    await tick();
    good.calls[0]!.resolve(LINE);
    await expect(p2).resolves.toEqual(LINE);
  });

  it('quits all engines on close and rejects later calls', async () => {
    const { pool, engines, log } = setup(2);
    const p = pool.analyse('a', { nodes: 1 });
    await tick();
    log[0]!.resolve(LINE);
    await p;
    await pool.close();
    expect(engines.every((e) => e.quit_ === 1)).toBe(true);
    await expect(pool.analyse('b', { nodes: 1 })).rejects.toThrow('closed');
  });
});

describe('defaultPoolSize', () => {
  it('is between 1 and 8', () => {
    const n = defaultPoolSize();
    expect(n).toBeGreaterThanOrEqual(1);
    expect(n).toBeLessThanOrEqual(8);
  });
});

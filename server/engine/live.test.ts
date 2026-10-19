import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LIVE_MOVETIME_MS, LiveEngine } from './live.js';
import { UciEngine } from './uci.js';

const fake = fileURLToPath(new URL('./fixtures/fake-live-engine.mjs', import.meta.url));
const fenAt = (fullmove: number) => `rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 ${fullmove}`;
const opts = (signal = new AbortController().signal) => ({ multipv: 3 as const, movetimeMs: LIVE_MOVETIME_MS, signal });

let log: string;
const commands = () => readFileSync(log, 'utf8').split('\n').filter(Boolean);
let live: LiveEngine | null = null;
const make = () => (live = new LiveEngine({ create: () => UciEngine.start(fake) }));

beforeEach(() => {
  log = join(mkdtempSync(join(tmpdir(), 'live-')), 'log.txt');
  process.env.FAKE_LOG = log;
});
afterEach(async () => {
  await live?.close();
  live = null;
  delete process.env.FAKE_LOG;
  delete process.env.FAKE_DELAY_MS;
});

describe('LiveEngine', () => {
  it('uses a 700 ms search and returns three lines with the node count', async () => {
    expect(LIVE_MOVETIME_MS).toBe(700);
    const lines = await make().analyse(fenAt(2), opts());
    expect(lines.map((l) => l.score.cp)).toEqual([20, 15, 11]);
    expect(lines.nodes).toBe(1200);
    expect(commands()).toContain('go movetime 700');
    expect(commands()).toContain('setoption name MultiPV value 3');
  });

  it('starts the process lazily', async () => {
    make();
    expect(() => readFileSync(log)).toThrow();
    await live!.analyse(fenAt(1), opts());
    expect(commands()).toContain('uci');
  });

  it('stops the running search for a new call: only the second resolves', async () => {
    process.env.FAKE_DELAY_MS = '5000';
    const engine = make();
    const first = engine.analyse(fenAt(1), opts());
    const firstResult = first.then(() => 'resolved', (e: Error) => e.name);
    await new Promise((r) => setTimeout(r, 300));
    const second = await engine.analyse(fenAt(3), opts());
    expect(await firstResult).toBe('AbortError');
    expect(second.map((l) => l.score.cp)).toEqual([30, 25, 21]);
    const cmds = commands();
    expect(cmds.filter((c) => c === 'stop')).toHaveLength(1);
    expect(cmds.filter((c) => c.startsWith('go'))).toHaveLength(2);
    expect(cmds.indexOf('stop')).toBeLessThan(cmds.lastIndexOf(cmds.filter((c) => c.startsWith('position'))[1]!));
  });

  it('sends stop when the signal aborts and rejects with an AbortError', async () => {
    process.env.FAKE_DELAY_MS = '5000';
    const ctrl = new AbortController();
    const run = make().analyse(fenAt(1), opts(ctrl.signal));
    const outcome = run.then(() => 'resolved', (e: Error) => e.name);
    await new Promise((r) => setTimeout(r, 300));
    ctrl.abort();
    expect(await outcome).toBe('AbortError');
    expect(commands()).toContain('stop');
  });

  it('rejects at once when the signal is already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(make().analyse(fenAt(1), opts(ctrl.signal))).rejects.toMatchObject({ name: 'AbortError' });
    expect(() => readFileSync(log)).toThrow();
  });
});

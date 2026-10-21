import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EngineTimeoutError, UciEngine } from './uci.js';

const fake = fileURLToPath(new URL('./fixtures/fake-engine.mjs', import.meta.url));
const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('UciEngine with a fake process', () => {
  afterEach(() => {
    delete process.env.FAKE_ENGINE_MODE;
    delete process.env.FAKE_ENGINE_LOG;
  });

  it('rejects with EngineTimeoutError and dies when no bestmove arrives', async () => {
    process.env.FAKE_ENGINE_MODE = 'hang';
    const engine = await UciEngine.start(fake);
    await expect(engine.analyse(FEN, { nodes: 1, timeoutMs: 300 })).rejects.toBeInstanceOf(EngineTimeoutError);
    expect(engine.alive).toBe(false);
  });

  it('rejects the pending call when the process exits mid-search', async () => {
    process.env.FAKE_ENGINE_MODE = 'crash';
    const engine = await UciEngine.start(fake);
    await expect(engine.analyse(FEN, { nodes: 1 })).rejects.toThrow('Engine process exited');
    expect(engine.alive).toBe(false);
  });

  it('rejects a concurrent call with "Engine is busy" before writing to stdin', async () => {
    process.env.FAKE_ENGINE_MODE = 'hang';
    const engine = await UciEngine.start(fake);
    const first = engine.analyse(FEN, { nodes: 1, timeoutMs: 300 });
    await expect(engine.analyse(FEN, { nodes: 1 })).rejects.toThrow('Engine is busy');
    await expect(engine.setOptions({ Hash: 16 })).rejects.toThrow('Engine is busy');
    await expect(first).rejects.toBeInstanceOf(EngineTimeoutError);
  });

  describe('newGame', () => {
    const run = async (newGame?: boolean) => {
      const log = join(mkdtempSync(join(tmpdir(), 'fake-engine-')), 'log.txt');
      process.env.FAKE_ENGINE_LOG = log;
      const engine = await UciEngine.start(fake);
      await engine.analyse(FEN, { nodes: 1, newGame });
      await engine.quit();
      return readFileSync(log, 'utf8').trim().split('\n');
    };

    it('sends ucinewgame and isready before position and go', async () => {
      const cmds = await run(true);
      const from = cmds.indexOf('ucinewgame');
      expect(from).toBeGreaterThan(-1);
      expect(cmds.slice(from, from + 5)).toEqual([
        'ucinewgame',
        'isready',
        'setoption name MultiPV value 1',
        'isready',
        `position fen ${FEN}`,
      ]);
      expect(cmds).toContain('go nodes 1');
    });

    it('does not send ucinewgame by default', async () => {
      expect(await run()).not.toContain('ucinewgame');
    });
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { EngineTimeoutError, UciEngine } from './uci.js';

const fake = fileURLToPath(new URL('./fixtures/fake-engine.mjs', import.meta.url));
const FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

describe('UciEngine with a fake process', () => {
  afterEach(() => {
    delete process.env.FAKE_ENGINE_MODE;
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
});

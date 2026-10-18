import { spawnSync } from 'node:child_process';

export function resolveStockfishPath(): string {
  return process.env.STOCKFISH_PATH || 'stockfish';
}

export function isStockfishAvailable(path: string = resolveStockfishPath()): boolean {
  try {
    const r = spawnSync(path, [], { input: 'uci\nquit\n', timeout: 5000, encoding: 'utf8' });
    return r.status === 0 && typeof r.stdout === 'string' && r.stdout.includes('uciok');
  } catch {
    return false;
  }
}

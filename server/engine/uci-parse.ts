import type { EngineScore } from '../../shared/types.js';

export interface ParsedInfo { multipv: number; depth: number; score: EngineScore; pv: string[] }

export function parseInfoLine(line: string): ParsedInfo | null {
  const t = line.trim().split(/\s+/);
  if (t[0] !== 'info') return null;
  let multipv = 1;
  let depth = 0;
  let score: EngineScore | null = null;
  let pv: string[] | null = null;
  for (let i = 1; i < t.length; i++) {
    const tok = t[i];
    if (tok === 'depth') depth = Number(t[++i]);
    else if (tok === 'multipv') multipv = Number(t[++i]);
    else if (tok === 'score') {
      const kind = t[++i];
      const value = Number(t[++i]);
      if (Number.isNaN(value)) return null;
      if (kind === 'cp') score = { cp: value, mate: null };
      else if (kind === 'mate') score = { cp: null, mate: value };
      else return null;
      if (t[i + 1] === 'lowerbound' || t[i + 1] === 'upperbound') return null;
    } else if (tok === 'pv') {
      pv = t.slice(i + 1);
      break;
    }
  }
  if (!score || !pv || pv.length === 0) return null;
  return { multipv, depth, score, pv };
}

export function parseBestMove(line: string): string | null {
  const t = line.trim().split(/\s+/);
  if (t[0] !== 'bestmove' || !t[1] || t[1] === '(none)') return null;
  return t[1];
}

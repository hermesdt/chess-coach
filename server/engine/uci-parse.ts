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

export interface SelectedLine { multipv: number; score: EngineScore; pv: string[] }

const toLine = (i: ParsedInfo): SelectedLine => ({ multipv: i.multipv, score: i.score, pv: i.pv });

// Pick lines from ONE depth so they stay consistent. `infos` holds exact (non-bound) scores only.
export function selectLines(infos: ParsedInfo[], k: number): SelectedLine[] {
  const byDepth = new Map<number, Map<number, ParsedInfo>>();
  for (const i of infos) {
    if (i.multipv < 1 || i.multipv > k) continue;
    let m = byDepth.get(i.depth);
    if (!m) byDepth.set(i.depth, (m = new Map()));
    m.set(i.multipv, i);
  }
  const depths = [...byDepth.keys()].sort((a, b) => b - a);
  for (const d of depths) {
    const m = byDepth.get(d)!;
    if (m.size === k) {
      return [...m.values()].sort((a, b) => a.multipv - b.multipv).map(toLine);
    }
  }
  // Fallback: deepest line per multipv index, then drop repeated first moves.
  const deepest = new Map<number, ParsedInfo>();
  for (const d of [...depths].reverse()) for (const i of byDepth.get(d)!.values()) deepest.set(i.multipv, i);
  const seen = new Set<string>();
  const out: SelectedLine[] = [];
  for (const i of [...deepest.values()].sort((a, b) => a.multipv - b.multipv)) {
    if (seen.has(i.pv[0]!)) continue;
    seen.add(i.pv[0]!);
    out.push(toLine(i));
  }
  return out;
}

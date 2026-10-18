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

const dedupe = (lines: SelectedLine[]): SelectedLine[] => {
  const seen = new Set<string>();
  return lines.filter((l) => !seen.has(l.pv[0]!) && seen.add(l.pv[0]!));
};

// Stockfish prints the k lines as a batch per update; a new batch starts at multipv 1.
// `infos` holds exact (non-bound) scores only, so a batch with a dropped bound line is incomplete.
function splitBatches(infos: ParsedInfo[]): ParsedInfo[][] {
  const batches: ParsedInfo[][] = [];
  for (const i of infos) {
    if (i.multipv === 1 || batches.length === 0) batches.push([]);
    batches[batches.length - 1]!.push(i);
  }
  return batches;
}

export function selectLines(infos: ParsedInfo[], k: number): SelectedLine[] {
  const complete = splitBatches(infos).filter(
    (b) => b.length === k && b.every((i, idx) => i.multipv === idx + 1),
  );
  const uniform = complete.filter((b) => b.every((i) => i.depth === b[0]!.depth));
  // Prefer the last batch whose lines all share one depth: a batch cut off mid-update mixes depths, so
  // its scores are not comparable. Without such a batch, the last complete one is the best we have.
  const chosen = uniform.at(-1) ?? complete.at(-1);
  if (chosen) return dedupe(chosen.map(toLine));

  // Fallback: deepest line per multipv index (later wins ties).
  const deepest = new Map<number, ParsedInfo>();
  for (const i of infos) {
    if (i.multipv < 1 || i.multipv > k) continue;
    const prev = deepest.get(i.multipv);
    if (!prev || i.depth >= prev.depth) deepest.set(i.multipv, i);
  }
  return dedupe([...deepest.values()].sort((a, b) => a.multipv - b.multipv).map(toLine));
}

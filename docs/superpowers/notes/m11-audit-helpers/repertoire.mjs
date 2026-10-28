import { readFileSync } from 'node:fs';
import { Chess } from '../../../../node_modules/chess.js/dist/esm/chess.js';

const ROOT = '/Users/alvarodurantovar/source/github/chess-m11/content/';
const REP = ROOT + 'repertoires/';

export function loadNodes(file, prefixes) {
  const path = file.includes('/') ? file : REP + (file.endsWith('.json') ? file : file + '.json');
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const out = [];
  const walk = (n, fen, parentId, parentLevel, ply) => {
    const g = new Chess(fen);
    const m = g.move(n.san);
    const id = parentId ? parentId + ' ' + m.san : m.san;
    const level = n.level ?? parentLevel ?? 1;
    if (prefixes.some((p) => id === p || id.startsWith(p + ' '))) out.push({ id, san: m.san, comment: n.comment ?? null, fenBefore: fen, fenAfter: g.fen(), level, ply });
    for (const c of n.children ?? []) walk(c, g.fen(), id, level, ply + 1);
  };
  for (const r of raw.moves) walk(r, new Chess().fen(), null, 1, 1);
  return out;
}

export function loadLesson(file) {
  const l = JSON.parse(readFileSync(file.includes('/') ? file : ROOT + 'lessons/' + file, 'utf8'));
  return {
    id: l.id, level: l.level, summary: l.summary, body: l.body,
    exercises: (l.exercises ?? []).map((e) => ({ id: e.id, fen: e.fen, prompt: e.prompt, solution: e.solution, explanation: e.explanation })),
  };
}

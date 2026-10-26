import { spawn, execSync } from 'node:child_process';
import { Chess } from '../../../../node_modules/chess.js/dist/esm/chess.js';

const WIN_K = 0.00368208; // repo formula: server/analysis/winpct.ts
export function winPct({ cp = null, mate = null }) {
  if (mate !== null && mate !== undefined) return mate > 0 ? 100 : 0;
  const c = Math.max(-1000, Math.min(1000, cp ?? 0));
  return 50 + 50 * (2 / (1 + Math.exp(-WIN_K * c)) - 1);
}

let sf = null, buf = '', waiters = [];
function start() {
  if (sf) return;
  sf = spawn(execSync('which stockfish').toString().trim());
  sf.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      waiters = waiters.filter((w) => !w(line));
    }
  });
}
const send = (c) => sf.stdin.write(c + '\n');
const until = (pred, onLine) =>
  new Promise((res) => waiters.push((l) => { onLine?.(l); if (pred(l)) { res(); return true; } return false; }));
let queue = Promise.resolve();

export function evalFen(fen, { nodes = 1_000_000, multipv = 3, searchmoves } = {}) {
  const run = async () => {
    start();
    const white = fen.split(' ')[1] === 'w';
    const best = new Map();
    send('ucinewgame');
    send('isready');
    await until((l) => l === 'readyok');
    send('setoption name MultiPV value ' + multipv);
    send('position fen ' + fen);
    const done = until((l) => l.startsWith('bestmove'), (l) => {
      if (!l.startsWith('info') || !l.includes(' pv ') || !l.includes(' score ')) return;
      const t = l.split(' ');
      const g = (k) => t[t.indexOf(k) + 1];
      const mp = Number(t.includes('multipv') ? g('multipv') : 1);
      const sc = t.indexOf('score');
      const kind = t[sc + 1], val = Number(t[sc + 2]);
      best.set(mp, { multipv: mp, [kind === 'mate' ? 'mate' : 'scoreCp']: val * (white ? 1 : -1), pv: t.slice(t.indexOf('pv') + 1) });
    });
    send('go nodes ' + nodes + (searchmoves?.length ? ' searchmoves ' + searchmoves.join(' ') : ''));
    await done;
    const lines = [...best.values()].sort((a, b) => a.multipv - b.multipv);
    for (const ln of lines) {
      ln.winPct = winPct({ cp: ln.scoreCp ?? null, mate: ln.mate ?? null });
      const g = new Chess(fen);
      ln.pvSan = [];
      for (const u of ln.pv) {
        try { ln.pvSan.push(g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] }).san); } catch { break; }
      }
    }
    return { lines };
  };
  const p = queue.then(run);
  queue = p.catch(() => {});
  return p;
}

/** Win-% loss (mover's view) of each SAN versus the best move. */
export async function compareMoves(fen, sanList, opts = {}) {
  const white = new Chess(fen).turn() === 'w';
  const mine = (w) => (white ? w : 100 - w);
  const top = await evalFen(fen, { ...opts, multipv: 1 });
  const bestWin = mine(top.lines[0].winPct);
  const moves = [];
  for (const san of sanList) {
    const m = new Chess(fen).move(san);
    const uci = m.from + m.to + (m.promotion ?? '');
    const l = (await evalFen(fen, { ...opts, multipv: 1, searchmoves: [uci] })).lines[0];
    moves.push({ san, uci, scoreCp: l.scoreCp, mate: l.mate, moverWinPct: mine(l.winPct), loss: Math.max(0, bestWin - mine(l.winPct)), pvSan: l.pvSan });
  }
  return { best: { san: top.lines[0].pvSan[0], moverWinPct: bestWin }, moves };
}

export function close() { if (sf) { send('quit'); sf = null; } }

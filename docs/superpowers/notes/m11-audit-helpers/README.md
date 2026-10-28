# M11 audit helpers
Run from this folder: `node test.mjs`. Needs `stockfish` on PATH. chess.js is imported
relative to the worktree. START = standard start FEN.

## engine.mjs
- `evalFen(fen,{nodes,multipv,searchmoves:['e2e4']})` -> `{lines:[{multipv,scoreCp|mate,winPct,pv,pvSan}]}`
  White's view. Sends ucinewgame+isready first. Calls are queued.
  `await evalFen(START,{nodes:200000})`
- `compareMoves(fen,['e4','f3'],opts)` -> `{best,moves:[{san,loss,moverWinPct}]}`; `loss` = win-% lost vs best.
- `winPct({cp,mate})` (repo formula), `close()`.

## board.mjs
- `after(fen,['e4','c6'])` -> FENs, start first. Throws `Illegal move "X" at ply N`.
- `attackersTable(fen)` -> `{e2:{piece:'wP',attackedBy:[],guardedBy:['d1',..]}}`
- `pinned(fen)` -> `[{square,piece}]`, both colors, absolute pins. Legal-move test; also works in check.
- `lineOpen(fen,'c8','h3')` -> `{open,blockers:[{square,piece}]}`
- `bishopMoves(fen,'c8')` -> `['Bd7','Bxe4',..]`. Board scan, pseudo-moves: ignores turn, pins, check.

## repertoire.mjs
- `loadNodes('caro-kann',['e4 c6 d4 d5 e5'])` -> `[{id,san,comment,fenBefore,fenAfter,level,ply}]`
  (name resolves in chess-m11/content/repertoires, or pass a path).
- `loadLesson('11-caro-kann-plans.json')` -> `{id,level,summary,body,exercises}`

## Test result (`node test.mjs`, all as expected)
- after: 6 FENs; `Ke5` throws. lineOpen c8-h3 after `e4 c6 d4 d5 Nc3`: open.
- attackersTable START e2: guarded d1,e1,f1,g1. pinned: START none; Ne2 pinned; Ne2 in check not pinned;
  Nd2 pinned while in check: found.
- bishopMoves off-turn Bf1 after e4 e5: Be2 Bd3 Bc4 Bb5 Ba6 (turn kept). evalFen START 200k: 0.5 s, e4 +25cp, 3 lines.
- compareMoves START: e4 0.0, Nc3 2.2, f3 7.9. loadNodes: 68 nodes, 53 commented. loadLesson: 6 exercises.

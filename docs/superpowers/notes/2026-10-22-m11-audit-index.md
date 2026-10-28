# M11 audit index

Plan: `docs/superpowers/plans/2026-10-22-m11-content-audit.md`.
Spec: `docs/superpowers/specs/2026-10-20-content-audit-design.md`.
Protocol: `2026-10-22-m11-audit-protocol.md`. Owner reports: `2026-10-22-m11-reported-problems.md`.

## Result

- 1543 claims checked with chess.js and Stockfish 19.
- 23 false, 154 misleading and 5 unverifiable claims found. All were fixed.
- Every report has a Re-check section. No false or misleading claim stays open.
- No tree node, move, solution or exercise id changed in M11.
- The owner's example (Caro-Kann "open the c8 bishop") was checked and fixed in `963d710`.

## Batches

| Batch | Report | Claims | False | Misleading | Unverifiable |
|---|---|---|---|---|---|
| ck-sidelines | `...-audit-ck-sidelines.md` | 84 | 1 | 9 | 1 |
| ck-advance | `...-audit-ck-advance.md` | 87 | 2 | 6 | 0 |
| ck-exchange-fantasy | `...-audit-ck-exchange-fantasy.md` | 86 | 1 | 5 | 0 |
| ck-classical | `...-audit-ck-classical.md` | 56 | 2 | 3 | 0 |
| lo-nf6 | `...-audit-lo-nf6.md` | 89 | 0 | 10 | 1 |
| lo-d5-rest | `...-audit-lo-d5-rest.md` | 81 | 2 | 6 | 0 |
| lo-other-replies | `...-audit-lo-other-replies.md` | 91 | 2 | 8 | 0 |
| sl-main-nf3 | `...-audit-sl-main-nf3.md` | 96 | 0 | 5 | 0 |
| sl-nc3-exchange | `...-audit-sl-nc3-exchange.md` | 59 | 1 | 2 | 0 |
| sl-second-moves | `...-audit-sl-second-moves.md` | 60 | 1 | 6 | 0 |
| sl-anti-london | `...-audit-sl-anti-london.md` | 72 | 2 | 4 | 0 |
| sl-first-moves | `...-audit-sl-first-moves.md` | 50 | 0 | 5 | 0 |
| lessons 1-5 | `...-audit-ls-1-5.md` | 87 | 4 | 22 | 0 |
| lessons 6-10 | `...-audit-ls-6-10.md` | 107 | 5 | 16 | 2 |
| lessons 11-15 | `...-audit-ls-11-15.md` | 125 | 0 | 19 | 1 |
| lessons 16-20 | `...-audit-ls-16-20.md` | 128 | 0 | 7 | 0 |
| lessons 21-25 | `...-audit-ls-21-25.md` | 151 | 0 | 11 | 0 |
| guides | `...-audit-guides.md` | 34 | 0 | 10 | 0 |

## Tools added

- `pnpm check:sequences`: replays every move sequence in a content text. It is now strict by default and part of `pnpm validate:content`. Warnings stay for set-up lists and skipped moves that the text names.

## Questions for the owner

Each is a move choice. No text calls these moves best. Nothing changed without your decision.

- London: Qc1 at `d4 Nf6 Bf4 c5 e3 Qb6` (about 0.6 pawn behind Nc3) and in the `d4 d5` line (about 0.85). Also c3 versus Ne5, Nxb3 versus axb3, Be2 versus a3, and the missing 6...Nxd4 reply.
- Caro-Kann: tree moves 4 to 11 win % behind the engine (3...Bg4, 4...e6, Qh4 ...dxe4, Qf3 ...Nf6, 5...Bd7 and others). The guide repeats the first, second and third of these.
- Slav: the missing 9.Nxd1 and 5.Qxf3 lines, ...Qb6 after `d4 d5 Bg5 c5 e3`, the short final form in vs-c4, `vs-nf3` ...e6 (about 9 win % behind ...Qxd4). `c4 c6 Nf3 d5` and `Nf3 d5 c4 c6` reach one position with different children.
- Lessons: 10 `make-luft` (f3, f4, h4, g4 also stop the mate but are marked wrong), 11 `bishop-d6`, 12 `keep-bishop` (add Bg5?), 19 exercise id `queen-sacrifice-mate` (Qxc8+ takes a knight).

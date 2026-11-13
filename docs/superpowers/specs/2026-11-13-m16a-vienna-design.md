# M16a: Vienna Repertoire

Status: proceeding on the owner's instruction to make the remaining choices.

## Intent

Add a second White repertoire, not a replacement for the London. The owner
wants an attacking 1.e4 option with the same depth as the existing repertoire.
M16a covers 1.e4 e5; Sicilian, French, Caro-Kann and other first replies belong
to M16b-d. Work inline, without subagents.

## Approach

Use the existing repertoire JSON, opening guide, drills, leak detection and
middlegame plan formats. No new training system or dependencies. A single
Vienna repertoire is simpler than separate repertoires for each defence and
avoids ambiguous matching within this milestone. The alternative of replacing
London contradicts the owner's request. An opening-selection settings system
would broaden the milestone unnecessarily: both White repertoires are active.

## Content

- ID `vienna`, name `Vienna Game`, White; about 300 move nodes, levels 1-3.
- Start with e4 e5 Nc3. Against Nf6, build around f4; cover the central d5
  counterstrike, acceptance and common retreats. Against Nc6 and Bc5, choose
  sound development and only use f4 where engine validation supports it.
- Include secondary second moves such as d6, Bb4 and c6. Do not fabricate
  rare branches just to reach a node count. Depth grows behind level gates.
- One White recommendation at each repertoire position; multiple opponent
  replies. Comments explain a board-verifiable purpose, not promised wins.
- Guide: why, routes, piece jobs, deviations, middlegame ideas and concrete
  mistakes. Two validated plan cards, each with three exercises, tied to
  actual tree positions. No AI-generated chess facts.
- Sources for opening identity: Lichess Vienna Game and Vienna Gambit opening
  pages. Move choices and continuations must pass chess.js and Stockfish;
  explanatory prose is original, not copied from sources.

## Integration

- Preserve one opening card per position and its FSRS history. When multiple
  repertoires share it, name all repertoires and accept their recommended moves.
  Explain each recommendation in its repertoire context. Single-repertoire
  prompts remain unchanged.
- Opening tabs: London, Vienna, Caro-Kann, Slav; London stays first.
- Add `vienna` to the existing plan group schema, types and Plans page.
  Existing game-plan matching uses the group/repertoire ID directly.
- Games starting d4 still match London; e4 games match Vienna, with unsupported
  Black replies out of book, not mistaken for a London leak. Future e4 parts
  will need shared-root repertoire matching; that is not silently solved here.

## Constraints And Anti-goals

No live database writes for tests. Back up SQLite before integrating content
that startup syncs. No schema migration or review quota change. Preserve
existing cards and scheduling. Do not claim the Vienna guarantees an attack,
or teach an unsound trap as a main line. Tests never use network or real engines.

## Verification

TDD for shared-card prompts, tab order and plan group support. Replay every
content move with chess.js; validate own moves and teaching examples using
Stockfish at the established million-node budget. Review every prose claim
against its actual board. Full tests, typecheck, lint, build, sequence check,
content validation and isolated browser smoke before merge and push.

## Builder Choices

Exact branch allocation, levels, move-order coverage and plan positions are
the implementer's choices, constrained by the engine and the beginner audience.
The node count is a depth target, not permission to pad content.

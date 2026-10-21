import type { Classification, Color, GameAnalysis, GameDetail, GameResult, Tag } from '../../shared/types.js';
import { LEVEL_TAGS } from '../../shared/lessons.js';
import { selectKeyMoments } from '../analysis/key-moments.js';
import type { CurrentLevel } from '../level.js';
import { groundingSet } from './grounding.js';

const MAX_BEST_LINE = 6;

export interface KeyMomentFacts {
  ply: number; moveNumber: number; side: Color; fen: string; played: string; best: string; bestLine: string[];
  winBefore: number; winAfter: number; tags: Tag[]; classification: Classification;
}
export interface GameFacts {
  level: CurrentLevel['level']; rating: number | null;
  userColor: Color | null; userRating: number | null; opponentRating: number | null;
  result: GameResult | null; opening: string | null; movesSan: string[]; keyMoments: KeyMomentFacts[];
}

/** The facts the coach may talk about. Key moments are chosen for the given level, not the stored ones. */
export function gameFacts(game: GameDetail, analysis: GameAnalysis, lvl: Pick<CurrentLevel, 'level' | 'rating'>): GameFacts {
  const byPly = new Map(analysis.moves.map((m) => [m.ply, m]));
  const keyMoments: KeyMomentFacts[] = [];
  for (const k of selectKeyMoments(analysis.moves, lvl.level)) {
    const m = byPly.get(k.ply);
    if (!m) continue;
    keyMoments.push({
      ply: m.ply, moveNumber: Math.ceil(m.ply / 2), side: m.color, fen: m.fenBefore, played: m.san, best: m.bestSan,
      bestLine: m.pvSan.slice(0, MAX_BEST_LINE), winBefore: Math.round(m.winBefore), winAfter: Math.round(m.winAfter),
      tags: m.tags.filter((t) => LEVEL_TAGS[lvl.level].includes(t)), classification: m.classification,
    });
  }
  const white = game.userColor === 'white';
  return {
    level: lvl.level, rating: lvl.rating, userColor: game.userColor,
    userRating: game.userColor === null ? null : white ? game.whiteElo : game.blackElo,
    opponentRating: game.userColor === null ? null : white ? game.blackElo : game.whiteElo,
    result: game.result, opening: game.openingName, movesSan: game.moves.map((m) => m.san), keyMoments,
  };
}

/** Text form of the facts. It goes into the prompt and sets which plain squares the answer may name. */
export const factsText = (facts: GameFacts): string => JSON.stringify(facts, null, 2);

/** Every SAN in the facts (game moves and best lines), plus the squares the facts name. */
export function allowedSan(facts: GameFacts): Set<string> {
  const sans = [...facts.movesSan, ...facts.keyMoments.flatMap((k) => [k.played, k.best, ...k.bestLine])];
  return groundingSet(sans, factsText(facts));
}

/** What one key moment's text may name: its own moves, the moves played before it, and the squares in its facts. */
export function momentAllowedSan(facts: GameFacts, moment: KeyMomentFacts): Set<string> {
  const before = facts.movesSan.slice(0, Math.max(0, moment.ply - 1));
  return groundingSet([...before, moment.played, moment.best, ...moment.bestLine], JSON.stringify(moment));
}

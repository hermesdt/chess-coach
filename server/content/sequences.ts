import { existsSync, readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { Chess } from 'chess.js';
import { listLessonFiles, loadLesson } from '../course/load.js';
import { listGuideFiles, loadGuide } from '../guides/load.js';
import { replayBoard } from '../plans/board.js';
import { listPlanFiles, loadPlan } from '../plans/load.js';
import { listRepertoireFiles, loadAllRepertoires, loadRepertoire } from '../repertoire/load.js';
import type { RepNode, Repertoire, ValidationIssue } from '../repertoire/types.js';
import type { GuideFile, Lesson } from '../../shared/types.js';
import type { PlanBoard, PlanFile } from '../../shared/plans.js';

const START_FEN = new Chess().fen();

/** A piece move, a pawn capture, or castling. Always a move when it matches. */
const STRONG = String.raw`(?:O-O-O|O-O|[KQRBN](?:[a-h][1-8]|[a-h]|[1-8])?x?[a-h][1-8]|[a-h]x[a-h][1-8](?:=[QRBN])?)[+#]?`;
/** A pawn push such as e4 or e8=Q. Prose names squares this way too, so it needs a move context. */
const PUSH = String.raw`[a-h][1-8](?:=[QRBN])?[+#]?`;
const NUMBER = String.raw`(?:\d+\s*(?:\.\.\.|…|\.)\s*|(?:\.\.\.|…)\s*)`;
const TOKEN = new RegExp(String.raw`(?<![\w-])(?:(${NUMBER})?(${STRONG}|${PUSH})[!?]*)(?![\w-])`, 'gu');

interface Candidate { san: string; start: number; end: number; push: boolean; num: boolean }

/** A move named as a threat or a plan ("threatens Qe8#", "prepares ...e5", "plans e3") is not part of the line. */
const PLAN_WORD =
  /\b(?:threat|threaten|threatens|threatened|prepare|prepares|prepared|plan|plans)\s+(?:(?:to|a|the)\s+)?(?:[^\s,.;]+(?:\s*,\s*|\s+(?:and|or|then)\s+))*$/iu;

/** A reference to another part of the text ("as in the ...d5 part", "the plan of the ...Qb6 part") is not a move to play. */
const REF_WORD = /\b(?:as in|plan of|line of|see|like in|same as in)\s+the\s+$/iu;

/** A verb right before a bare pawn push shows it is a move: "After e3", "Play c3", "push e4". */
const MOVE_WORD = /\b(?:after|play|plays|played|push|pushes)\s+$/iu;

function candidates(sentence: string): Candidate[] {
  const cands: Candidate[] = [];
  const pushRe = new RegExp(`^${PUSH}$`, 'u');
  for (const m of sentence.matchAll(TOKEN)) {
    const san = m[2]!.replace(/[!?]+$/u, '');
    cands.push({ san, start: m.index!, end: m.index! + m[0].length, push: pushRe.test(san), num: !!m[1] });
  }
  const gap = (a: number, b: number) => /^\s*$/u.test(sentence.slice(a, b));
  return cands.filter((c, i) => {
    if (PLAN_WORD.test(sentence.slice(0, c.start)) || REF_WORD.test(sentence.slice(0, c.start))) return false;
    if (!c.push || c.num) return true;
    if (MOVE_WORD.test(sentence.slice(0, c.start))) return true;
    const prev = cands[i - 1];
    const next = cands[i + 1];
    return (prev !== undefined && gap(prev.end, c.start)) || (next !== undefined && gap(c.end, next.start));
  });
}

/**
 * SAN tokens in order. Move numbers, "..." and dots are dropped. A bare pawn push
 * (e4) counts only after a move number, an ellipsis, or next to another move token.
 */
export function extractSan(sentence: string): string[] {
  return candidates(sentence).map((c) => c.san);
}

/** Moves joined only by commas, "and", "or" or "then" are a list of plans or options, not one line. */
const LIST_GAP = /^[\s,]*(?:(?:and|or|then|not|instead of|[a-h][1-8](?:=[QRBN])?)[\s,]+)*$/iu;

/** The ellipsis or move number in front of a candidate: "...", "3...", "3.", or "". */
function marker(sentence: string, c: Candidate): string {
  const g = /^\s*(?<number>\d*)\s*(?<dots>\.\.\.|…|\.)?/u.exec(sentence.slice(c.start, c.end))?.groups;
  return `${g?.number ?? ''}${g?.dots ?? ''}`;
}

/** Two neighbours that are both black ("...c6 ... d5") or numbered alternatives ("3.Nd2 ... 3.Nc3") are not one line. */
function mixedSides(sentence: string, a: Candidate, b: Candidate): boolean {
  const dots = (c: Candidate) => /^\s*\d*\s*(?:\.\.\.|…)/u.test(sentence.slice(c.start, c.end));
  return dots(a) !== dots(b);
}

function sameSide(sentence: string, a: Candidate, b: Candidate): boolean {
  const ma = marker(sentence, a);
  const mb = marker(sentence, b);
  if (ma === '' || mb === '') return false;
  return ma === mb || (/^(\.\.\.|…)$/u.test(ma) && /^(\.\.\.|…)$/u.test(mb));
}

/**
 * The tokens that read as one line of play: a token that follows another one through
 * a list link ("Bd3, Nbd2 and c3", "...c5 or ...e5") is not a continuation and is left out.
 */
function lineTokens(sentence: string): { tokens: string[]; numbered: boolean } {
  const kept: Candidate[] = [];
  let prev: Candidate | undefined;
  for (const c of candidates(sentence)) {
    const between = prev === undefined ? '' : sentence.slice(prev.end, c.start);
    const isList = prev !== undefined && ((!/^\s*$/u.test(between) && LIST_GAP.test(between) && !mixedSides(sentence, prev, c)) || sameSide(sentence, prev, c));
    if (!isList) kept.push(c);
    prev = c;
  }
  return { tokens: kept.map((c) => c.san), numbered: kept[0]?.num ?? false };
}

/** The FEN after the tokens, or the count of tokens that replayed before the first illegal one. */
function replay(tokens: string[], fen: string): { fen: string } | { replayed: number } {
  let game: Chess;
  try {
    game = new Chess(fen);
  } catch {
    return { replayed: 0 };
  }
  let n = 0;
  for (const san of tokens) {
    try {
      game.move(san);
    } catch {
      return { replayed: n };
    }
    n += 1;
  }
  return { fen: game.fen() };
}

/** Replays the tokens from every start. `ends` holds the final FEN of each start that replayed in full. */
function replayAll(tokens: string[], numbered: boolean, starts: string[]): { ends: string[]; best: number } {
  const ends: string[] = [];
  let best = 0;
  // A line that starts with a move number (1.d4 d5 ...) may start from the initial position.
  for (const fen of numbered ? [...starts, START_FEN] : starts) {
    const r = replay(tokens, fen);
    if ('fen' in r) ends.push(r.fen);
    else best = Math.max(best, r.replayed);
  }
  return { ends, best };
}

/**
 * ok when the SAN tokens of the sentence replay legally from at least one start FEN. One token is not a sequence.
 * `replayed` counts only the tokens of the replayed run (list members and planned moves are left out),
 * so it can differ from `extractSan(...).length`.
 */
export function checkSequence(sentence: string, starts: string[]): { ok: boolean; replayed: number } {
  const { tokens, numbered } = lineTokens(sentence);
  if (tokens.length < 2) return { ok: true, replayed: tokens.length };
  const { ends, best } = replayAll(tokens, numbered, starts);
  return ends.length > 0 ? { ok: true, replayed: tokens.length } : { ok: false, replayed: best };
}

/** Sentences, then clauses: a line of play does not run on across ";", ", so", ", and", ", but" or "against". */
export function splitSentences(text: string): string[] {
  return text
    .split(/\n+/u)
    .flatMap((p) => p.split(/(?<!(?:^|\s)\d+)(?<![.][.])(?<!(?:[a-h][1-8]|O|[+#])[!?]{1,2})(?<=[.!?:])\s+(?=[A-Z"'(\u2018\u201C]|\.\.\.|\u2026)/u))
    .flatMap((s) => s.split(/\s*;\s*|,\s+(?:so|and|but|while|because|which)\s+|\s+(?:against|because)\s+/u))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** A clause that rejects a move or a line: the text does not go on from it. */
export const REJECT = /\b(?:not|impossible|fail|fails|cannot|never|loses to|bad|wrong|mistake|blunder)\b/iu;

const HEDGE = /\b(?:or|instead|not|if|before|rather)\b/iu;

export interface ContentSources {
  repertoires: { file: string; rep: Repertoire }[];
  lessons: { file: string; lesson: Lesson }[];
  guides: { file: string; guide: GuideFile; rep: Repertoire }[];
  plans: { file: string; plan: PlanFile }[];
}

/** The position after one move in UCI. A bad move gives null. */
function afterUci(fen: string, uci: string): string | null {
  try {
    const g = new Chess(fen);
    g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return g.fen();
  } catch {
    return null;
  }
}

const MAX_POOL = 400;
const MAX_LENIENT = 60;

/** The end positions of the tokens when one unnamed move is played at the start or between two tokens ("the knight goes to c2 ... After Qxc2 Bxc2"). */
function replayWithOneUnnamedMove(tokens: string[], starts: string[]): string[] {
  const ends = new Set<string>();
  for (const fen of starts) {
    try {
      new Chess(fen);
    } catch {
      continue;
    }
    // k named moves, then one unnamed move, then the rest
    for (let k = 0; k < tokens.length; k++) {
      const head = k === 0 ? { fen } : replay(tokens.slice(0, k), fen);
      if (!('fen' in head)) break;
      for (const m of new Chess(head.fen).moves()) {
        const g = new Chess(head.fen);
        g.move(m);
        const tail = replay(tokens.slice(k), g.fen());
        if ('fen' in tail) ends.add(tail.fen);
      }
    }
  }
  return [...ends];
}

/**
 * Checks the sentences of `text` in order. A sentence that replays leaves its end positions in the pool of starts,
 * so "Play ...Nf6. After Nc3 play ...e6." is read as one line. A sentence with two or more
 * moves that replays from no start in the pool gives an issue.
 */
function scan(text: string, starts: string[], file: string, nodeId: string, out: ValidationIssue[]): void {
  const seen = new Set(starts); // the starts and every end position of a line that replayed in full
  let frontier = [...starts]; // where the text stands now: the end of the last line
  let threaded = false; // some line has replayed, so the text has a thread
  const cap = (fens: string[]) => fens.slice(0, MAX_LENIENT);
  for (const sentence of splitSentences(text)) {
    const { tokens, numbered } = lineTokens(sentence);
    if (tokens.length === 0) continue;
    const run = (from: string[]) => replayAll(tokens, numbered, from);
    const rejected = REJECT.test(sentence);
    const take = (ends: string[]): void => {
      if (rejected) return; // a line called bad or impossible is not where the text goes on
      frontier = cap(ends);
      threaded = true;
      for (const fen of ends) if (seen.size < MAX_POOL) seen.add(fen);
    };
    // 1. The line goes on from where the text stands.
    const now = run(frontier);
    if (now.ends.length > 0) {
      take(now.ends);
      continue;
    }
    if (tokens.length < 2) {
      // One move that does not follow: it may follow after an unnamed move ("... must go to f7. Then Ne5+"), or start a new line.
      const gap = threaded ? replayWithOneUnnamedMove(tokens, frontier) : [];
      if (gap.length > 0) {
        take(gap);
        continue;
      }
      const again = run([...seen]);
      if (again.ends.length > 0) take(again.ends);
      continue;
    }
    // 2. A new line from the start positions or from any earlier end position.
    const again = run([...seen]);
    if (again.ends.length > 0) {
      take(again.ends);
      continue;
    }
    // 3. Legal after one unnamed move: incomplete, so a warning. Otherwise it cannot happen.
    const lenient = replayWithOneUnnamedMove(tokens, frontier);
    const lenientAll = lenient.length > 0 ? lenient : replayWithOneUnnamedMove(tokens, [...seen]);
    const elided = lenientAll.length > 0;
    if (elided && !rejected) frontier = cap(lenientAll);
    const detail = `"${sentence}" (moves ${tokens.join(' ')}: ${Math.max(now.best, again.best)} of ${tokens.length} replay from the position`;
    if (elided) {
      out.push({ file, nodeId, rule: 'skipped-move', severity: 'warning', detail: `${detail}; legal only after one unnamed move, name that move)` });
    } else {
      out.push({ file, nodeId, rule: 'illegal-sequence', severity: HEDGE.test(sentence) ? 'warning' : 'error', detail: `${detail})` });
    }
  }
}

/**
 * Where a node text may start: before and after the node move, and after each reply of the tree.
 * A comment often says "Take the pawn. After Bxe4 play ...Nf6": the reply (dxe4) is named in a sentence before.
 */
function nodeStarts(n: RepNode): string[] {
  return [n.fenBefore, n.fenAfter, ...n.children.map((c) => c.fenAfter)];
}

/**
 * The final-form board first, then every earlier position of its line.
 * A guide text may replay moves that the line already holds ("After ...cxd4 and Nxd4 the chain is broken").
 */
function lineStarts(rep: Repertoire, last: RepNode): string[] {
  const out = [last.fenAfter];
  for (let n: RepNode | undefined = last; n; n = n.parentId === null ? undefined : rep.byId.get(n.parentId)) out.push(n.fenBefore);
  return out;
}

export function sequenceIssues(sources: ContentSources = loadContentSources()): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const { file, rep } of sources.repertoires) {
    for (const n of rep.byId.values()) {
      if (n.comment) scan(n.comment, nodeStarts(n), file, n.id, out);
    }
  }
  for (const { file, lesson } of sources.lessons) {
    const fens = lesson.exercises.map((e) => e.fen);
    for (const e of lesson.exercises) {
      // `solution` lists accepted answers (alternatives), so each one gives a start.
      const starts = [e.fen, ...e.solution.flatMap((u) => afterUci(e.fen, u) ?? [])];
      scan(e.explanation, starts, file, `${lesson.id}/${e.id}`, out);
      scan(e.prompt, starts, file, `${lesson.id}/${e.id}`, out);
    }
    if (fens.length > 0) {
      scan(lesson.summary, fens, file, `${lesson.id}/summary`, out);
      scan(lesson.body, fens, file, `${lesson.id}/body`, out);
    }
  }
  for (const { file, guide, rep } of sources.guides) {
    const finals: string[] = [];
    for (const v of guide.variations) {
      const ff = rep.byId.get(v.finalForm.nodeId);
      if (ff) finals.push(ff.fenAfter);
    }
    scan(guide.why, finals.length > 0 ? finals : [START_FEN], file, '(why)', out);
    for (const v of guide.variations) {
      const ff = rep.byId.get(v.finalForm.nodeId);
      if (ff) {
        const starts = lineStarts(rep, ff);
        for (const j of v.finalForm.jobs) scan(j.text, starts, file, `${v.key}/${j.square}`, out);
        scan(v.middlegame, starts, file, `${v.key}/middlegame`, out);
      }
      for (const r of v.route) {
        const n = rep.byId.get(r.nodeId);
        if (n) scan(r.why, nodeStarts(n), file, r.nodeId, out);
      }
      for (const d of v.deviations) {
        const n = rep.byId.get(d.nodeId);
        if (!n) continue;
        const shown = d.showNodeId === undefined ? undefined : rep.byId.get(d.showNodeId);
        scan(d.plan, shown ? [...nodeStarts(n), ...lineStarts(rep, shown)] : nodeStarts(n), file, d.nodeId, out);
      }
      for (const m of v.mistakes) {
        // The board after the mistake line, and the board before its last move (the text often speaks of that move).
        const g = new Chess();
        let beforeLast = g.fen();
        try {
          for (const san of m.moves) {
            beforeLast = g.fen();
            g.move(san);
          }
        } catch {
          continue;
        }
        scan(m.text, [g.fen(), beforeLast], file, m.moves.join(' '), out);
      }
    }
  }
  for (const { file, plan } of sources.plans) scanPlan(plan, file, out);
  return out;
}

const boardFen = (b: PlanBoard | undefined): string | null => (b ? (replayBoard(b.moves)?.fen ?? null) : null);

/** The texts of a plan, each with the boards it may speak about. */
function scanPlan(plan: PlanFile, file: string, out: ValidationIssue[]): void {
  const main = boardFen(plan.position);
  const stepFens = plan.steps.flatMap((s) => boardFen(s.board) ?? []);
  const general = [...(main ? [main] : []), ...stepFens];
  if (general.length > 0) {
    for (const [nodeId, text] of [['(summary)', plan.summary], ['(goal)', plan.goal]] as const) scan(text, general, file, nodeId, out);
    for (const j of plan.jobs) scan(j.text, general, file, `job:${j.square}`, out);
    for (const b of plan.breaks) scan(b.text, general, file, `break:${b.from}${b.to}`, out);
    plan.notNow.forEach((t, i) => scan(t, general, file, `notNow:${i + 1}`, out));
  }
  plan.steps.forEach((s, i) => {
    // A step text may name the moves that lead from the main board to the step board.
    const starts = [boardFen(s.board), main].flatMap((f) => f ?? []);
    if (starts.length > 0) scan(s.text, [...new Set(starts)], file, `step:${i + 1}`, out);
  });
  plan.opponent.forEach((o, i) => {
    const fen = boardFen(o.board) ?? main;
    if (fen) scan(o.text, [fen], file, `opponent:${i + 1}`, out);
  });
  for (const m of plan.mistakes) {
    const g = new Chess();
    let beforeLast = g.fen();
    try {
      for (const san of m.moves) {
        beforeLast = g.fen();
        g.move(san);
      }
    } catch {
      continue;
    }
    scan(m.text, [g.fen(), beforeLast], file, m.moves.join(' '), out);
  }
  for (const model of plan.models) {
    for (const c of model.comments) {
      const before = replayBoard(model.moves.slice(0, Math.max(0, c.ply - 1)))?.fen;
      const after = replayBoard(model.moves.slice(0, c.ply))?.fen;
      const starts = [before, after].flatMap((f) => f ?? []);
      if (starts.length > 0) scan(c.text, starts, file, `${plan.id}/model/${c.ply}`, out);
    }
  }
  for (const e of plan.exercises) {
    const fen = boardFen(e.board);
    if (!fen) continue;
    const starts = [fen, ...e.choices.flatMap((c) => {
      try {
        const g = new Chess(fen);
        g.move(c.san);
        return g.fen();
      } catch {
        return [];
      }
    })];
    scan(e.explanation, starts, file, `${plan.id}/${e.id}`, out);
    scan(e.prompt, starts, file, `${plan.id}/${e.id}`, out);
    for (const c of e.choices) scan(c.why, starts, file, `${plan.id}/${e.id}`, out);
  }
}

/** Loads the content files. With `path`, only that file (and, for a repertoire, nothing else). */
export function loadContentSources(path: string | null = null): ContentSources {
  const reps = loadAllRepertoires();
  const read = (p: string): unknown => JSON.parse(readFileSync(p, 'utf8'));
  const kind = (p: string): 'guide' | 'lesson' | 'plan' | 'repertoire' => {
    const j = read(p) as object;
    // A plan has `exercises` too, so test its `steps` key first.
    return 'repertoireId' in j ? 'guide' : 'steps' in j ? 'plan' : 'exercises' in j ? 'lesson' : 'repertoire';
  };
  const all = path === null;
  if (path !== null && !existsSync(path)) throw new Error(`File not found: ${path}`);
  const k = path === null ? null : kind(path);
  const pick = (files: string[], want: string): string[] => (all ? files : k === want ? [path!] : []);
  return {
    repertoires: pick(listRepertoireFiles(), 'repertoire').map((p) => ({ file: basename(p), rep: loadRepertoire(read(p)) })),
    lessons: pick(listLessonFiles(), 'lesson').map((p) => ({ file: basename(p), lesson: loadLesson(read(p)) })),
    guides: pick(listGuideFiles(), 'guide').map((p) => {
      const guide = loadGuide(read(p), reps);
      return { file: basename(p), guide, rep: reps.find((r) => r.id === guide.repertoireId)! };
    }),
    plans: pick(listPlanFiles(), 'plan').map((p) => ({ file: basename(p), plan: loadPlan(read(p), reps) })),
  };
}

/** Counts for the spike: sentences with two or more SAN tokens. */
export function countSequenceSentences(sources: ContentSources = loadContentSources()): number {
  const texts: string[] = [];
  for (const { rep } of sources.repertoires) for (const n of rep.byId.values()) if (n.comment) texts.push(n.comment);
  for (const { lesson } of sources.lessons) {
    texts.push(lesson.summary, lesson.body);
    for (const e of lesson.exercises) texts.push(e.prompt, e.explanation);
  }
  for (const { guide } of sources.guides) {
    texts.push(guide.why);
    for (const v of guide.variations) {
      texts.push(v.middlegame, ...v.finalForm.jobs.map((j) => j.text), ...v.route.map((r) => r.why), ...v.deviations.map((d) => d.plan), ...v.mistakes.map((m) => m.text));
    }
  }
  for (const { plan } of sources.plans) {
    texts.push(plan.summary, plan.goal, ...plan.steps.map((s) => s.text), ...plan.jobs.map((j) => j.text), ...plan.breaks.map((b) => b.text));
    texts.push(...plan.opponent.map((o) => o.text), ...plan.notNow, ...plan.mistakes.map((m) => m.text));
    for (const m of plan.models) texts.push(...m.comments.map((c) => c.text));
    for (const e of plan.exercises) texts.push(e.prompt, e.explanation, ...e.choices.map((c) => c.why));
  }
  return texts.flatMap(splitSentences).filter((s) => lineTokens(s).tokens.length >= 2).length;
}

/**
 * `skipped-move` is always a warning. `illegal-sequence` errors are warnings too unless `strict`
 * (the audit batches run non-strict until Task 22 turns it on).
 */
export function applySeverity(issues: ValidationIssue[], strict: boolean): ValidationIssue[] {
  return issues.map((i) => (strict || i.severity === 'warning' ? i : { ...i, severity: 'warning' as const }));
}

/** 1 when any issue is an error, else 0. */
export function sequenceExitCode(issues: ValidationIssue[]): number {
  return issues.some((i) => i.severity !== 'warning') ? 1 : 0;
}

export type SequenceScope = { file: string } | { lessons: boolean; repertoires: boolean; plans?: boolean };

/** Keeps the sources of the scope: one file (by file name), or the lessons and/or the repertoires with their guides. */
export function filterSources(sources: ContentSources, scope: SequenceScope): ContentSources {
  if ('file' in scope) {
    const name = basename(scope.file);
    return {
      repertoires: sources.repertoires.filter((r) => r.file === name),
      lessons: sources.lessons.filter((l) => l.file === name),
      guides: sources.guides.filter((g) => g.file === name),
      plans: sources.plans.filter((p) => p.file === name),
    };
  }
  return {
    repertoires: scope.repertoires ? sources.repertoires : [],
    guides: scope.repertoires ? sources.guides : [],
    lessons: scope.lessons ? sources.lessons : [],
    plans: scope.plans ? sources.plans : [],
  };
}

/** The sequence issues of one file, or of the lessons and/or repertoires (with their guides). No engine. `sources` is for tests. */
export function sequenceCheck(scope: SequenceScope, strict: boolean, sources?: ContentSources): ValidationIssue[] {
  const all = sources ?? loadContentSources('file' in scope ? scope.file : null);
  return applySeverity(sequenceIssues(filterSources(all, scope)), strict);
}

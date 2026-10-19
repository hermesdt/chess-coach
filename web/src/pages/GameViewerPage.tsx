import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { Chessboard } from 'react-chessboard';
import type { ChatLineDTO, GameAnalysis, GameDetail, GameReviewNote, ProviderId } from '../../../shared/types';
import { api, type AnalysisResponse } from '../api';
import { AnalyseButton } from '../components/AnalyseButton';
import { CoachChat, type ChatAnchor } from '../components/CoachChat';
import { CoachPanel } from '../components/CoachPanel';
import { GameTabs } from '../components/GameTabs';
import { EvalGraph } from '../components/EvalGraph';
import { LiveEval, type LiveArrow } from '../components/LiveEval';
import { KeyMoments } from '../components/KeyMoments';
import { MoveList } from '../components/MoveList';
import { noteIndexFor } from '../lib/coach-notes';
import { formatDate } from '../lib/format';
import { moveToUci } from '../lib/drill';
import {
  addLine,
  addMove,
  branchPoint,
  createTree,
  describeNode,
  fenOf,
  next,
  pathFromMain,
  playLine,
  prev,
  type NodeId,
  type VarTree,
} from '../lib/variations';

const BEST_ARROW = '#1a7f37';
const PLAYED_ARROW = '#cf222e';
const HIGHLIGHT = { backgroundColor: 'rgba(255, 235, 59, 0.5)' };

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

type NavAction = 'first' | 'prev' | 'next' | 'last' | { goto: number };
type Current = NodeId | 'root';

const mainNode = (ply: number): Current => (ply <= 0 ? 'root' : `m${ply}`);

const KEY_ACTIONS: Record<string, NavAction> = {
  ArrowLeft: 'prev',
  ArrowRight: 'next',
  Home: 'first',
  End: 'last',
};

function playerLine(game: GameDetail) {
  const name = (color: 'white' | 'black') => {
    const elo = color === 'white' ? game.whiteElo : game.blackElo;
    const label = `${color === 'white' ? game.white : game.black}${elo ? ` (${elo})` : ''}`;
    return game.userColor === color ? <strong>{label} (you)</strong> : label;
  };
  return (
    <>
      {name('white')} vs {name('black')}
    </>
  );
}

export function GameViewerPage() {
  const { id } = useParams();
  const [query] = useSearchParams();
  const [game, setGame] = useState<GameDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<Current>('root');
  const [branches, setBranches] = useState<VarTree | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [momentPly, setMomentPly] = useState<number | null>(null);
  const [lineError, setLineError] = useState<string | null>(null);
  const [liveArrow, setLiveArrow] = useState<LiveArrow | null>(null);

  useEffect(() => {
    setGame(null);
    setError(null);
    setCurrent('root');
    setBranches(null);
    if (!/^\d+$/.test(id ?? '')) {
      setError('Game not found');
      return;
    }
    let stale = false;
    api.getGame(Number(id)).then(
      (g) => {
        if (!stale) setGame(g);
      },
      (e: Error) => {
        if (!stale) setError(e.message);
      },
    );
    return () => {
      stale = true;
    };
  }, [id]);

  const [analysisReload, setAnalysisReload] = useState(0);
  const loadAnalysis = useCallback(() => setAnalysisReload((n) => n + 1), []);
  const analysisStatus = analysis && 'status' in analysis ? analysis.status : null;
  const inProgress = analysisStatus === 'pending' || analysisStatus === 'running';

  useEffect(() => {
    setAnalysis(null);
    setAnalysisError(null);
    setMomentPly(null);
  }, [id]);

  useEffect(() => {
    if (!/^\d+$/.test(id ?? '')) return;
    let stale = false;
    api.getAnalysis(Number(id)).then(
      (a) => {
        if (stale) return;
        setAnalysis(a);
        setAnalysisError(null);
      },
      (e: Error) => {
        if (!stale) setAnalysisError(e.message);
      },
    );
    return () => {
      stale = true;
    };
  }, [id, analysisReload]);

  // Poll while the analysis is queued or running (for example queued from the Games page).
  useEffect(() => {
    if (!inProgress) return;
    const timer = setInterval(loadAnalysis, 2000);
    return () => clearInterval(timer);
  }, [inProgress, loadAnalysis]);

  const [notes, setNotes] = useState<GameReviewNote[]>([]);
  const [activeNote, setActiveNote] = useState(0);
  const [notesReload, setNotesReload] = useState(0);
  const [notesError, setNotesError] = useState<string | null>(null);
  const select = useRef<{ provider: ProviderId | null; model: string | null } | null>(null);
  const reloadNotes = useCallback((asked?: { provider: ProviderId | null; model: string | null }) => {
    select.current = asked ?? null;
    setNotesReload((n) => n + 1);
  }, []);
  const isDone = analysis?.status === 'done';

  useEffect(() => {
    setNotes([]);
    setNotesError(null);
  }, [id]);

  useEffect(() => {
    if (!isDone || !/^\d+$/.test(id ?? '')) {
      setNotes([]);
      return;
    }
    let stale = false;
    api.getCoachNotes(Number(id)).then(
      (n) => {
        if (stale) return;
        const asked = select.current;
        select.current = null;
        setNotes(n);
        setActiveNote(asked ? noteIndexFor(n, asked.provider, asked.model) : 0);
      },
      (e: Error) => {
        if (stale) return;
        setNotes([]);
        setNotesError(e.message);
      },
    );
    return () => {
      stale = true;
    };
  }, [id, isDone, notesReload]);

  const baseTree = useMemo(() => (game ? createTree(game.startFen, game.moves) : null), [game]);
  const tree = branches ?? baseTree;
  const go = useCallback(
    (action: NavAction) => {
      if (!tree) return;
      setMomentPly(null);
      setCurrent((c) => {
        if (action === 'first') return 'root';
        if (action === 'prev') return prev(tree, c) ?? c;
        if (action === 'next') return next(tree, c) ?? c;
        if (action === 'last') {
          let at = c;
          for (let n = next(tree, at); n; n = next(tree, at)) at = n;
          return at;
        }
        return mainNode(Math.min(Math.max(action.goto, 0), game?.moves.length ?? 0));
      });
    },
    [tree, game],
  );

  const playMove = (from: string, to: string): boolean => {
    if (!tree) return false;
    const uci = moveToUci(fenOf(tree, current), from, to);
    const res = uci ? addMove(tree, current, uci) : null;
    if (!res) return false;
    setBranches(res.tree);
    setMomentPly(null);
    setCurrent(res.node);
    return true;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = KEY_ACTIONS[e.key];
      if (!action || isTypingTarget(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      go(action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  if (error) return <p className="error">{error}</p>;
  if (!game || !tree) return <p>Loading...</p>;

  const done: GameAnalysis | null = analysis?.status === 'done' ? (analysis as GameAnalysis) : null;
  const moment = done && momentPly !== null ? done.moves[momentPly - 1] : undefined;
  // A key moment shows the position before the move, with the best move and the played move.
  const shown: Current = moment ? mainNode(moment.ply - 1) : current;
  const shownPly = pathFromMain(tree, shown).ply;
  const inBranch = branchPoint(tree, current) !== null;
  const arrows = moment
    ? [
        { startSquare: moment.bestUci.slice(0, 2), endSquare: moment.bestUci.slice(2, 4), color: BEST_ARROW },
        ...(moment.uci === moment.bestUci
          ? []
          : [{ startSquare: moment.uci.slice(0, 2), endSquare: moment.uci.slice(2, 4), color: PLAYED_ARROW }]),
      ]
    : liveArrow
      ? [liveArrow]
      : [];
  const selectMoment = (p: number) => {
    setCurrent(mainNode(p - 1));
    setMomentPly(p);
  };
  const last = shown === 'root' ? null : tree.nodes[shown];
  const squareStyles = last
    ? { [last.uci.slice(0, 2)]: HIGHLIGHT, [last.uci.slice(2, 4)]: HIGHLIGHT }
    : {};
  const atStart = shown === 'root';
  const atEnd = next(tree, shown) === null;
  const chatAnchor: ChatAnchor = { ...pathFromMain(tree, shown), describe: describeNode(tree, shown, game.userColor) };

  // Finds or creates the node for a chat anchor; a side-line anchor becomes a branch labelled "Your line".
  const nodeForAnchor = (base: VarTree, a: { ply: number; path: string[] }): { tree: VarTree; node: Current } => {
    const from = mainNode(a.ply);
    if (a.path.length === 0) return { tree: base, node: from };
    const res = addLine(base, from, a.path, 'Your line');
    return { tree: res.tree, node: res.last };
  };
  const showAnchor = (a: { ply: number; path: string[] }) => {
    const res = nodeForAnchor(tree, a);
    setBranches(res.tree);
    setMomentPly(null);
    setCurrent(res.node);
  };
  const showLine = (line: ChatLineDTO, a: { ply: number; path: string[] }) => {
    try {
      const at = nodeForAnchor(tree, a);
      const res = playLine(at.tree, at.node, line, line.label);
      setLineError(null);
      setBranches(res.tree);
      setMomentPly(null);
      setCurrent(res.first);
    } catch {
      setLineError('Could not show this line.');
    }
  };
  const opening = [game.eco, game.openingName].filter(Boolean).join(' ');

  return (
    <section>
      <p>
        <Link to="/games">&larr; Games</Link>
      </p>
      <h1>{playerLine(game)}</h1>
      <p className="muted">
        {game.result && <span className={`badge ${game.result}`}>{game.result}</span>}{' '}
        {opening && <>{opening} · </>}
        {formatDate(game.playedAt)}
        {game.url && (
          <>
            {' · '}
            <a href={game.url} target="_blank" rel="noreferrer">Original game</a>
          </>
        )}
      </p>
      {analysisError && <p className="error">Could not load the analysis: {analysisError}</p>}
      {inProgress && <p className="muted">Analysis in progress...</p>}
      {analysis && !inProgress && analysis.status !== 'done' && (
        <div className="analysis-box">
          {analysis.status === 'error' && (
            <p className="error">Analysis failed{'error' in analysis && analysis.error ? `: ${analysis.error}` : '.'}</p>
          )}
          {game.userColor ? (
            <AnalyseButton
              label={analysis.status === 'error' ? 'Try again' : 'Analyse this game'}
              runningLabel="Analysing..."
              start={async () => {
                const { jobId } = await api.analyseGame(game.id);
                // Follow this game's own status with the page polling, not the whole job.
                loadAnalysis();
                return jobId;
              }}
            />
          ) : (
            <p className="muted">Set your colour for this game to analyse it.</p>
          )}
        </div>
      )}
      {done && (
        <div className="analysis-summary">
          <div className="stat"><span className="muted">Your accuracy</span><strong>{done.accuracyUser !== null ? `${Math.round(done.accuracyUser)}%` : '-'}</strong></div>
          <div className="stat"><span className="muted">Opponent accuracy</span><strong>{done.accuracyOpp !== null ? `${Math.round(done.accuracyOpp)}%` : '-'}</strong></div>
          <div className="stat"><span className="muted">Blunders</span><strong className="glyph blunder">{done.counts.blunder}</strong></div>
          <div className="stat"><span className="muted">Mistakes</span><strong className="glyph mistake">{done.counts.mistake}</strong></div>
          <div className="stat"><span className="muted">Inaccuracies</span><strong className="glyph inaccuracy">{done.counts.inaccuracy}</strong></div>
        </div>
      )}
      {done && <EvalGraph moves={done.moves} currentPly={shownPly} onSelect={(p) => go({ goto: p })} />}
      <div className="viewer">
        <div className="viewer-board">
          <Chessboard
            options={{
              position: fenOf(tree, shown),
              boardOrientation: game.userColor ?? 'white',
              allowDragging: true,
              allowDrawingArrows: false,
              squareStyles,
              arrows,
              onPieceDrop: ({ sourceSquare, targetSquare }) => (targetSquare ? playMove(sourceSquare, targetSquare) : false),
            }}
          />
          <div className="actions">
            <button type="button" aria-label="First move" onClick={() => go('first')} disabled={atStart}>⏮</button>
            <button type="button" aria-label="Previous move" onClick={() => go('prev')} disabled={atStart}>◀</button>
            <button type="button" aria-label="Next move" onClick={() => go('next')} disabled={atEnd}>▶</button>
            <button type="button" aria-label="Last move" onClick={() => go('last')} disabled={atEnd}>⏭</button>
            {inBranch && (
              <button type="button" onClick={() => {
                setMomentPly(null);
                setCurrent(branchPoint(tree, current) ?? 'root');
              }}>Back to game</button>
            )}
          </div>
          <LiveEval fen={fenOf(tree, shown)} userColor={game.userColor} onArrow={setLiveArrow} />
          {lineError && <p className="error" role="alert">{lineError}</p>}
        </div>
        <GameTabs
          moves={<MoveList tree={tree} current={shown} onSelect={(id) => { setMomentPly(null); setCurrent(id); }} analysis={done?.moves} />}
          initial={query.get('tab') === 'chat' ? 'chat' : undefined}
          chat={(shown) => (
            <CoachChat
              key={game.id}
              visible={shown}
              gameId={game.id}
              analysed={done !== null}
              anchor={chatAnchor}
              onShowLine={showLine}
              onShowAnchor={showAnchor}
              onAnalyse={() => { void api.analyseGame(game.id).then(loadAnalysis); }}
            />
          )}
        />
      </div>
      {done && <CoachPanel key={game.id} gameId={game.id} notes={notes} active={activeNote} onActive={setActiveNote} onChanged={reloadNotes} error={notesError} />}
      {done && (
        <>
          <h2>Key moments</h2>
          {moment && (
            <p className="muted">
              <span style={{ color: BEST_ARROW }}>Green arrow</span>: best move ({moment.bestSan}).{' '}
              <span style={{ color: PLAYED_ARROW }}>Red arrow</span>: your move ({moment.san}).
            </p>
          )}
          <KeyMoments moments={done.keyMoments} moves={done.moves} onSelect={selectMoment} coach={notes[activeNote]?.review.moments} />
        </>
      )}
    </section>
  );
}

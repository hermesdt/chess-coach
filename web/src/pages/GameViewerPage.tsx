import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Chessboard } from 'react-chessboard';
import type { GameAnalysis, GameDetail } from '../../../shared/types';
import { api, type AnalysisResponse } from '../api';
import { AnalyseButton } from '../components/AnalyseButton';
import { EvalGraph } from '../components/EvalGraph';
import { KeyMoments } from '../components/KeyMoments';
import { MoveList } from '../components/MoveList';
import { formatDate } from '../lib/format';
import { fenAt, navigate, type NavAction } from '../lib/navigator';

const BEST_ARROW = '#1a7f37';
const PLAYED_ARROW = '#cf222e';
const HIGHLIGHT = { backgroundColor: 'rgba(255, 235, 59, 0.5)' };

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

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
  const [game, setGame] = useState<GameDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ply, setPly] = useState(0);
  const [analysis, setAnalysis] = useState<AnalysisResponse | null>(null);
  const [momentPly, setMomentPly] = useState<number | null>(null);

  useEffect(() => {
    setGame(null);
    setError(null);
    setPly(0);
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

  const loadAnalysis = useCallback(() => {
    if (!/^\d+$/.test(id ?? '')) return;
    api.getAnalysis(Number(id)).then(setAnalysis, () => setAnalysis({ status: 'none' }));
  }, [id]);

  useEffect(() => {
    setAnalysis(null);
    setMomentPly(null);
    loadAnalysis();
  }, [loadAnalysis]);

  const maxPly = game?.moves.length ?? 0;
  const go = useCallback(
    (action: NavAction) => {
      setMomentPly(null);
      setPly((p) => navigate({ ply: p, maxPly }, action).ply);
    },
    [maxPly],
  );

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
  if (!game) return <p>Loading...</p>;

  const done: GameAnalysis | null = analysis?.status === 'done' ? (analysis as GameAnalysis) : null;
  const moment = done && momentPly !== null ? done.moves[momentPly - 1] : undefined;
  // A key moment shows the position before the move, with the best move and the played move.
  const shownPly = moment ? moment.ply - 1 : ply;
  const arrows = moment
    ? [
        { startSquare: moment.bestUci.slice(0, 2), endSquare: moment.bestUci.slice(2, 4), color: BEST_ARROW },
        { startSquare: moment.uci.slice(0, 2), endSquare: moment.uci.slice(2, 4), color: PLAYED_ARROW },
      ]
    : [];
  const selectMoment = (p: number) => {
    setPly(p - 1);
    setMomentPly(p);
  };
  const last = shownPly > 0 ? game.moves[ply - 1] : null;
  const squareStyles = last
    ? { [last.uci.slice(0, 2)]: HIGHLIGHT, [last.uci.slice(2, 4)]: HIGHLIGHT }
    : {};
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
      {analysis && analysis.status !== 'done' && (
        <div className="analysis-box">
          {(analysis.status === 'error') && (
            <p className="error">Analysis failed{'error' in analysis && analysis.error ? `: ${analysis.error}` : '.'}</p>
          )}
          {game.userColor ? (
            <AnalyseButton
              label={analysis.status === 'error' ? 'Try again' : 'Analyse this game'}
              runningLabel="Analysing..."
              start={async () => (await api.analyseGame(game.id)).jobId}
              onFinished={loadAnalysis}
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
              position: fenAt(game, shownPly),
              boardOrientation: game.userColor ?? 'white',
              allowDragging: false,
              allowDrawingArrows: false,
              squareStyles,
              arrows,
            }}
          />
          <div className="actions">
            <button type="button" aria-label="First move" onClick={() => go('first')} disabled={shownPly === 0}>⏮</button>
            <button type="button" aria-label="Previous move" onClick={() => go('prev')} disabled={shownPly === 0}>◀</button>
            <button type="button" aria-label="Next move" onClick={() => go('next')} disabled={shownPly === maxPly}>▶</button>
            <button type="button" aria-label="Last move" onClick={() => go('last')} disabled={shownPly === maxPly}>⏭</button>
          </div>
        </div>
        <MoveList moves={game.moves} currentPly={shownPly} onSelect={(p) => go({ goto: p })} analysis={done?.moves} />
      </div>
      {done && (
        <>
          <h2>Key moments</h2>
          {moment && (
            <p className="muted">
              <span style={{ color: BEST_ARROW }}>Green arrow</span>: best move ({moment.bestSan}).{' '}
              <span style={{ color: PLAYED_ARROW }}>Red arrow</span>: your move ({moment.san}).
            </p>
          )}
          <KeyMoments moments={done.keyMoments} moves={done.moves} onSelect={selectMoment} />
        </>
      )}
    </section>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Chessboard } from 'react-chessboard';
import type { GameDetail } from '../../../shared/types';
import { api } from '../api';
import { MoveList } from '../components/MoveList';
import { formatDate } from '../lib/format';
import { fenAt, navigate, type NavAction } from '../lib/navigator';

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

  const maxPly = game?.moves.length ?? 0;
  const go = useCallback(
    (action: NavAction) => setPly((p) => navigate({ ply: p, maxPly }, action).ply),
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

  const last = ply > 0 ? game.moves[ply - 1] : null;
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
      <div className="viewer">
        <div className="viewer-board">
          <Chessboard
            options={{
              position: fenAt(game, ply),
              boardOrientation: game.userColor ?? 'white',
              allowDragging: false,
              allowDrawingArrows: false,
              squareStyles,
            }}
          />
          <div className="actions">
            <button type="button" aria-label="First move" onClick={() => go('first')} disabled={ply === 0}>⏮</button>
            <button type="button" aria-label="Previous move" onClick={() => go('prev')} disabled={ply === 0}>◀</button>
            <button type="button" aria-label="Next move" onClick={() => go('next')} disabled={ply === maxPly}>▶</button>
            <button type="button" aria-label="Last move" onClick={() => go('last')} disabled={ply === maxPly}>⏭</button>
          </div>
        </div>
        <MoveList moves={game.moves} currentPly={ply} onSelect={(p) => go({ goto: p })} />
      </div>
    </section>
  );
}

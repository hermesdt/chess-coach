import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { TAG_TEXT } from '../../../shared/tag-text';
import { api, type DashboardData } from '../api';
import { SyncButton } from '../components/SyncButton';
import { formatDate } from '../lib/format';

const plural = (n: number, word: string) => (n === 1 ? word : `${word}s`);
const when = (ms: number | null) => (ms === null ? 'never' : new Date(ms).toLocaleString());

export function DashboardPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bannerHidden, setBannerHidden] = useState(false);

  const load = useCallback(() => {
    api.getDashboard().then(
      (d) => {
        setData(d);
        setError(null);
      },
      (e: Error) => setError(e.message),
    );
  }, []);

  useEffect(load, [load]);

  const dismiss = () => {
    setBannerHidden(true);
    api.markLevelSeen().catch(() => undefined);
  };

  if (!data) return <section><h1>Dashboard</h1>{error ? <p className="error">{error}</p> : <p>Loading...</p>}</section>;

  const { review, sync, recentGames, topTag, level, levelUp } = data;
  return (
    <section>
      <h1>
        Dashboard <span className="muted level">Level {level.level}{level.rating !== null && ` · rating ~${level.rating}`}</span>
      </h1>
      {error && <p className="error">{error}</p>}
      {levelUp && !bannerHidden && (
        <div className="banner" role="status">
          <span>You reached level {levelUp.to}. New: deeper opening lines and new lessons unlock as they arrive.</span>
          <button type="button" onClick={dismiss}>Dismiss</button>
        </div>
      )}
      <div className="cards">
        <div className="panel">
          <h2>Today</h2>
          <p>{review.sessionSize} {plural(review.sessionSize, 'card')} to review today</p>
          <button type="button" className="big" disabled={review.sessionSize === 0} onClick={() => void navigate('/review')}>
            Start review
          </button>
        </div>
        <div className="panel">
          <h2>Games</h2>
          <p className="muted">Last sync chess.com: {when(sync.chesscom)}</p>
          <p className="muted">Last sync lichess: {when(sync.lichess)}</p>
          <SyncButton onFinished={load} />
        </div>
        <div className="panel">
          <h2>Your focus</h2>
          {topTag ? (
            <>
              <p>{TAG_TEXT[topTag.tag]} — in {topTag.count} of your last {topTag.games} {plural(topTag.games, 'game')}</p>
              <Link to="/coach">See your coach report</Link>
            </>
          ) : (
            <p className="muted">Analyse a few games to see your main focus.</p>
          )}
        </div>
      </div>
      <h2>Recent games</h2>
      {recentGames.length === 0 ? (
        <p>No games yet. Add your usernames in Settings, then press Sync now.</p>
      ) : (
        <table className="games">
          <thead>
            <tr><th>Date</th><th>Result</th><th>Opening</th><th>??</th><th>Accuracy</th><th /></tr>
          </thead>
          <tbody>
            {recentGames.map((g) => {
              const done = g.analysis?.status === 'done';
              return (
                <tr key={g.id}>
                  <td className="nowrap">{formatDate(g.playedAt)}</td>
                  <td>{g.result ? <span className={`badge ${g.result}`}>{g.result}</span> : '-'}</td>
                  <td>{g.openingName ?? g.eco ?? ''}</td>
                  <td>{done ? g.analysis!.blunders : '-'}</td>
                  <td>{done && g.analysis!.accuracyUser !== null ? `${Math.round(g.analysis!.accuracyUser)}%` : '-'}</td>
                  <td><Link to={`/games/${g.id}`}>Open</Link></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

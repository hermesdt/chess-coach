import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import type { OpeningDetail, OpeningLeakGroup, OpeningSummary } from '../../../shared/types';
import { api } from '../api';
import { DrillBoard } from '../components/DrillBoard';
import { LineDrill } from '../components/LineDrill';
import { RepertoireTree } from '../components/RepertoireTree';
import { nodeAtPath } from '../lib/line-drill';
import { formatLeak, tabRank } from '../lib/openings';

const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const TAB_LABEL: Record<string, string> = { london: 'London', 'caro-kann': 'Caro-Kann', slav: 'Slav' };

/** "1.e4 c6 2.d4" from a SAN path. */
function formatPath(path: string[]): string {
  return path.map((san, i) => (i % 2 === 0 ? `${i / 2 + 1}.${san}` : san)).join(' ');
}

function tabLabel(o: OpeningSummary): string {
  return TAB_LABEL[o.id] ?? o.name;
}

export function OpeningsPage() {
  const [list, setList] = useState<OpeningSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<OpeningDetail | null>(null);
  const [leaks, setLeaks] = useState<OpeningLeakGroup[]>([]);
  const [path, setPath] = useState<string[]>([]);
  const [drilling, setDrilling] = useState(false);

  useEffect(() => {
    let stale = false;
    api.listOpenings().then(
      (l) => {
        if (stale) return;
        const sorted = [...l].sort((a, b) => tabRank(a.id) - tabRank(b.id));
        setList(sorted);
        setActiveId(sorted[0]?.id ?? null);
      },
      (e: Error) => !stale && setError(e.message),
    );
    return () => {
      stale = true;
    };
  }, []);

  useEffect(() => {
    if (!activeId) return;
    let stale = false;
    setDetail(null);
    setLeaks([]);
    setPath([]);
    setDrilling(false);
    Promise.all([api.getOpening(activeId), api.getOpeningLeaks(activeId)]).then(
      ([d, l]) => {
        if (stale) return;
        setDetail(d);
        setLeaks(l);
      },
      (e: Error) => !stale && setError(e.message),
    );
    return () => {
      stale = true;
    };
  }, [activeId]);

  const current = useMemo(() => (detail ? nodeAtPath(detail.roots, path) : null), [detail, path]);

  if (error) return <p className="error">{error}</p>;
  if (!list) return <p className="muted">Loading…</p>;
  const summary = list.find((o) => o.id === activeId);

  const next = detail ? (path.length === 0 ? detail.roots : (current?.children ?? [])) : [];

  return (
    <div className="openings">
      <h1>
        Openings
        {detail && <span className="level muted">Your level: {detail.level}</span>}
      </h1>
      <div className="tabs" role="tablist">
        {list.map((o) => (
          <button
            key={o.id}
            type="button"
            role="tab"
            aria-selected={o.id === activeId}
            className={o.id === activeId ? 'tab active' : 'tab'}
            onClick={() => setActiveId(o.id)}
          >
            {tabLabel(o)}
          </button>
        ))}
      </div>
      {summary && (
        <p className="muted">
          You play {summary.color}. {summary.stats.games} games: {summary.stats.win} won, {summary.stats.draw} drawn,{' '}
          {summary.stats.loss} lost. {summary.cardCount} cards.{' '}
          <Link to={`/openings/${summary.id}/guide`}>Read the guide</Link>
        </p>
      )}
      {!detail && <p className="muted">Loading…</p>}
      {detail && (
        <div className="viewer">
          <div className="viewer-board">
            {drilling ? (
              <LineDrill
                key={`${detail.id}:${path.join(' ')}`}
                roots={detail.roots}
                startPath={path}
                userColor={detail.color}
                onExit={() => setDrilling(false)}
              />
            ) : (
              <DrillBoard
                key={path.join(' ')}
                fen={current?.fenAfter ?? START_FEN}
                orientation={detail.color}
                lastMove={current?.uci || null}
                onMove={() => {}}
                locked
              />
            )}
          </div>
          <div className="explorer">
            {!drilling && (
              <>
                <div className="breadcrumb">
                  <button type="button" onClick={() => setPath(path.slice(0, -1))} disabled={path.length === 0}>
                    Back
                  </button>
                  <button type="button" className="link" onClick={() => setPath([])} disabled={path.length === 0}>
                    Start
                  </button>
                  <span>{path.length === 0 ? 'Start position' : formatPath(path)}</span>
                </div>
                {current?.comment && <p className="rep-current-comment">{current.comment}</p>}
                <RepertoireTree nodes={next} repColor={detail.color} onSelect={(san) => setPath([...path, san])} />
                <div className="actions">
                  <button type="button" className="big" disabled={next.every((n) => n.locked)} onClick={() => setDrilling(true)}>
                    Drill from here
                  </button>
                </div>
              </>
            )}
            <section className="panel leaks">
              <h2>Leaks</h2>
              {leaks.length === 0 && <p className="muted">No leaks found in your games.</p>}
              <ul className="leak-list">
                {leaks.map((l) => (
                  <li key={`${l.nodeId}|${l.playedSan}`}>
                    <span>{formatLeak(l)}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setDrilling(false);
                        setPath(l.nodeId.split(' ').slice(0, -1));
                      }}
                    >
                      Show position
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router';
import type { GuideDTO, GuideVariationDTO } from '../../../shared/types';
import { api } from '../api';
import { DrillBoard, type DrillArrow } from '../components/DrillBoard';
import { FinalFormBoard } from '../components/guide/FinalFormBoard';
import { PersonalBox } from '../components/guide/PersonalBox';
import { RouteStepper } from '../components/guide/RouteStepper';
import { fenAfterMoves, lastMoveAfter, moveLabel, paragraphs } from '../lib/guide';
import { formatLeak } from '../lib/openings';

const mistakeArrows = (m: GuideVariationDTO['mistakes'][number]): DrillArrow[] => [
  ...(m.bad ? [{ from: m.bad.from, to: m.bad.to, color: 'red' as const }] : []),
  ...(m.good ?? []).map((g) => ({ from: g.from, to: g.to, color: 'green' as const })),
];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function Paragraphs({ text }: { text: string }) {
  return <>{paragraphs(text).map((p, i) => <p key={i}>{p}</p>)}</>;
}

function GameLinks({ ids }: { ids: number[] }) {
  return (
    <>
      {ids.map((id) => (
        <span key={id}> <Link to={`/games/${id}`}>Game {id}</Link></span>
      ))}
    </>
  );
}

function resultsLine(v: GuideVariationDTO): string {
  const p = v.personal!;
  const parts = [plural(p.games, 'game', 'games'), plural(p.win, 'win', 'wins')];
  if (p.draw > 0) parts.push(plural(p.draw, 'draw', 'draws'));
  parts.push(plural(p.loss, 'loss', 'losses'));
  return `${v.name}: ${parts.join(', ')}`;
}

function Deviations({ v, color, level }: { v: GuideVariationDTO; color: GuideDTO['color']; level: number }) {
  const [shown, setShown] = useState<string[] | null>(null);
  const opponent = v.personal?.opponentMoves ?? [];
  return (
    <div className="viewer">
      {shown && (
        <div className="viewer-board">
          <DrillBoard
            key={shown.join(' ')}
            fen={fenAfterMoves(shown, shown.length)}
            orientation={color}
            lastMove={lastMoveAfter(shown, shown.length)}
            onMove={() => {}}
            locked
          />
          <div className="actions"><button type="button" onClick={() => setShown(null)}>Hide board</button></div>
        </div>
      )}
      <div className="explorer">
        {v.deviations.length === 0 && <p className="muted">No common deviations are listed for this variation.</p>}
        <ul className="guide-deviations">
          {v.deviations.map((d) => (
            <li key={d.nodeId}>
              <strong>If they play {moveLabel(d.nodeId, d.san)}</strong>
              <p>{d.plan}</p>
              {d.showMoves && (
                <button type="button" onClick={() => setShown(d.showMoves!)}>Show</button>
              )}
              {d.level > level && <span className="level-badge">Unlocks at level {d.level}</span>}
            </li>
          ))}
        </ul>
        {opponent.length > 0 && (
          <PersonalBox>
            <ul>
              {opponent.map((o) => (
                <li key={`${o.nodeId}|${o.playedSan}`}>
                  Opponents played {moveLabel(`${o.nodeId} ${o.playedSan}`, o.playedSan)} in {o.count} of your games.
                  <GameLinks ids={o.gameIds} />
                </li>
              ))}
            </ul>
          </PersonalBox>
        )}
      </div>
    </div>
  );
}

function VariationParts({ guide, v }: { guide: GuideDTO; v: GuideVariationDTO }) {
  const p = v.personal;
  return (
    <>
      <section id={`final-${v.key}`} className="guide-part">
        <h2>Final form</h2>
        <FinalFormBoard fen={v.finalForm.fen} orientation={guide.color} jobs={v.finalForm.jobs} />
      </section>
      <section id={`route-${v.key}`} className="guide-part">
        <h2>The route</h2>
        <RouteStepper repertoireId={guide.repertoireId} color={guide.color} variation={v} />
        {p && p.leaks.length > 0 && (
          <PersonalBox>
            <ul>
              {p.leaks.map((l) => (
                <li key={`${l.nodeId}|${l.playedSan}`}>
                  {formatLeak(l)}.<GameLinks ids={l.gameIds} />
                </li>
              ))}
            </ul>
          </PersonalBox>
        )}
      </section>
      <section id={`deviations-${v.key}`} className="guide-part">
        <h2>If they do X…</h2>
        <Deviations v={v} color={guide.color} level={guide.level} />
      </section>
      <section id={`middlegame-${v.key}`} className="guide-part">
        <h2>Middlegame plan</h2>
        <Paragraphs text={v.middlegame} />
      </section>
      <section id={`mistakes-${v.key}`} className="guide-part">
        <h2>Typical mistakes</h2>
        {p && p.mistakes.length > 0 && (
          <PersonalBox>
            <ul>
              {p.mistakes.map((m) => (
                <li key={`${m.gameId}|${m.ply}`}>
                  <Link to={`/games/${m.gameId}`}>Game {m.gameId}</Link>, move {Math.ceil(m.ply / 2)}: you played {m.san}. {m.reason}
                </li>
              ))}
            </ul>
          </PersonalBox>
        )}
        <div className="guide-mistakes">
          {v.mistakes.map((m) => (
            <div key={m.moves.join(' ')} className="guide-mistake">
              <div className="viewer-board">
                <DrillBoard
                  fen={m.fen}
                  orientation={guide.color}
                  lastMove={lastMoveAfter(m.moves, m.moves.length)}
                  arrows={mistakeArrows(m)}
                  onMove={() => {}}
                  locked
                />
                {(m.bad || m.good) && <p className="muted guide-legend">Red: the move to avoid. Green: the move to play.</p>}
              </div>
              <p>{m.text}</p>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

export function GuidePage() {
  const { id = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const [guide, setGuide] = useState<GuideDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { hash } = useLocation();

  useEffect(() => {
    let stale = false;
    setGuide(null);
    setError(null);
    api.getGuide(id).then(
      (g) => !stale && setGuide(g),
      (e: Error) => !stale && setError(e.message),
    );
    return () => {
      stale = true;
    };
  }, [id]);

  // The page loads its content late, so the browser cannot scroll to the hash by itself.
  useEffect(() => {
    if (guide && hash) document.getElementById(hash.slice(1))?.scrollIntoView?.();
  }, [guide, hash]);

  if (error) return <p className="error">{error}</p>;
  if (!guide) return <p className="muted">Loading…</p>;
  const v = guide.variations.find((x) => x.key === params.get('v')) ?? guide.variations[0];
  if (!v) {
    return (
      <div className="guide">
        <p><Link to="/openings">Back to Openings</Link></p>
        <h1>{guide.name} guide</h1>
        <section id="why" className="guide-part">
          <h2>Why this opening</h2>
          <Paragraphs text={guide.why} />
        </section>
      </div>
    );
  }

  const toc: [string, string][] = [
    ['Why this opening', '#why'],
    ['Final form', `#final-${v.key}`],
    ['The route', `#route-${v.key}`],
    ['If they do X…', `#deviations-${v.key}`],
    ['Middlegame plan', `#middlegame-${v.key}`],
    ['Typical mistakes', `#mistakes-${v.key}`],
  ];

  return (
    <div className="guide">
      <p><Link to="/openings">Back to Openings</Link></p>
      <h1>{guide.name} guide</h1>
      <div className="guide-layout">
        <nav className="guide-toc" aria-label="Contents">
          {toc.map(([label, href]) => (
            <a key={href} href={href}>{label}</a>
          ))}
        </nav>
        <div className="guide-body">
          <section id="why" className="guide-part">
            <h2>Why this opening</h2>
            <Paragraphs text={guide.why} />
          </section>
          <div className="tabs guide-tabs" role="tablist">
            {guide.variations.map((x) => (
              <button
                key={x.key}
                type="button"
                role="tab"
                aria-selected={x.key === v.key}
                className={x.key === v.key ? 'tab active' : 'tab'}
                onClick={() => setParams({ v: x.key }, { replace: true })}
              >
                {x.name}
              </button>
            ))}
          </div>
          {v.personal && (
            <p className="guide-results">
              <span>{resultsLine(v)}</span>. <Link to="/insights">See your results in Insights</Link>
            </p>
          )}
          <VariationParts key={v.key} guide={guide} v={v} />
        </div>
      </div>
    </div>
  );
}

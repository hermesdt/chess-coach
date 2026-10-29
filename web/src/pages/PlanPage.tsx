import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { PlanDTO } from '../../../shared/types';
import { api } from '../api';
import { DrillBoard, type DrillArrow } from '../components/DrillBoard';
import { FinalFormBoard } from '../components/guide/FinalFormBoard';
import { ModelStepper } from '../components/plan/ModelStepper';
import { PlanBoard } from '../components/plan/PlanBoard';

const mistakeArrows = (m: PlanDTO['mistakes'][number]): DrillArrow[] => [
  { from: m.bad.from, to: m.bad.to, color: 'red' },
  ...m.good.map((g) => ({ from: g.from, to: g.to, color: 'green' as const })),
];

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function PlanPage() {
  const { id } = useParams();
  const [plan, setPlan] = useState<PlanDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [trained, setTrained] = useState(false);
  const [trainResult, setTrainResult] = useState<string | null>(null);
  const [training, setTraining] = useState(false);

  useEffect(() => {
    if (!id) return;
    let stale = false;
    setPlan(null);
    setError(null);
    api.getPlan(id).then(
      (p) => {
        if (stale) return;
        setPlan(p);
        setTrained(p.trained);
        setTrainResult(null);
      },
      (e: Error) => {
        if (!stale) setError(e.message);
      },
    );
    return () => {
      stale = true;
    };
  }, [id]);

  if (!plan) return <section>{error ? <p className="error">{error}</p> : <p>Loading...</p>}</section>;

  const train = async () => {
    setTraining(true);
    setError(null);
    try {
      const { created } = await api.trainPlan(plan.id);
      setTrained(true);
      setTrainResult(created === 0 ? 'No new cards. Your review has all of them.' : `${plural(created, 'card', 'cards')} added to your daily review.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setTraining(false);
    }
  };

  const guide = plan.guideLinks[0];
  const parts: [string, string, boolean][] = [
    ['When', 'when', plan.triggerLabels.length > 0], ['Goal', 'goal', true], ['Steps', 'steps', true],
    ['Pawn breaks', 'breaks', plan.breaks.length > 0], ['Watch out', 'watch', true], ['Typical mistakes', 'mistakes', true],
    ['Model line', 'model', plan.models.length > 0], ['Train', 'train', true],
  ];

  return (
    <article className="plan">
      <h1>{plan.title}</h1>
      <p className="muted"><span className="level-badge">Level {plan.level}</span> {plan.summary}</p>
      <nav aria-label="Contents" className="plan-toc">
        {parts.filter(([, , show]) => show).map(([label, anchor]) => <a key={anchor} href={`#${anchor}`}>{label}</a>)}
      </nav>

      {plan.triggerLabels.length > 0 && (
        <section id="when" className="guide-part">
          <h2>When</h2>
          <PlanBoard board={plan.position} orientation={plan.side} />
          <ul>{plan.triggerLabels.map((t) => <li key={t}>{t}</li>)}</ul>
        </section>
      )}

      <section id="goal" className="guide-part">
        <h2>Goal</h2>
        <p>{plan.goal}</p>
      </section>

      <section id="steps" className="guide-part">
        <h2>Steps</h2>
        <h3>Key pieces</h3>
        <FinalFormBoard fen={plan.position.fen} orientation={plan.side} jobs={plan.jobs} />
        <ol className="plan-steps">
          {plan.steps.map((s) => (
            <li key={s.text}>
              <PlanBoard board={s.board} orientation={plan.side} />
              <p>{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {plan.breaks.length > 0 && (
        <section id="breaks" className="guide-part">
          <h2>Pawn breaks</h2>
          <ul>{plan.breaks.map((b) => <li key={b.from + b.to}><strong>{b.from}–{b.to}:</strong> {b.text}</li>)}</ul>
        </section>
      )}

      <section id="watch" className="guide-part">
        <h2>Watch out</h2>
        {plan.opponent.map((o) => (
          <div key={o.text}>
            {o.board && <PlanBoard board={o.board} orientation={plan.side} />}
            <p>{o.text}</p>
          </div>
        ))}
        <h3>When not to use this plan</h3>
        <ul>{plan.notNow.map((t) => <li key={t}>{t}</li>)}</ul>
      </section>

      <section id="mistakes" className="guide-part">
        <h2>Typical mistakes</h2>
        {plan.mistakes.map((m) => (
          <div key={m.moves.join(' ') + m.bad.san} className="plan-mistake">
            <DrillBoard fen={m.fen} orientation={plan.side} onMove={() => {}} arrows={mistakeArrows(m)} locked />
            <p>{m.text}</p>
          </div>
        ))}
      </section>

      {plan.models.length > 0 && (
        <section id="model" className="guide-part">
          <h2>Model line</h2>
          {plan.models.map((m) => <ModelStepper key={m.title} model={m} orientation={plan.side} />)}
        </section>
      )}

      <section id="train" className="guide-part">
        <h2>Train</h2>
        {trained && <p>This plan is in your daily review.</p>}
        <div className="actions">
          <button type="button" disabled={plan.locked || training} onClick={() => void train()}>Train this plan</button>
          {plan.locked && <span className="level-badge">Unlocks at level {plan.level}</span>}
        </div>
        {trainResult && <p>{trainResult}</p>}
        {error && <p className="error">{error}</p>}
      </section>

      <p className="muted">
        {guide && <><Link to={`/openings/${guide.repertoireId}/guide?v=${guide.variation}`}>Back to the opening</Link> · </>}
        Lessons:{' '}
        {plan.lessons.map((l, i) => (
          <span key={l.id}>
            {i > 0 && ', '}
            {l.locked ? <span>{l.title}</span> : <Link to={`/course/${l.id}`}>{l.title}</Link>}
          </span>
        ))}
      </p>
    </article>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { PlanGroup, PlanIndexEntry } from '../../../shared/types';
import { api } from '../api';
import { DrillBoard } from '../components/DrillBoard';

const GROUPS: { group: PlanGroup; title: string }[] = [
  { group: 'london', title: 'London (White)' },
  { group: 'caro-kann', title: 'Caro-Kann (Black)' },
  { group: 'slav', title: 'Slav (Black)' },
  { group: 'general', title: 'Both colours' },
];

export function PlansPage() {
  const [plans, setPlans] = useState<PlanIndexEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    api.listPlans().then(
      (p) => {
        if (!stale) setPlans(p);
      },
      (e: Error) => {
        if (!stale) setError(e.message);
      },
    );
    return () => {
      stale = true;
    };
  }, []);

  if (!plans) return <section><h1>Plans</h1>{error ? <p className="error">{error}</p> : <p>Loading...</p>}</section>;
  return (
    <section className="plans">
      <h1>Plans</h1>
      <p className="muted">A plan tells you what to do in the middlegame of one typical position.</p>
      {plans.length === 0 && <p className="muted">No plans yet.</p>}
      {GROUPS.map(({ group, title }) => {
        const list = plans.filter((p) => p.group === group);
        if (list.length === 0) return null;
        return (
          <section key={group}>
            <h2>{title}</h2>
            <ul className="plan-list">
              {list.map((p) => (
                <li key={p.id} className={`plan-item${p.locked ? ' locked' : ''}`}>
                  <div className="plan-thumb">
                    <DrillBoard fen={p.fen} orientation={p.side} onMove={() => {}} locked />
                  </div>
                  <div>
                    <h3><Link to={`/plans/${p.id}`}>{p.title}</Link></h3>
                    <p>{p.summary}</p>
                    <p className="muted">
                      <span className="level-badge">Level {p.level}</span>
                      {p.locked && <span> Unlocks at level {p.level}</span>}
                      {p.trained && <span className="badge"> Training</span>}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </section>
  );
}

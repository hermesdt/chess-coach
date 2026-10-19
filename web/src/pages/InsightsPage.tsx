import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { TAG_TEXT } from '../../../shared/tag-text';
import type { Insights, InsightsWindow } from '../../../shared/types';
import { api, type DashboardData } from '../api';
import { BarResults } from '../components/charts/BarResults';
import { LineSeries } from '../components/charts/LineSeries';
import { pinOpenings } from '../components/charts/scales';
import { monthName, TagHeatmap } from '../components/charts/TagHeatmap';
import { lessonLink } from '../lib/lesson-links';

const WINDOWS: { id: InsightsWindow; label: string }[] = [
  { id: '30d', label: '30 days' },
  { id: '90d', label: '90 days' },
  { id: '365d', label: '365 days' },
  { id: 'all', label: 'All' },
];

// Categorical palette, fixed order: blue, orange, aqua, yellow (validated, light surface).
const SERIES_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'];

const formatDay = (t: number) => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: '2-digit' });
const monthStart = (m: string) => Date.parse(`${m}-01T00:00:00Z`);
const plural = (n: number, word: string) => (n === 1 ? word : `${word}s`);

function Card({ title, children, wide = false }: { title: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <section className={wide ? 'panel insight-card wide' : 'panel insight-card'}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function InsightsPage() {
  const [window, setWindow] = useState<InsightsWindow>('90d');
  const [data, setData] = useState<Insights | null>(null);
  const [topTag, setTopTag] = useState<DashboardData['topTag']>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    setError(null);
    api.getInsights(window).then(
      (d) => {
        if (!stale) setData(d);
      },
      (e: Error) => {
        if (!stale) setError(e.message);
      },
    );
    return () => {
      stale = true;
    };
  }, [window]);

  // The focus card uses the same top weakness as the Dashboard.
  useEffect(() => {
    api.getDashboard().then((d) => setTopTag(d.topTag), () => undefined);
  }, []);

  const picker = (
    <div className="window-picker" role="group" aria-label="Time window">
      {WINDOWS.map((w) => (
        <button key={w.id} type="button" className={w.id === window ? 'tab active' : 'tab'} aria-pressed={w.id === window} onClick={() => setWindow(w.id)}>
          {w.label}
        </button>
      ))}
    </div>
  );

  const head = (
    <>
      <h1>Insights</h1>
      {picker}
      {error && <p className="error">{error}</p>}
    </>
  );
  if (!data) return <section>{head}{!error && <p>Loading...</p>}</section>;

  const { summary } = data;
  const accuracySeries = [{ name: 'Accuracy', color: SERIES_COLORS[0]!, points: data.accuracyByMonth.map((a) => ({ x: monthStart(a.month), y: Math.round(a.avg) })) }];
  const byPoints = [...data.rating].sort((a, b) => b.points.length - a.points.length);
  const hiddenSeries = Math.max(0, byPoints.length - SERIES_COLORS.length);
  const ratingSeries = byPoints.slice(0, SERIES_COLORS.length).map((s, i) => ({
    name: s.series,
    color: SERIES_COLORS[i]!,
    points: s.points.map((p) => ({ x: p.t, y: p.elo })),
  }));
  const noAnalysis = 'No analysed games in this window. Open a game and press Analyse.';

  return (
    <section className="insights">
      {head}
      <p className="muted" data-testid="summary">
        {summary.games} {plural(summary.games, 'game')}, {summary.analysed} analysed
        {summary.winRate !== null && `, you won ${Math.round(summary.winRate * 100)}%`}.
      </p>
      <div className="insight-grid">
        <Card title="Results by opening" wide>
          {data.byOpening.length === 0 ? (
            <p className="muted">No games in this window. Add your usernames in Settings, then press Sync now.</p>
          ) : (
            <BarResults rows={pinOpenings(data.byOpening)} />
          )}
        </Card>
        <Card title="Mistakes per game by type" wide>
          {data.accuracyByMonth.length === 0 ? (
            <p className="muted">{noAnalysis}</p>
          ) : data.tagsByMonth.length === 0 ? (
            <p className="muted">No mistakes found in your analysed games. Keep it up.</p>
          ) : (
            <TagHeatmap accuracyByMonth={data.accuracyByMonth} tagsByMonth={data.tagsByMonth} />
          )}
        </Card>
        <Card title="Accuracy">
          {data.accuracyByMonth.length === 0 ? (
            <p className="muted">{noAnalysis}</p>
          ) : (
            <LineSeries series={accuracySeries} formatX={monthOfTime} formatY={(y) => `${y}%`} xLabel="Month" yLabel="Average accuracy" />
          )}
        </Card>
        <Card title="Rating">
          {ratingSeries.length === 0 ? (
            <p className="muted">No rated games in this window. Sync your games to see your rating.</p>
          ) : (
            <>
              <LineSeries series={ratingSeries} formatX={formatDay} xLabel="Date" yLabel="Rating" />
              {hiddenSeries > 0 && <p className="muted viz-caption">{hiddenSeries} more series not shown.</p>}
            </>
          )}
        </Card>
        <Card title="Recommended focus">
          {topTag ? (
            <>
              <p>{TAG_TEXT[topTag.tag]}. It shows in {topTag.count} of your last {topTag.games} {plural(topTag.games, 'game')}.</p>
              <p><Link to={lessonLink(topTag.tag).to}>Lesson: {lessonLink(topTag.tag).title}</Link></p>
            </>
          ) : (
            <p className="muted">Analyse a few games to see your main focus.</p>
          )}
        </Card>
      </div>
    </section>
  );
}

/** Month label for a month-start time, e.g. "Aug 26". */
function monthOfTime(t: number): string {
  return monthName(new Date(t).toISOString().slice(0, 7));
}

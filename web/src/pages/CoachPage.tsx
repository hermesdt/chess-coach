import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { LESSON_TITLES } from '../../../shared/lessons';
import type { AiProviderSetting, ProviderId, WeaknessReportNote } from '../../../shared/types';
import { api, type ProviderInfo } from '../api';
import { AnalyseButton } from '../components/AnalyseButton';
import { defaultProviderId, ProviderSelect } from '../components/ProviderSelect';

export function CoachPage() {
  const [note, setNote] = useState<WeaknessReportNote | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [setting, setSetting] = useState<AiProviderSetting>('auto');
  const [chosen, setChosen] = useState<ProviderId | ''>('');

  const load = useCallback(() => {
    api.getWeakness().then(
      (n) => {
        setNote(n);
        setLoaded(true);
        setError(null);
      },
      (e: Error) => {
        setError(e.message);
        setLoaded(true);
      },
    );
  }, []);

  useEffect(load, [load]);
  useEffect(() => {
    Promise.all([api.listProviders(), api.getSettings()]).then(
      ([list, s]) => {
        setProviders(list);
        setSetting(s.aiProvider);
      },
      () => {},
    );
  }, []);

  const noneAvailable = providers.length > 0 && !providers.some((p) => p.ok);

  return (
    <section>
      <h1>Coach</h1>
      {error && <p className="error">{error}</p>}
      {!loaded && <p>Loading...</p>}
      {loaded && !note && !error && <p className="muted">No report yet. Analyse a few games, then make a report.</p>}
      {note && (
        <div>
          <p className="muted">{note.provider} · {note.model} · {new Date(note.createdAt).toLocaleString()}</p>
          <h2>{note.report.headline}</h2>
          {note.report.weaknesses.map((w) => (
            <div key={w.title} className="weakness">
              <h3>{w.title}</h3>
              <p>{w.rule}</p>
              <p className="muted">Focus: {w.focus}</p>
              <Link to={`/course/${w.lessonId}`}>Lesson: {LESSON_TITLES[w.lessonId]}</Link>
            </div>
          ))}
          <p>{note.report.encouragement}</p>
        </div>
      )}
      {noneAvailable && (
        <p className="muted">
          No AI provider is ready. Set one up in <Link to="/settings">Settings</Link>.
        </p>
      )}
      <div className="coach-actions">
        {providers.some((p) => p.ok) && (
          <ProviderSelect providers={providers} defaultSetting={setting} value={chosen} onChange={setChosen} />
        )}
        <AnalyseButton
          label="Make a new report"
          runningLabel="Coach is thinking..."
          start={async () => (await api.makeWeakness(chosen || defaultProviderId(providers, setting) || undefined)).jobId}
          onFinished={load}
        />
      </div>
    </section>
  );
}

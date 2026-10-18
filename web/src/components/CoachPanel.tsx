import { useEffect, useState } from 'react';
import type { AiProviderSetting, GameReviewNote, ProviderId } from '../../../shared/types';
import { Link } from 'react-router';
import { api, type ProviderInfo } from '../api';
import { AnalyseButton } from './AnalyseButton';
import { defaultProviderId, ProviderSelect } from './ProviderSelect';

interface Props {
  gameId: number;
  notes: GameReviewNote[];
  active: number;
  onActive: (index: number) => void;
  /** Called when a coach job ends, so the page reloads the notes. */
  onChanged: () => void;
}

const tabLabel = (n: GameReviewNote) => `${n.provider} · ${n.model}`;

export function CoachPanel({ gameId, notes, active, onActive, onChanged }: Props) {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [setting, setSetting] = useState<AiProviderSetting>('auto');
  const [chosen, setChosen] = useState<ProviderId | ''>('');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let stale = false;
    Promise.all([api.listProviders(), api.getSettings()]).then(
      ([list, s]) => {
        if (stale) return;
        setProviders(list);
        setSetting(s.aiProvider);
      },
      (e: Error) => {
        if (!stale) setLoadError(e.message);
      },
    );
    return () => {
      stale = true;
    };
  }, []);

  const note = notes[active] ?? null;
  const noneAvailable = providers.length > 0 && !providers.some((p) => p.ok);

  return (
    <div className="coach-panel">
      <h2>Coach</h2>
      {loadError && <p className="error">Could not load the AI providers: {loadError}</p>}
      {noneAvailable && (
        <p className="muted">
          No AI provider is ready. Set one up in <Link to="/settings">Settings</Link>.
        </p>
      )}
      {notes.length > 1 && (
        <div className="tabs" role="tablist">
          {notes.map((n, i) => (
            <button key={n.provider} type="button" role="tab" aria-selected={i === active} className={i === active ? 'active' : undefined} onClick={() => onActive(i)}>
              {tabLabel(n)}
            </button>
          ))}
        </div>
      )}
      {note && (
        <div className="coach-note">
          {notes.length === 1 && <p className="muted">{tabLabel(note)}</p>}
          <p>{note.review.summary}</p>
          {note.review.openingNote && <p><strong>Opening:</strong> {note.review.openingNote}</p>}
          <p className="practice"><strong>One thing to practise:</strong> {note.review.oneThingToPractice}</p>
        </div>
      )}
      <div className="coach-actions">
        {notes.length === 0 && (
          <AnalyseButton
            label="Explain this game"
            runningLabel="Coach is thinking..."
            start={async () => (await api.coachGame(gameId)).jobId}
            onFinished={onChanged}
          />
        )}
        {providers.some((p) => p.ok) && (
          <>
            <ProviderSelect providers={providers} defaultSetting={setting} value={chosen} onChange={setChosen} label="Explain with" />
            <AnalyseButton
              label="Explain with this provider"
              runningLabel="Coach is thinking..."
              start={async () => {
                const id = chosen || defaultProviderId(providers, setting) || undefined;
                return (await api.coachGame(gameId, id)).jobId;
              }}
              onFinished={onChanged}
            />
          </>
        )}
      </div>
    </div>
  );
}

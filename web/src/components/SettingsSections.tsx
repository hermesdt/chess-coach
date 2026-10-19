import { type FormEvent, useEffect, useState } from 'react';
import type { DataInfo, FlagDetail, SettingsDTO, SettingsUpdate } from '../../../shared/types';
import { api } from '../api';

export const ENV_NOTE = 'Empty uses the value from .env';

export function EngineReviewSettings({ settings, onSaved }: { settings: SettingsDTO; onSaved: (s: SettingsDTO) => void }) {
  const [nodes, setNodes] = useState(String(settings.engineNodes));
  const [daily, setDaily] = useState(String(settings.reviewDailyLimit));
  const [newPerDay, setNewPerDay] = useState(String(settings.reviewNewPerDay));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setError(null);
    const update: SettingsUpdate = { reviewDailyLimit: Number(daily), reviewNewPerDay: Number(newPerDay) };
    if (nodes.trim() !== '') update.engineNodes = Number(nodes);
    try {
      onSaved(await api.putSettings(update));
      setMessage('Settings saved.');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <>
      <h2>Engine and review</h2>
      <form className="form" onSubmit={(e) => void save(e)}>
        <label>
          Engine nodes per move
          <input type="number" min={10000} max={5000000} step={10000} value={nodes} onChange={(e) => setNodes(e.target.value)} />
          <small>More nodes give better analysis and take more time. Use 10000 to 5000000.</small>
          <small>{ENV_NOTE}</small>
        </label>
        <label>
          Reviews per day
          <input type="number" min={1} max={200} value={daily} onChange={(e) => setDaily(e.target.value)} />
          <small>The most cards in one review session.</small>
        </label>
        <label>
          New cards per day
          <input type="number" min={0} max={100} value={newPerDay} onChange={(e) => setNewPerDay(e.target.value)} />
          <small>Use 0 to see no new cards.</small>
        </label>
        <button type="submit">Save engine and review</button>
        {message && <p className="ok">{message}</p>}
        {error && <p className="error">{error}</p>}
      </form>
    </>
  );
}

export function FlagsSection() {
  const [flags, setFlags] = useState<FlagDetail[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getFlags().then(setFlags, (e: Error) => setError(e.message));
  }, []);

  const restore = async (id: number) => {
    setError(null);
    try {
      await api.restoreFlag(id);
      setFlags(await api.getFlags());
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <>
      <h2>Reported problems</h2>
      {error && <p className="error">{error}</p>}
      {flags?.length === 0 && <p className="muted">No reported problems.</p>}
      <ul className="flag-list">
        {flags?.map((f) => (
          <li key={f.id}>
            <strong>{f.prompt}</strong> <span className="muted">({f.kind})</span>
            <div><code>{f.fen}</code></div>
            <div>{f.note}</div>
            <small className="muted">{new Date(f.createdAt).toLocaleDateString()}</small>{' '}
            <button type="button" onClick={() => void restore(f.id)}>Restore card</button>
          </li>
        ))}
      </ul>
    </>
  );
}

export function DataSection() {
  const [info, setInfo] = useState<DataInfo | null>(null);
  useEffect(() => {
    api.getDataInfo().then(setInfo, () => undefined);
  }, []);
  if (!info) return null;
  const dupes = info.duplicateGames > 0 ? ` (${info.duplicateGames} duplicate ${info.duplicateGames === 1 ? 'copy' : 'copies'} hidden)` : '';
  return (
    <>
      <h2>Data</h2>
      <dl className="data-info">
        <dt>Database file</dt>
        <dd><code>{info.dbPath}</code></dd>
        <dt>Games</dt>
        <dd>{`${info.games} games${dupes}`}</dd>
        <dt>Cards</dt>
        <dd>{`${info.cards} cards`}</dd>
        <dt>Backups</dt>
        <dd>{info.backupsDir ? <code>{info.backupsDir}</code> : 'Backups are off for this database.'}</dd>
      </dl>
    </>
  );
}

import { type FormEvent, useEffect, useState } from 'react';
import type { SettingsDTO, SettingsUpdate } from '../../../shared/types';
import { api } from '../api';

export function SettingsPage() {
  const [settings, setSettings] = useState<SettingsDTO | null>(null);
  const [chesscom, setChesscom] = useState('');
  const [lichess, setLichess] = useState('');
  const [token, setToken] = useState('');
  const [months, setMonths] = useState('12');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const apply = (s: SettingsDTO) => {
    setSettings(s);
    setChesscom(s.chesscomUsername ?? '');
    setLichess(s.lichessUsername ?? '');
    setMonths(String(s.syncInitialMonths));
  };

  useEffect(() => {
    api.getSettings().then(apply, (e: Error) => setError(e.message));
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setError(null);
    const update: SettingsUpdate = {
      chesscomUsername: chesscom,
      lichessUsername: lichess,
      syncInitialMonths: Number(months),
    };
    if (token !== '') update.lichessToken = token;
    try {
      apply(await api.putSettings(update));
      setToken('');
      setMessage('Settings saved.');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const clearToken = async () => {
    try {
      apply(await api.putSettings({ lichessToken: '' }));
      setMessage('Token removed.');
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (!settings && !error) return <p>Loading...</p>;

  return (
    <section>
      <h1>Settings</h1>
      <form className="form" onSubmit={(e) => void save(e)}>
        <label>
          chess.com username
          <input value={chesscom} onChange={(e) => setChesscom(e.target.value)} />
        </label>
        <label>
          lichess username
          <input value={lichess} onChange={(e) => setLichess(e.target.value)} />
        </label>
        <label>
          lichess token
          <input
            type="password"
            autoComplete="off"
            value={token}
            placeholder={settings?.lichessTokenSet ? 'saved' : ''}
            onChange={(e) => setToken(e.target.value)}
          />
          <small>
            Lichess needs a personal access token (no scopes needed).{' '}
            <a href="https://lichess.org/account/oauth/token" target="_blank" rel="noreferrer">
              Create one on lichess
            </a>
            .
          </small>
        </label>
        {settings?.lichessTokenSet && (
          <button type="button" className="link" onClick={() => void clearToken()}>
            Remove saved token
          </button>
        )}
        <label>
          Months for first sync
          <input type="number" min={1} max={120} value={months} onChange={(e) => setMonths(e.target.value)} />
        </label>
        <button type="submit">Save</button>
        {message && <p className="ok">{message}</p>}
        {error && <p className="error">{error}</p>}
      </form>
    </section>
  );
}

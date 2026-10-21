import { type FormEvent, useEffect, useState } from 'react';
import { CHAT_MODEL_DEFAULTS, DEEP_MODEL_DEFAULTS, PROVIDER_IDS, type AiProviderSetting, type ProviderId, type SettingsDTO, type SettingsUpdate } from '../../../shared/types';
import { DataSection, ENV_NOTE, EngineReviewSettings, FlagsSection, LevelSettings } from '../components/SettingsSections';
import { api, type ProviderInfo, type ProviderTestResult } from '../api';

function AiSettings({ settings, onSaved }: { settings: SettingsDTO; onSaved: (s: SettingsDTO) => void }) {
  const [provider, setProvider] = useState<AiProviderSetting>(settings.aiProvider);
  const [models, setModels] = useState<Record<ProviderId, string>>(
    () => Object.fromEntries(PROVIDER_IDS.map((id) => [id, settings.aiModels[id] ?? ''])) as Record<ProviderId, string>,
  );
  const initial = (m: Record<ProviderId, string | null>) => Object.fromEntries(PROVIDER_IDS.map((id) => [id, m[id] ?? ''])) as Record<ProviderId, string>;
  const [chatModels, setChatModels] = useState(() => initial(settings.aiChatModels));
  const [deepModels, setDeepModels] = useState(() => initial(settings.aiDeepModels));
  const [openrouterKey, setOpenrouterKey] = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [tests, setTests] = useState<Partial<Record<ProviderId, ProviderTestResult | 'running'>>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadProviders = () => {
    api.listProviders().then(setProviders, (e: Error) => setError(e.message));
  };
  useEffect(loadProviders, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setMessage(null);
    setError(null);
    const update: SettingsUpdate = { aiProvider: provider, aiModels: models };
    const changed = (now: Record<ProviderId, string>, saved: Record<ProviderId, string | null>) => {
      const out: Partial<Record<ProviderId, string>> = {};
      for (const id of PROVIDER_IDS) if (now[id].trim() !== (saved[id] ?? '')) out[id] = now[id].trim();
      return Object.keys(out).length > 0 ? out : undefined;
    };
    const chat = changed(chatModels, settings.aiChatModels);
    const deep = changed(deepModels, settings.aiDeepModels);
    if (chat) update.aiChatModels = chat;
    if (deep) update.aiDeepModels = deep;
    if (openrouterKey !== '') update.openrouterApiKey = openrouterKey;
    if (anthropicKey !== '') update.anthropicApiKey = anthropicKey;
    try {
      onSaved(await api.putSettings(update));
      setOpenrouterKey('');
      setAnthropicKey('');
      setMessage('AI settings saved.');
      loadProviders();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const removeKey = async (field: 'openrouterApiKey' | 'anthropicApiKey') => {
    setMessage(null);
    setError(null);
    try {
      onSaved(await api.putSettings({ [field]: '' }));
      setMessage('API key removed.');
      loadProviders();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const anyTestRunning = Object.values(tests).includes('running');
  const test = async (id: ProviderId) => {
    setTests((t) => ({ ...t, [id]: 'running' }));
    try {
      const result = await api.testProvider(id);
      setTests((t) => ({ ...t, [id]: result }));
    } catch (err) {
      setTests((t) => ({ ...t, [id]: { ok: false, error: (err as Error).message } }));
    }
  };

  return (
    <>
      <h2>AI coach</h2>
      <ul className="ai-status">
        {providers.map((p) => {
          const t = tests[p.id];
          return (
            <li key={p.id}>
              <strong>{p.label}</strong>
              {p.ok ? <span className="ok">ready</span> : <span className="muted">not ready: {p.reason ?? 'unknown reason'}</span>}
              <button type="button" disabled={anyTestRunning} onClick={() => void test(p.id)}>
                {t === 'running' ? 'Testing...' : 'Test'}
              </button>
              {t && t !== 'running' && (t.ok ? <span className="ok">OK in {t.ms} ms · {t.model}</span> : <span className="error">{t.error}</span>)}
            </li>
          );
        })}
      </ul>
      <form className="form" onSubmit={(e) => void save(e)}>
        <label>
          Default provider
          <select value={provider} onChange={(e) => setProvider(e.target.value as AiProviderSetting)}>
            <option value="auto">auto (first one that is ready)</option>
            <option value="none">none (AI off)</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </label>
        {providers.map((p) => (
          <div key={p.id}>
            <label>
              {p.label} model
              <input
                value={models[p.id]}
                placeholder="provider default"
                onChange={(e) => setModels((m) => ({ ...m, [p.id]: e.target.value }))}
              />
            </label>
            <label>
              Chat model
              <input
                value={chatModels[p.id]}
                placeholder={`default (${CHAT_MODEL_DEFAULTS[p.id] ?? 'provider default'})`}
                onChange={(e) => setChatModels((m) => ({ ...m, [p.id]: e.target.value }))}
              />
            </label>
            <label>
              Deep model
              <input
                value={deepModels[p.id]}
                placeholder={`default (${DEEP_MODEL_DEFAULTS[p.id] ?? 'provider default'})`}
                onChange={(e) => setDeepModels((m) => ({ ...m, [p.id]: e.target.value }))}
              />
            </label>
          </div>
        ))}
        <label>
          OpenRouter API key
          <input
            type="password"
            autoComplete="off"
            value={openrouterKey}
            placeholder={settings.openrouterKeySet ? 'saved' : ''}
            onChange={(e) => setOpenrouterKey(e.target.value)}
          />
          <small>{ENV_NOTE}</small>
        </label>
        {settings.openrouterKeySet && (
          <button type="button" className="link" onClick={() => void removeKey('openrouterApiKey')}>
            Remove OpenRouter key
          </button>
        )}
        <label>
          Anthropic API key
          <input
            type="password"
            autoComplete="off"
            value={anthropicKey}
            placeholder={settings.anthropicKeySet ? 'saved' : ''}
            onChange={(e) => setAnthropicKey(e.target.value)}
          />
          <small>{ENV_NOTE}</small>
        </label>
        {settings.anthropicKeySet && (
          <button type="button" className="link" onClick={() => void removeKey('anthropicApiKey')}>
            Remove Anthropic key
          </button>
        )}
        <button type="submit">Save AI settings</button>
        {message && <p className="ok">{message}</p>}
        {error && <p className="error">{error}</p>}
      </form>
    </>
  );
}

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
          <small>{ENV_NOTE}</small>
        </label>
        <label>
          lichess username
          <input value={lichess} onChange={(e) => setLichess(e.target.value)} />
          <small>{ENV_NOTE}</small>
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
          <small>{ENV_NOTE}</small>
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
      {settings && <AiSettings settings={settings} onSaved={setSettings} />}
      {settings && <EngineReviewSettings settings={settings} onSaved={setSettings} />}
      {settings && <LevelSettings settings={settings} onSaved={setSettings} />}
      <FlagsSection />
      <DataSection />
    </section>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Color, GameList, GameResult, Source } from '../../../shared/types';
import { api } from '../api';
import { ImportPgnDialog } from '../components/ImportPgnDialog';
import { SyncButton } from '../components/SyncButton';

const PAGE_SIZE = 50;

export const formatDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function GamesPage() {
  const navigate = useNavigate();
  const [source, setSource] = useState<Source | ''>('');
  const [color, setColor] = useState<Color | ''>('');
  const [result, setResult] = useState<GameResult | ''>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<GameList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const load = useCallback(() => {
    api
      .listGames({
        source: source || undefined,
        color: color || undefined,
        result: result || undefined,
        q: search.trim() || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      .then(setData, (e: Error) => setError(e.message));
  }, [source, color, result, search, page]);

  useEffect(load, [load]);

  const filtered = source !== '' || color !== '' || result !== '' || search.trim() !== '';
  const pages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1;
  const onFilter = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setPage(0);
  };

  return (
    <section>
      <h1>Games</h1>
      <div className="toolbar">
        <SyncButton onFinished={load} />
        <button type="button" onClick={() => setImportOpen(true)}>Import PGN</button>
      </div>
      <div className="filters">
        <select aria-label="Source" value={source} onChange={(e) => onFilter(setSource)(e.target.value as Source | '')}>
          <option value="">All sources</option>
          <option value="chesscom">chess.com</option>
          <option value="lichess">lichess</option>
          <option value="import">Import</option>
        </select>
        <select aria-label="Colour" value={color} onChange={(e) => onFilter(setColor)(e.target.value as Color | '')}>
          <option value="">Any colour</option>
          <option value="white">White</option>
          <option value="black">Black</option>
        </select>
        <select aria-label="Result" value={result} onChange={(e) => onFilter(setResult)(e.target.value as GameResult | '')}>
          <option value="">Any result</option>
          <option value="win">Win</option>
          <option value="loss">Loss</option>
          <option value="draw">Draw</option>
        </select>
        <input
          type="search"
          placeholder="Search opponent or opening"
          value={search}
          onChange={(e) => onFilter(setSearch)(e.target.value)}
        />
      </div>
      {error && <p className="error">{error}</p>}
      {data && data.total === 0 && !filtered && (
        <p>No games yet. Add your usernames in Settings, then press Sync.</p>
      )}
      {data && data.total === 0 && filtered && <p>No games match these filters.</p>}
      {data && data.total > 0 && (
        <>
          <table className="games">
            <thead>
              <tr>
                <th>Date</th><th>Platform</th><th>Colour</th><th>Opponent</th><th>Result</th><th>Opening</th><th>Time</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((g) => {
                const opp = g.userColor === 'black' ? { name: g.white, elo: g.whiteElo } : { name: g.black, elo: g.blackElo };
                return (
                  <tr key={g.id} className="clickable" onClick={() => void navigate(`/games/${g.id}`)}>
                    <td>{formatDate(g.playedAt)}</td>
                    <td>{g.source}</td>
                    <td>{g.userColor ?? '-'}</td>
                    <td>{opp.name}{opp.elo !== null ? ` (${opp.elo})` : ''}</td>
                    <td>{g.result ? <span className={`badge ${g.result}`}>{g.result}</span> : '-'}</td>
                    <td>{g.openingName ?? g.eco ?? ''}</td>
                    <td>{g.timeClass}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="pager">
            <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
            <span>Page {page + 1} of {pages} ({data.total} games)</span>
            <button type="button" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        </>
      )}
      {importOpen && <ImportPgnDialog onClose={() => setImportOpen(false)} onImported={load} />}
    </section>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Color, GameList, GameResult, Source } from '../../../shared/types';
import { api } from '../api';
import { ImportPgnDialog } from '../components/ImportPgnDialog';
import { AnalyseButton } from '../components/AnalyseButton';
import { SyncButton } from '../components/SyncButton';
import { formatDate, opponentLabel } from '../lib/format';

const PAGE_SIZE = 50;

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

  const latestRequest = useRef(0);

  const load = useCallback(() => {
    const requestId = ++latestRequest.current;
    api
      .listGames({
        source: source || undefined,
        color: color || undefined,
        result: result || undefined,
        q: search.trim() || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      .then(
        (list) => {
          if (requestId !== latestRequest.current) return;
          setData(list);
          setError(null);
        },
        (e: Error) => {
          if (requestId === latestRequest.current) setError(e.message);
        },
      );
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
        <AnalyseButton
          label="Analyse more"
          runningLabel="Analysing..."
          start={async () => (await api.queueAnalysis(20)).jobId}
          onFinished={load}
        />
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
                <th>Date</th><th>Platform</th><th>Colour</th><th>Opponent</th><th>Result</th><th>Opening</th><th>Time</th><th>Accuracy</th><th>??/?</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((g) => {
                const open = () => void navigate(`/games/${g.id}`);
                return (
                  <tr
                    key={g.id}
                    className="clickable"
                    tabIndex={0}
                    onClick={open}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') open();
                    }}
                  >
                    <td className="nowrap">{formatDate(g.playedAt)}</td>
                    <td>{g.source}</td>
                    <td>{g.userColor ?? '-'}</td>
                    <td>{opponentLabel(g)}</td>
                    <td>{g.result ? <span className={`badge ${g.result}`}>{g.result}</span> : '-'}</td>
                    <td>{g.openingName ?? g.eco ?? ''}</td>
                    <td>{g.timeClass}</td>
                    <td>{g.analysis?.status === 'done' && g.analysis.accuracyUser !== null ? `${Math.round(g.analysis.accuracyUser)}%` : '-'}</td>
                    <td>{g.analysis?.status === 'done' ? `${g.analysis.blunders}/${g.analysis.mistakes}` : '-'}</td>
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

import { useCallback, useEffect, useState } from 'react';
import { api, type SyncStatus } from '../api';
import { SyncButton } from '../components/SyncButton';

const when = (ms: number | null) => (ms === null ? 'never' : new Date(ms).toLocaleString());

export function DashboardPage() {
  const [total, setTotal] = useState<number | null>(null);
  const [status, setStatus] = useState<SyncStatus | null>(null);

  const load = useCallback(() => {
    api.listGames({ limit: 1 }).then((l) => setTotal(l.total), () => undefined);
    api.getSyncStatus().then(setStatus, () => undefined);
  }, []);

  useEffect(load, [load]);

  return (
    <section>
      <h1>Dashboard</h1>
      <p>Games: {total ?? '...'}</p>
      <p>Last sync chess.com: {status ? when(status.chesscom) : '...'}</p>
      <p>Last sync lichess: {status ? when(status.lichess) : '...'}</p>
      <SyncButton onFinished={load} />
    </section>
  );
}

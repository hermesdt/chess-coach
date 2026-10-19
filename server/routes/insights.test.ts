import { describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { openDb } from '../db/db.js';

const NOW = Date.UTC(2026, 9, 18, 12);
const app = createApp({ db: openDb(':memory:'), now: () => NOW });

describe('GET /api/insights', () => {
  it('defaults to 90d and returns empty insights', async () => {
    const res = await app.request('/api/insights');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ byOpening: [], summary: { games: 0, analysed: 0, winRate: null } });
  });

  it('accepts every window', async () => {
    for (const w of ['30d', '90d', '365d', 'all']) expect((await app.request(`/api/insights?window=${w}`)).status).toBe(200);
  });

  it('rejects an invalid window with 400', async () => {
    expect((await app.request('/api/insights?window=7d')).status).toBe(400);
  });
});

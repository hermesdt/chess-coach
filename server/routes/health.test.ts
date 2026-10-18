import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { createApp } from '../app.js';

it('GET /api/health returns ok', async () => {
  const app = createApp({ db: new DatabaseSync(':memory:') });
  const res = await app.request('/api/health');
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true });
});

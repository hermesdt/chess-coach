import { describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { openDb } from './db/db.js';

const app = createApp({ db: openDb(':memory:') });
const get = (host?: string) => app.request('/api/health', { headers: host ? { host } : undefined });
const write = (method: string, contentType?: string) =>
  app.request('/api/settings', {
    method,
    headers: contentType ? { 'content-type': contentType } : undefined,
    body: '{}',
  });

describe('local-only guard', () => {
  it('allows loopback hosts on any port and a missing host', async () => {
    for (const host of [undefined, 'localhost', 'localhost:5173', '127.0.0.1:8787']) {
      expect((await get(host)).status, String(host)).toBe(200);
    }
  });

  it('rejects other hosts with 403', async () => {
    for (const host of ['evil.example', 'evil.example:8787', 'localhost.evil.example', '10.0.0.5:8787']) {
      expect((await get(host)).status, host).toBe(403);
    }
  });

  it('requires a JSON content type on writes', async () => {
    expect((await write('PUT')).status).toBe(415);
    expect((await write('POST', 'text/plain')).status).toBe(415);
    expect((await write('PUT', 'application/x-www-form-urlencoded')).status).toBe(415);
    expect((await write('PUT', 'application/json')).status).not.toBe(415);
    expect((await write('PUT', 'application/json; charset=utf-8')).status).not.toBe(415);
  });

  it('does not require a content type on reads', async () => {
    expect((await app.request('/api/settings')).status).toBe(200);
  });
});

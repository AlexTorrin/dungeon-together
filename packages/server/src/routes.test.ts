import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from '@colyseus/core';
import { PROFILE_ACTION_PATH, PROFILE_PATH } from '@dt/shared';
import { createServer } from './createServer';
import { ProfileStore } from './ProfileStore';

const PORT = 25780 + Math.floor(Math.random() * 100);
const TOKEN = 'route-test-token-0000';
let server: Server;
let store: ProfileStore;

beforeAll(async () => {
  store = new ProfileStore(join(mkdtempSync(join(tmpdir(), 'dt-')), 'profiles.json'));
  await store.set(TOKEN, { coins: 5, hands: null, backpack: [], chest: [] });
  server = createServer(store);
  await server.listen(PORT);
});
afterAll(async () => {
  await server.gracefullyShutdown(false);
});

const call = (path: string, init: RequestInit = {}, token: string | null = TOKEN) =>
  fetch(`http://localhost:${PORT}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
const act = (action: unknown, token?: string | null) =>
  call(PROFILE_ACTION_PATH, { method: 'POST', body: JSON.stringify(action) }, token);

describe('маршруты лагеря', () => {
  it('профиль по токену; без токена — 401', async () => {
    const res = await call(PROFILE_PATH);
    expect(await res.json()).toMatchObject({ coins: 5 });
    expect((await call(PROFILE_PATH, {}, null)).status).toBe(401);
  });

  it('покупка меняет профиль на сервере; нельзя — 409, мусор — 400', async () => {
    const res = await act({ type: 'buy', item: 'bow' });
    expect(await res.json()).toMatchObject({ coins: 3, backpack: ['bow'] });
    expect(store.get(TOKEN)).toMatchObject({ coins: 3, backpack: ['bow'] });
    expect((await act({ type: 'buy', item: 'sword' })).status).toBe(409);
    expect((await act({ type: 'buy', item: 'laser' })).status).toBe(400);
    expect((await act({ type: 'buy', item: 'bow' }, null)).status).toBe(401);
  });
});

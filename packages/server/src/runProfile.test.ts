import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import type { Server } from '@colyseus/core';
import { ROOM_NAME, parseRoom, type Action, type ServerMessages } from '@dt/shared';
import { createServer } from './createServer';
import { ProfileStore } from './ProfileStore';

// Ключ справа от старта, за ним монета; дверь в верхней стене над монетой.
const ROOM = `
###+#
#@!$#
#####
`;
const PORT = 25890 + Math.floor(Math.random() * 100);
const TOKEN = 'run-profile-token-000';
const PRACTICE_TOKEN = 'practice-token-000000';
let server: Server;
let store: ProfileStore;

beforeAll(async () => {
  store = new ProfileStore(join(mkdtempSync(join(tmpdir(), 'dt-')), 'profiles.json'));
  await store.set(TOKEN, { coins: 1, hands: 'bow', backpack: [], chest: ['wand'] });
  await store.set(PRACTICE_TOKEN, { coins: 5, hands: 'knife', backpack: [], chest: [] });
  server = createServer(store, { level: () => parseRoom(ROOM) });
  await server.listen(PORT);
});
afterAll(async () => {
  await server.gracefullyShutdown(false);
});

function next<K extends keyof ServerMessages>(room: Room, type: K): Promise<ServerMessages[K]> {
  return new Promise((resolve) => {
    const off = room.onMessage(type, (payload: ServerMessages[K]) => {
      off();
      resolve(payload);
    });
  });
}

async function turn(room: Room, plan: Action[]): Promise<ServerMessages['events']> {
  const result = next(room, 'events');
  room.send('command', { type: 'submitPlan', plan });
  return result;
}

describe('забег и профиль на сервере', () => {
  it('снаряжение берётся из профиля, вынесенное через дверь — возвращается', async () => {
    const room = await new Client(`http://localhost:${PORT}`).create(ROOM_NAME, { token: TOKEN });
    await next(room, 'lobby');
    const started = next(room, 'started');
    room.send('start', null);
    expect((await started).state.actors['p1']).toMatchObject({ weapon: { type: 'bow' } });
    expect(store.get(TOKEN)).toEqual({ coins: 1, hands: null, backpack: [], chest: ['wand'] });

    await turn(room, [{ type: 'move', direction: 'right' }]); // ключ
    await turn(room, [{ type: 'openDoor' }, { type: 'move', direction: 'right' }]); // монета
    const { events } = await turn(room, [{ type: 'move', direction: 'up' }]); // в дверь
    expect(events).toContainEqual({ type: 'gameOver', status: 'won' });

    expect(store.get(TOKEN)).toEqual({ coins: 2, hands: 'bow', backpack: [], chest: ['wand'] });
    await room.leave();
  });

  it('своя комната — тренировка: без снаряжения, вынесенное в профиль не попадает', async () => {
    // Сам уровень — из опций создания, а не из подменённого генератора сервера.
    const custom = { name: 'Арена', ascii: ROOM };
    const room = await new Client(`http://localhost:${PORT}`).create(ROOM_NAME, {
      custom,
      token: PRACTICE_TOKEN,
    });
    expect((await next(room, 'lobby')).level).toEqual({ kind: 'custom', name: 'Арена' });
    const started = next(room, 'started');
    room.send('start', null);
    const { state, title } = await started;
    expect(title).toBe('Арена · тренировка');
    expect(state.actors['p1']).toMatchObject({ weapon: null, backpack: [] });

    await turn(room, [{ type: 'move', direction: 'right' }]);
    await turn(room, [{ type: 'openDoor' }, { type: 'move', direction: 'right' }]);
    const { events, state: after } = await turn(room, [{ type: 'move', direction: 'up' }]);
    expect(events).toContainEqual({ type: 'gameOver', status: 'won' });
    expect(after.escaped['p1']).toMatchObject({ coins: 1 });
    expect(store.get(PRACTICE_TOKEN)).toEqual({
      coins: 5,
      hands: 'knife',
      backpack: [],
      chest: [],
    });
    await room.leave();
  });

  it('негодную свою комнату не создать', async () => {
    const create = new Client(`http://localhost:${PORT}`).create(ROOM_NAME, {
      custom: { name: 'Без старта', ascii: '#..#' },
      token: PRACTICE_TOKEN,
    });
    await expect(create).rejects.toThrow();
  });
});

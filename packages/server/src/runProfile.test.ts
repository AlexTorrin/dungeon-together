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
let server: Server;
let store: ProfileStore;

beforeAll(async () => {
  store = new ProfileStore(join(mkdtempSync(join(tmpdir(), 'dt-')), 'profiles.json'));
  await store.set(TOKEN, { coins: 1, hands: 'bow', backpack: [], chest: ['wand'] });
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
});

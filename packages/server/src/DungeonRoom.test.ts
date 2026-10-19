import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import type { Server } from '@colyseus/core';
import { ROOM_NAME, type ServerMessages } from '@dt/shared';
import { createServer } from './createServer';
import { ProfileStore } from './ProfileStore';

// Настоящий сервер на свободном порту и настоящие клиенты SDK: проверяем протокол целиком.
const PORT = 25670 + Math.floor(Math.random() * 100);
let server: Server;
let store: ProfileStore;
const ANYA = 'anya-token-0000000000';
const BORYA = 'borya-token-000000000';

beforeAll(async () => {
  store = new ProfileStore(join(mkdtempSync(join(tmpdir(), 'dt-')), 'profiles.json'));
  await store.set(ANYA, { coins: 3, hands: 'bow', armor: null, backpack: [], chest: ['sword'] });
  server = createServer(store);
  await server.listen(PORT);
});
afterAll(async () => {
  await server.gracefullyShutdown(false);
});

const client = (): Client => new Client(`http://localhost:${PORT}`);

/** Ждёт следующее сообщение типа type. */
function next<K extends keyof ServerMessages>(room: Room, type: K): Promise<ServerMessages[K]> {
  return new Promise((resolve) => {
    const off = room.onMessage(type, (payload: ServerMessages[K]) => {
      off();
      resolve(payload);
    });
  });
}

describe('DungeonRoom', () => {
  it('без токена и с тем же токеном второй раз — не войти', async () => {
    await expect(client().create(ROOM_NAME, { name: 'Аня' })).rejects.toThrow();
    const host = await client().create(ROOM_NAME, { token: ANYA });
    await expect(client().joinById(host.roomId, { token: ANYA })).rejects.toThrow();
    await host.leave();
  });

  it('лобби → старт → ход разрешается, когда планы прислали оба', async () => {
    const host = await client().create(ROOM_NAME, { difficulty: 'easy', name: 'Аня', token: ANYA });
    const hostLobby = await next(host, 'lobby');
    expect(hostLobby).toMatchObject({ code: host.roomId, host: 'p1', you: 'p1' });
    expect(host.roomId).toMatch(/^[A-Z]{4}$/);

    const lobbyAgain = next(host, 'lobby');
    const guest = await client().joinById(host.roomId, { name: 'Боря', token: BORYA });
    const guestLobby = await next(guest, 'lobby');
    expect(guestLobby.you).toBe('p2');
    expect((await lobbyAgain).players.map((p) => p.name)).toEqual(['Аня', 'Боря']);

    // Гость не хост — его «старт» игнорируется; старт хоста получают оба.
    guest.send('start', null);
    const started = Promise.all([next(host, 'started'), next(guest, 'started')]);
    host.send('start', null);
    const [{ state }] = await started;
    expect(state.actors['p1']).toMatchObject({ weapon: { type: 'bow' } });
    expect(state.actors['p2']).toMatchObject({ weapon: null, backpack: [] });
    // Снаряжение забрано из профиля сервером, кошелёк и сундук на месте.
    expect(store.get(ANYA)).toEqual({
      coins: 3,
      hands: null,
      armor: null,
      backpack: [],
      chest: ['sword'],
    });

    // playerId из сообщения сервер не слушает: гость не может походить за хоста.
    const hostSees = next(host, 'events');
    guest.send('command', { type: 'submitPlan', playerId: 'p1', plan: [{ type: 'wait' }] });
    const first = await hostSees;
    expect(first.events).toEqual([{ type: 'planSubmitted', playerId: 'p2', turn: 1 }]);

    const resolved = Promise.all([next(guest, 'events'), next(host, 'events')]);
    host.send('command', { type: 'submitPlan', plan: [{ type: 'wait' }] });
    const [{ events, state: after }] = await resolved;
    expect(events.some((e) => e.type === 'turnResolved')).toBe(true);
    expect(after.turn).toBe(2);

    // Ушедший — покидает уровень, остальные получают playerLeft.
    const left = next(host, 'events');
    await guest.leave();
    expect((await left).events[0]).toMatchObject({ type: 'playerLeft', playerId: 'p2' });
    await host.leave();
  });

  it('обрыв связи: место держится, вернувшийся получает состояние целиком', async () => {
    const host = await client().create(ROOM_NAME, { name: 'Аня', token: ANYA });
    await next(host, 'lobby');
    const guest = await client().joinById(host.roomId, { name: 'Боря', token: BORYA });
    await next(guest, 'lobby');
    const started = Promise.all([next(host, 'started'), next(guest, 'started')]);
    host.send('start', null);
    await started;

    // Код 1000 — не «вышел по согласию» (это 4000): сервер считает это обрывом.
    const offline = next(host, 'playerStatus');
    const token = guest.reconnectionToken;
    guest.connection.close(1000);
    expect(await offline).toEqual({ playerId: 'p2', online: false });

    // Пока его нет, ход ждёт и его тоже.
    const hostPlan = next(host, 'events');
    host.send('command', { type: 'submitPlan', plan: [{ type: 'wait' }] });
    expect((await hostPlan).events.some((e) => e.type === 'turnResolved')).toBe(false);

    const online = next(host, 'playerStatus');
    const back = await client().reconnect(token);
    expect(await online).toEqual({ playerId: 'p2', online: true });
    const lobby = next(back, 'lobby');
    const sync = next(back, 'sync');
    back.send('resync', null);
    expect((await lobby).you).toBe('p2');
    const { state } = await sync;
    expect(state.pendingPlans).toHaveProperty('p1');
    expect(state.actors).toHaveProperty('p2');

    const resolved = next(host, 'events');
    back.send('command', { type: 'submitPlan', plan: [{ type: 'wait' }] });
    expect((await resolved).events.some((e) => e.type === 'turnResolved')).toBe(true);
    await back.leave();
    await host.leave();
  });

  it('после старта в комнату не войти, несуществующий код — ошибка', async () => {
    const host = await client().create(ROOM_NAME, { token: ANYA });
    const started = next(host, 'started');
    host.send('start', null);
    await started;
    await expect(client().joinById(host.roomId, { token: BORYA })).rejects.toThrow();
    await expect(client().joinById('ZZZZ', { token: BORYA })).rejects.toThrow();
    await host.leave();
  });
});

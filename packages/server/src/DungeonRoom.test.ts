import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, type Room } from '@colyseus/sdk';
import type { Server } from '@colyseus/core';
import { ROOM_NAME, type ServerMessages } from '@dt/shared';
import { createServer } from './createServer';

// Настоящий сервер на свободном порту и настоящие клиенты SDK: проверяем протокол целиком.
const PORT = 25670 + Math.floor(Math.random() * 100);
let server: Server;

beforeAll(async () => {
  server = createServer();
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

const loadout = { weapon: 'bow', backpack: ['knife'] };

describe('DungeonRoom', () => {
  it('лобби → старт → ход разрешается, когда планы прислали оба', async () => {
    const host = await client().create(ROOM_NAME, { difficulty: 'easy', name: 'Аня', loadout });
    const hostLobby = await next(host, 'lobby');
    expect(hostLobby).toMatchObject({ code: host.roomId, host: 'p1', you: 'p1' });
    expect(host.roomId).toMatch(/^[A-Z]{4}$/);

    const lobbyAgain = next(host, 'lobby');
    const guest = await client().joinById(host.roomId, { name: 'Боря', loadout: 'мусор' });
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

  it('после старта в комнату не войти, несуществующий код — ошибка', async () => {
    const host = await client().create(ROOM_NAME, {});
    const started = next(host, 'started');
    host.send('start', null);
    await started;
    await expect(client().joinById(host.roomId, {})).rejects.toThrow();
    await expect(client().joinById('ZZZZ', {})).rejects.toThrow();
    await host.leave();
  });
});

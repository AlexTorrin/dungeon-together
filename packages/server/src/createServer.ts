import { Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ROOM_NAME } from '@dt/shared';
import { DungeonRoom } from './DungeonRoom';

/** Сервер с одной комнатой-партией. Отдельно от index.ts — чтобы тесты поднимали свой. */
export function createServer(): Server {
  const server = new Server({ transport: new WebSocketTransport(), greet: false });
  server.define(ROOM_NAME, DungeonRoom);
  return server;
}

import { defineRoom, defineServer, type Server } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { ROOM_NAME, type Difficulty, type Room } from '@dt/shared';
import { DungeonRoom } from './DungeonRoom';
import type { ProfileStore } from './ProfileStore';
import { createRoutes } from './routes';

/**
 * Сервер: комната-партия и HTTP-маршруты лагеря, оба — с одним хранилищем профилей.
 * Отдельно от index.ts — чтобы тесты поднимали свой сервер со своим файлом профилей.
 */
export interface ServerOptions {
  /** Свой уровень вместо сгенерированного — для тестов. */
  readonly level?: (seed: number, difficulty: Difficulty) => Room;
}

export function createServer(profiles: ProfileStore, options: ServerOptions = {}): Server {
  const { level } = options;
  class Dungeon extends DungeonRoom {
    protected override readonly profiles = profiles;
    protected override level(seed: number, difficulty: Difficulty): Room {
      return level ? level(seed, difficulty) : super.level(seed, difficulty);
    }
  }
  return defineServer({
    transport: new WebSocketTransport(),
    greet: false,
    rooms: { [ROOM_NAME]: defineRoom(Dungeon) },
    routes: createRoutes(profiles),
  });
}

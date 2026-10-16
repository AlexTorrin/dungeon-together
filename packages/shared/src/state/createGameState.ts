import { DIRECTIONS, step } from '../direction';
import { isWalkable } from '../map/gameMap';
import type { GameState, Player, PlayerId, Position, Room } from '../types';

/**
 * Ближайшие к старту клетки пола в порядке обхода в ширину (BFS) — первая всегда сам старт.
 * Порядок соседей фиксирован, поэтому расстановка детерминирована.
 */
function nearestFloor(room: Room, count: number): Position[] {
  const result: Position[] = [];
  const seen = new Set([`${room.spawn.x},${room.spawn.y}`]);
  const queue: Position[] = [room.spawn];
  for (let pos = queue.shift(); pos && result.length < count; pos = queue.shift()) {
    result.push(pos);
    for (const direction of DIRECTIONS) {
      const next = step(pos, direction);
      const id = `${next.x},${next.y}`;
      if (!seen.has(id) && isWalkable(room.map, next)) {
        seen.add(id);
        queue.push(next);
      }
    }
  }
  return result;
}

/** Начальное состояние: игроки на старте и ближайших к нему свободных клетках. */
export function createGameState(room: Room, playerIds: readonly PlayerId[]): GameState {
  const positions = nearestFloor(room, playerIds.length);
  if (positions.length < playerIds.length) {
    throw new Error(`Room has room for ${positions.length} players, need ${playerIds.length}`);
  }
  const players: Record<PlayerId, Player> = {};
  playerIds.forEach((id, i) => {
    const pos = positions[i];
    if (pos) players[id] = { id, pos };
  });
  return { map: room.map, players, turn: 1, pendingActions: {} };
}

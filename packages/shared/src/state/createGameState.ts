import { MONSTERS, PLAYER_MAX_HP } from '../config/actors';
import { DIRECTIONS, step } from '../direction';
import { isWalkable } from '../map/gameMap';
import type {
  Actor,
  ActorId,
  GameState,
  GroundItem,
  ItemId,
  PlayerId,
  Position,
  Room,
} from '../types';

const key = ({ x, y }: Position): string => `${x},${y}`;

/**
 * Ближайшие к старту свободные клетки пола в порядке обхода в ширину (BFS).
 * Занятые клетки (монстры) пропускаются, но через них можно пройти дальше.
 * Порядок соседей фиксирован, поэтому расстановка детерминирована.
 */
function nearestFreeFloor(room: Room, occupied: ReadonlySet<string>, count: number): Position[] {
  const result: Position[] = [];
  const seen = new Set([key(room.spawn)]);
  const queue: Position[] = [room.spawn];
  for (let pos = queue.shift(); pos && result.length < count; pos = queue.shift()) {
    if (!occupied.has(key(pos))) result.push(pos);
    for (const direction of DIRECTIONS) {
      const next = step(pos, direction);
      if (!seen.has(key(next)) && isWalkable(room.map, next)) {
        seen.add(key(next));
        queue.push(next);
      }
    }
  }
  return result;
}

/**
 * Начальное состояние: монстры и предметы — там, где их поставил редактор,
 * игроки — на старте и ближайших к нему свободных клетках.
 * id монстров и предметов — порядковые (`monster-1`, `item-1`), поэтому детерминированы.
 */
export function createGameState(room: Room, playerIds: readonly PlayerId[]): GameState {
  const actors: Record<ActorId, Actor> = {};
  room.monsters.forEach(({ species, pos }, i) => {
    const id = `monster-${i + 1}`;
    const { maxHp } = MONSTERS[species];
    actors[id] = { kind: 'monster', id, species, pos, hp: maxHp, maxHp, weapon: null };
  });

  const occupied = new Set(room.monsters.map(({ pos }) => key(pos)));
  const positions = nearestFreeFloor(room, occupied, playerIds.length);
  if (positions.length < playerIds.length) {
    throw new Error(`Room has room for ${positions.length} players, need ${playerIds.length}`);
  }
  playerIds.forEach((id, i) => {
    const pos = positions[i];
    if (!pos) throw new Error(`No position for player ${id}`);
    if (Object.hasOwn(actors, id)) throw new Error(`Duplicate actor id ${id}`);
    actors[id] = { kind: 'player', id, pos, hp: PLAYER_MAX_HP, maxHp: PLAYER_MAX_HP, weapon: null };
  });

  const items: Record<ItemId, GroundItem> = {};
  room.items.forEach(({ type, pos }, i) => {
    const id = `item-${i + 1}`;
    items[id] = { id, type, pos };
  });

  return { map: room.map, actors, items, turn: 1, pendingActions: {}, status: 'playing' };
}

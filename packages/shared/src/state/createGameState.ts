import { MONSTERS, PLAYER_MAX_HP } from '../config/actors';
import { DIRECTIONS, step } from '../direction';
import { withExplored } from '../map/fov';
import { canStep } from '../map/pathfinding';
import { seedRng } from '../rng';
import { allocateId } from './ids';
import { makeItem } from '../items';
import type {
  Actor,
  ActorId,
  GameState,
  GroundItem,
  Item,
  ItemId,
  PlayerId,
  Position,
  Room,
  ItemType,
} from '../types';
import { BACKPACK_SIZE } from '../config/inventory';
import type { Loadout } from '../hub/profile';

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
      if (!seen.has(key(next)) && canStep(room.map, pos, direction)) {
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
 * id монстров и предметов выдаёт счётчик nextId (`monster-1`, `item-2`, …), поэтому
 * одинаковая комната и seed всегда дают одинаковое состояние.
 */
export function createGameState(
  room: Room,
  playerIds: readonly PlayerId[],
  seed: number,
  /** С чем игроки приходят на уровень (из хаба); нет записи — с пустыми руками. */
  loadouts: Readonly<Record<PlayerId, Loadout>> = {},
): GameState {
  let nextId = 1;
  const actors: Record<ActorId, Actor> = {};
  for (const { species, pos, weapon, coins, key: hasKey } of room.monsters) {
    let id: ActorId;
    [id, nextId] = allocateId(nextId, 'monster');
    let item: Item | null = null;
    if (weapon) {
      let itemId: ItemId;
      [itemId, nextId] = allocateId(nextId, 'item');
      item = { id: itemId, type: weapon };
    }
    const { maxHp } = MONSTERS[species];
    actors[id] = {
      kind: 'monster',
      id,
      species,
      pos,
      hp: maxHp,
      maxHp,
      weapon: item,
      armor: null,
      backpack: [],
      coins,
      keys: hasKey ? 1 : 0,
    };
  }

  const occupied = new Set(room.monsters.map(({ pos }) => key(pos)));
  const positions = nearestFreeFloor(room, occupied, playerIds.length);
  if (positions.length < playerIds.length) {
    throw new Error(`Room has room for ${positions.length} players, need ${playerIds.length}`);
  }
  playerIds.forEach((id, i) => {
    const pos = positions[i];
    if (!pos) throw new Error(`No position for player ${id}`);
    if (Object.hasOwn(actors, id)) throw new Error(`Duplicate actor id ${id}`);
    const loadout = Object.hasOwn(loadouts, id) ? loadouts[id] : undefined;
    const newId = (): ItemId => {
      let itemId: ItemId;
      [itemId, nextId] = allocateId(nextId, 'item');
      return itemId;
    };
    const newItem = (type: ItemType): Item => makeItem(newId(), type);
    actors[id] = {
      kind: 'player',
      id,
      pos,
      hp: PLAYER_MAX_HP,
      maxHp: PLAYER_MAX_HP,
      weapon: loadout?.weapon ? { id: newId(), type: loadout.weapon } : null,
      armor: loadout?.armor ? { id: newId(), type: loadout.armor } : null,
      backpack: (loadout?.backpack ?? []).slice(0, BACKPACK_SIZE).map(newItem),
      coins: 0,
      keys: 0,
    };
  });

  const items: Record<ItemId, GroundItem> = {};
  for (const item of room.items) {
    let id: ItemId;
    [id, nextId] = allocateId(nextId, item.kind === 'weapon' ? 'item' : item.kind);
    items[id] = { ...item, id };
  }

  const state: GameState = {
    map: room.map,
    actors,
    items,
    turn: 1,
    pendingPlans: {},
    status: 'playing',
    rng: seedRng(seed),
    nextId,
    explored: room.map.tiles.map(() => false),
    door: room.door ? { pos: room.door, open: false } : null,
    escaped: {},
  };
  return { ...state, explored: withExplored(state) };
}

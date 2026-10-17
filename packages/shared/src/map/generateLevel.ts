import { Map as RotMap, RNG as RotRng } from 'rot-js';
import { DIFFICULTIES, LEVEL, type Difficulty } from '../config/level';
import { WEAPON_TYPES } from '../config/weapons';
import { chance, nextInt, seedRng, type RngState } from '../rng';
import type { GameMap, MonsterSpecies, Position, Room, RoomItem, Tile, WeaponType } from '../types';
import { getTile } from './gameMap';
import { findPath } from './pathfinding';
import { posKey } from './geometry';

interface RoomRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/**
 * Карта генератором Digger из rot.js: комнаты, соединённые коридорами («копатель» прорубает
 * комнату, потом от её стены коридор и следующую комнату — и так, пока не прокопает нужную долю).
 *
 * У rot.js свой генератор случайных чисел — глобальный (ROT.RNG). Засеваем его прямо перед
 * генерацией: вызов синхронный, между setSeed и create никто другой RNG не тронет, поэтому
 * результат детерминирован даже на сервере с несколькими играми.
 */
function digMap(seed: number): { tiles: Tile[]; rooms: RoomRect[] } {
  const { width, height } = LEVEL;
  const tiles: Tile[] = Array.from({ length: width * height }, () => 'wall');
  RotRng.setSeed(seed);
  const digger = new RotMap.Digger(width, height, {
    roomWidth: [...LEVEL.roomWidth],
    roomHeight: [...LEVEL.roomHeight],
    corridorLength: [...LEVEL.corridorLength],
    dugPercentage: LEVEL.dugPercentage,
  });
  digger.create((x, y, value) => {
    if (value === 0) tiles[y * width + x] = 'floor';
  });
  const rooms = digger.getRooms().map((r) => ({
    left: r.getLeft(),
    top: r.getTop(),
    right: r.getRight(),
    bottom: r.getBottom(),
  }));
  return { tiles, rooms };
}

function roomCells({ left, top, right, bottom }: RoomRect): Position[] {
  const cells: Position[] = [];
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) cells.push({ x, y });
  return cells;
}

function pick<T>(items: readonly T[], rng: RngState): readonly [T, RngState] {
  const [i, next] = nextInt(rng, 0, items.length - 1);
  const item = items[i];
  if (item === undefined) throw new Error('pick from empty list');
  return [item, next];
}

/**
 * Где поставить дверь-выход: в верхнюю стену комнаты — снизу пол комнаты, сверху, слева и
 * справа стена (дверь в сплошной стене, ведёт «наружу»). Комнаты перебираются от самой
 * дальней от старта по пути — к выходу надо пройти через уровень. null — места не нашлось.
 */
function placeDoor(
  map: GameMap,
  spawn: Position,
  rooms: readonly RoomRect[],
  rng: RngState,
): readonly [Position | null, RngState] {
  const isWall = (x: number, y: number): boolean => getTile(map, { x, y }) === 'wall';
  const distance = (r: RoomRect): number =>
    findPath(map, spawn, {
      x: Math.floor((r.left + r.right) / 2),
      y: Math.floor((r.top + r.bottom) / 2),
    })?.length ?? -1;
  const byDistance = [...rooms].sort((a, b) => distance(b) - distance(a));
  for (const room of byDistance) {
    const y = room.top - 1;
    const candidates: Position[] = [];
    for (let x = room.left + 1; x < room.right; x++) {
      if (
        isWall(x, y) &&
        !isWall(x, y + 1) &&
        isWall(x, y - 1) &&
        isWall(x - 1, y) &&
        isWall(x + 1, y)
      ) {
        candidates.push({ x, y });
      }
    }
    if (candidates.length > 0) return pick(candidates, rng);
  }
  return [null, rng];
}

/**
 * Случайный уровень заданной сложности (config/level.ts): карта из rot.js, старт — в центре
 * первой комнаты; монстры, оружие и монеты — в остальных комнатах (в стартовой никого нет,
 * чтобы не начинать бой с первого хода). Часть монстров вооружена, часть монет у монстров
 * (выпадут при смерти), ключ от двери-выхода — у случайного монстра.
 * Одинаковые seed и сложность — одинаковый уровень.
 */
export function generateLevel(seed: number, difficulty: Difficulty = 'medium'): Room {
  const config = DIFFICULTIES[difficulty];
  const { tiles, rooms } = digMap(seed);
  const map: GameMap = { width: LEVEL.width, height: LEVEL.height, tiles };
  const [first, ...others] = rooms;
  if (!first || others.length === 0) throw new Error(`Level ${seed}: too few rooms`);

  const spawn = {
    x: Math.floor((first.left + first.right) / 2),
    y: Math.floor((first.top + first.bottom) / 2),
  };

  // Свободные клетки остальных комнат; каждую берём не больше одного раза.
  const taken = new Set<string>([posKey(spawn)]);
  let rng = seedRng(seed);
  const place = (): Position => {
    for (let attempt = 0; attempt < 1000; attempt++) {
      let room: RoomRect;
      let cell: Position;
      [room, rng] = pick(others, rng);
      [cell, rng] = pick(roomCells(room), rng);
      if (!taken.has(posKey(cell))) {
        taken.add(posKey(cell));
        return cell;
      }
    }
    throw new Error(`Level ${seed}: no free cell for a monster or item`);
  };

  // Монстры; первые config.armed — с оружием.
  const monsters: {
    species: MonsterSpecies;
    pos: Position;
    weapon: WeaponType | null;
    coins: number;
    key: boolean;
  }[] = [];
  for (let i = 0; i < config.monsters; i++) {
    let species: MonsterSpecies;
    [species, rng] = pick(config.species, rng);
    let weapon: WeaponType | null = null;
    if (i < config.armed && config.armedWith.length > 0)
      [weapon, rng] = pick(config.armedWith, rng);
    monsters.push({ species, pos: place(), weapon, coins: 0, key: false });
  }

  // Оружие на полу.
  const items: RoomItem[] = [];
  for (let i = 0; i < LEVEL.items; i++) {
    let type: WeaponType;
    [type, rng] = pick(WEAPON_TYPES, rng);
    items.push({ kind: 'weapon', type, pos: place() });
  }

  // Монеты: каждая — кучкой на полу или у случайного монстра (поровну шансов).
  const [total, afterTotal] = nextInt(rng, config.coins[0], config.coins[1]);
  rng = afterTotal;
  for (let i = 0; i < total; i++) {
    let onFloor: boolean;
    [onFloor, rng] = chance(rng, 0.5);
    let carrier: (typeof monsters)[number] | undefined;
    if (!onFloor && monsters.length > 0) [carrier, rng] = pick(monsters, rng);
    if (carrier) carrier.coins += 1;
    else items.push({ kind: 'coins', amount: 1, pos: place() });
  }

  // Дверь-выход и ключ к ней.
  const [door, afterDoor] = placeDoor(map, spawn, others, rng);
  rng = afterDoor;
  if (door && monsters.length > 0) {
    let keeper: (typeof monsters)[number];
    [keeper, rng] = pick(monsters, rng);
    keeper.key = true;
  }

  return { map, spawn, monsters, items, door };
}

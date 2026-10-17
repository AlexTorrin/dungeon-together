import { Map as RotMap, RNG as RotRng } from 'rot-js';
import { MONSTER_SPECIES } from '../config/actors';
import { LEVEL } from '../config/level';
import { WEAPON_TYPES } from '../config/weapons';
import { nextInt, seedRng, type RngState } from '../rng';
import type {
  MonsterSpecies,
  Position,
  Room,
  RoomItem,
  RoomMonster,
  Tile,
  WeaponType,
} from '../types';
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
 * Случайный уровень: карта из rot.js, старт — в центре первой комнаты, монстры и оружие —
 * в остальных комнатах (в стартовой никого нет, чтобы не начинать бой с первого хода).
 * Одинаковый seed — одинаковый уровень.
 */
export function generateLevel(seed: number): Room {
  const { tiles, rooms } = digMap(seed);
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

  const monsters: RoomMonster[] = [];
  for (let i = 0; i < LEVEL.monsters; i++) {
    let species: MonsterSpecies;
    [species, rng] = pick(MONSTER_SPECIES, rng);
    monsters.push({ species, pos: place() });
  }
  const items: RoomItem[] = [];
  for (let i = 0; i < LEVEL.items; i++) {
    let type: WeaponType;
    [type, rng] = pick(WEAPON_TYPES, rng);
    items.push({ type, pos: place() });
  }

  return { map: { width: LEVEL.width, height: LEVEL.height, tiles }, spawn, monsters, items };
}

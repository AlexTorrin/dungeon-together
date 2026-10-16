import type { GameMap, Position, Room } from '../types';
import { getTile, isInBounds, isWalkable, setTile } from './gameMap';
import { parseAsciiMap } from './parseAsciiMap';

const SPAWN_CHAR = '@';

/** ASCII-комната: как parseAsciiMap, плюс ровно один '@' — точка старта (на полу). */
export function parseRoom(ascii: string): Room {
  const rows = ascii.split('\n').filter((row) => row.trim().length > 0);
  const spawns: Position[] = [];
  rows.forEach((row, y) => {
    for (let x = row.indexOf(SPAWN_CHAR); x !== -1; x = row.indexOf(SPAWN_CHAR, x + 1)) {
      spawns.push({ x, y });
    }
  });
  const [spawn, ...extra] = spawns;
  if (!spawn || extra.length > 0) {
    throw new Error(`Room must have exactly one '${SPAWN_CHAR}', found ${spawns.length}`);
  }
  const map = parseAsciiMap(rows.join('\n').replaceAll(SPAWN_CHAR, '.'));
  return { map, spawn };
}

export function serializeMap(map: GameMap): string {
  const rows: string[] = [];
  for (let y = 0; y < map.height; y++) {
    let row = '';
    for (let x = 0; x < map.width; x++) row += getTile(map, { x, y }) === 'floor' ? '.' : '#';
    rows.push(row);
  }
  return rows.join('\n');
}

export function serializeRoom({ map, spawn }: Room): string {
  return serializeMap(map)
    .split('\n')
    .map((row, y) =>
      y === spawn.y ? row.slice(0, spawn.x) + SPAWN_CHAR + row.slice(spawn.x + 1) : row,
    )
    .join('\n');
}

/** Пустая комната: стены по периметру, пол внутри, старт в центре. */
export function createEmptyRoom(width: number, height: number): Room {
  const tiles = Array.from({ length: width * height }, (_, i) => {
    const x = i % width;
    const y = Math.floor(i / width);
    const border = x === 0 || y === 0 || x === width - 1 || y === height - 1;
    return border ? ('wall' as const) : ('floor' as const);
  });
  return {
    map: { width, height, tiles },
    spawn: { x: Math.floor(width / 2), y: Math.floor(height / 2) },
  };
}

/** Комната пригодна для игры, если старт внутри карты и на полу. */
export function isRoomPlayable({ map, spawn }: Room): boolean {
  return isInBounds(map, spawn) && isWalkable(map, spawn);
}

/** Ставит точку старта и гарантирует, что под ней пол. */
export function setRoomSpawn(room: Room, spawn: Position): Room {
  if (!isInBounds(room.map, spawn)) return room;
  return { map: setTile(room.map, spawn, 'floor'), spawn };
}

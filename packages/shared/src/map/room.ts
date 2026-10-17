import type {
  GameMap,
  MonsterSpecies,
  Position,
  Room,
  RoomItem,
  RoomMonster,
  Tile,
  WeaponType,
} from '../types';
import { MONSTER_SPECIES } from '../config/actors';
import { WEAPON_TYPES } from '../config/weapons';
import { samePos } from './geometry';
import { getTile, isInBounds, isWalkable, resizeMap, setTile } from './gameMap';
import { parseAsciiMap } from './parseAsciiMap';

const SPAWN_CHAR = '@';

/** Что стоит в клетке комнаты помимо тайла. В клетке — не больше одной такой вещи. */
export type RoomEntity =
  | { readonly kind: 'monster'; readonly species: MonsterSpecies }
  | { readonly kind: 'item'; readonly type: WeaponType };

/** Символы монстров и предметов в ASCII-формате. Под ними всегда пол. */
const MONSTER_CHARS: Readonly<Record<MonsterSpecies, string>> = {
  skeleton: 'S',
  skull: 'K',
  vampire: 'V',
};
const ITEM_CHARS: Readonly<Record<WeaponType, string>> = { melee: 'm', ranged: 'r' };

const ENTITY_CHARS: ReadonlyMap<string, RoomEntity> = new Map<string, RoomEntity>([
  ...MONSTER_SPECIES.map((species): [string, RoomEntity] => [
    MONSTER_CHARS[species],
    { kind: 'monster', species },
  ]),
  ...WEAPON_TYPES.map((type): [string, RoomEntity] => [ITEM_CHARS[type], { kind: 'item', type }]),
]);

/**
 * ASCII-комната: как parseAsciiMap, плюс ровно один '@' — точка старта, и расстановка:
 * S — скелет, K — череп, V — вампир, m — ближнее оружие, r — дальнее. Под ними пол.
 */
export function parseRoom(ascii: string): Room {
  const rows = ascii.split('\n').filter((row) => row.trim().length > 0);
  const spawns: Position[] = [];
  const monsters: RoomMonster[] = [];
  const items: RoomItem[] = [];
  const cleaned = rows.map((row, y) =>
    [...row]
      .map((char, x) => {
        const pos = { x, y };
        if (char === SPAWN_CHAR) spawns.push(pos);
        const entity = ENTITY_CHARS.get(char);
        if (entity?.kind === 'monster') monsters.push({ species: entity.species, pos });
        if (entity?.kind === 'item') items.push({ type: entity.type, pos });
        return char === SPAWN_CHAR || entity ? '.' : char;
      })
      .join(''),
  );
  const [spawn, ...extra] = spawns;
  if (!spawn || extra.length > 0) {
    throw new Error(`Room must have exactly one '${SPAWN_CHAR}', found ${spawns.length}`);
  }
  return { map: parseAsciiMap(cleaned.join('\n')), spawn, monsters, items };
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

export function serializeRoom({ map, spawn, monsters, items }: Room): string {
  const rows = serializeMap(map)
    .split('\n')
    .map((row) => [...row]);
  const put = ({ x, y }: Position, char: string): void => {
    const row = rows[y];
    if (row && x < row.length) row[x] = char;
  };
  for (const { species, pos } of monsters) put(pos, MONSTER_CHARS[species]);
  for (const { type, pos } of items) put(pos, ITEM_CHARS[type]);
  put(spawn, SPAWN_CHAR);
  return rows.map((row) => row.join('')).join('\n');
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
    monsters: [],
    items: [],
  };
}

/** Комната пригодна для игры, если старт внутри карты и на полу. */
export function isRoomPlayable({ map, spawn }: Room): boolean {
  return isInBounds(map, spawn) && isWalkable(map, spawn);
}

/** Ставит точку старта и гарантирует, что под ней пол. */
export function setRoomSpawn(room: Room, spawn: Position): Room {
  if (!isInBounds(room.map, spawn)) return room;
  return { ...setRoomEntity(room, spawn, null), map: setTile(room.map, spawn, 'floor'), spawn };
}

/** Меняет размер комнаты: старт прижимается к границе, монстры и предметы за ней пропадают. */
export function resizeRoom(room: Room, width: number, height: number): Room {
  const map = resizeMap(room.map, width, height);
  const inside = ({ pos }: { readonly pos: Position }): boolean => isInBounds(map, pos);
  const spawn = { x: Math.min(room.spawn.x, width - 1), y: Math.min(room.spawn.y, height - 1) };
  return setRoomSpawn(
    { map, spawn, monsters: room.monsters.filter(inside), items: room.items.filter(inside) },
    spawn,
  );
}

/** Что стоит в клетке (монстр или предмет), или null. */
export function roomEntityAt(room: Room, pos: Position): RoomEntity | null {
  const monster = room.monsters.find((m) => samePos(m.pos, pos));
  if (monster) return { kind: 'monster', species: monster.species };
  const item = room.items.find((i) => samePos(i.pos, pos));
  return item ? { kind: 'item', type: item.type } : null;
}

/**
 * Ставит в клетку монстра или предмет (null — убирает). Под ним становится пол;
 * на точку старта и за пределы карты ничего не ставится.
 */
export function setRoomEntity(room: Room, pos: Position, entity: RoomEntity | null): Room {
  if (!isInBounds(room.map, pos) || (entity && samePos(pos, room.spawn))) return room;
  const monsters = room.monsters.filter((m) => !samePos(m.pos, pos));
  const items = room.items.filter((i) => !samePos(i.pos, pos));
  if (!entity) return { ...room, monsters, items };
  const map = setTile(room.map, pos, 'floor');
  if (entity.kind === 'monster') {
    return { ...room, map, monsters: [...monsters, { species: entity.species, pos }], items };
  }
  return { ...room, map, monsters, items: [...items, { type: entity.type, pos }] };
}

/** Меняет тайл. Стена убирает то, что стояло в клетке; на точку старта стену не ставит. */
export function setRoomTile(room: Room, pos: Position, tile: Tile): Room {
  if (!isInBounds(room.map, pos)) return room;
  if (tile === 'floor') return { ...room, map: setTile(room.map, pos, 'floor') };
  if (samePos(pos, room.spawn)) return room;
  return { ...setRoomEntity(room, pos, null), map: setTile(room.map, pos, 'wall') };
}

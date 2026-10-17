import type {
  GameMap,
  Loot,
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
/** Дверь-выход: в карте это стена, пока её не откроют ключом. */
const DOOR_CHAR = '+';
const COINS_CHAR = '$'; // кучка из одной монеты
const KEY_CHAR = '!';
const POTION_CHAR = 'p';

/** Что стоит в клетке комнаты помимо тайла. В клетке — не больше одной такой вещи. */
export type RoomEntity =
  | { readonly kind: 'monster'; readonly species: MonsterSpecies }
  | { readonly kind: 'item'; readonly item: Loot };

/** Символы монстров и предметов в ASCII-формате. Под ними всегда пол. */
const MONSTER_CHARS: Readonly<Record<MonsterSpecies, string>> = {
  skeleton: 'S',
  skull: 'K',
  vampire: 'V',
};
/** m и r — исторически «ближнее»/«дальнее»: сохранённые комнаты остаются читаемыми. */
const ITEM_CHARS: Readonly<Record<WeaponType, string>> = {
  knife: 'm',
  bow: 'r',
  sword: 's',
  wand: 'w',
};

const ENTITY_CHARS: ReadonlyMap<string, RoomEntity> = new Map<string, RoomEntity>([
  ...MONSTER_SPECIES.map((species): [string, RoomEntity] => [
    MONSTER_CHARS[species],
    { kind: 'monster', species },
  ]),
  ...WEAPON_TYPES.map((type): [string, RoomEntity] => [
    ITEM_CHARS[type],
    { kind: 'item', item: { kind: 'weapon', type } },
  ]),
  [COINS_CHAR, { kind: 'item', item: { kind: 'coins', amount: 1 } }],
  [KEY_CHAR, { kind: 'item', item: { kind: 'key' } }],
  [POTION_CHAR, { kind: 'item', item: { kind: 'potion' } }],
]);

/** Вещь без координат (RoomItem и GroundItem несут ещё pos/id). */
export function lootOf(item: Loot): Loot {
  switch (item.kind) {
    case 'weapon':
      return { kind: 'weapon', type: item.type };
    case 'potion':
      return { kind: 'potion' };
    case 'coins':
      return { kind: 'coins', amount: item.amount };
    case 'key':
      return { kind: 'key' };
  }
}

function lootChar(item: Loot): string {
  switch (item.kind) {
    case 'weapon':
      return ITEM_CHARS[item.type];
    case 'potion':
      return POTION_CHAR;
    case 'coins':
      return COINS_CHAR;
    case 'key':
      return KEY_CHAR;
  }
}

/** Монстр из редактора: ничего не несёт (оружие и добычу монстрам раздаёт генератор). */
const bareMonster = (species: MonsterSpecies, pos: Position): RoomMonster => ({
  species,
  pos,
  weapon: null,
  coins: 0,
  key: false,
});

/**
 * ASCII-комната: как parseAsciiMap, плюс ровно один '@' — точка старта, и расстановка:
 * S — скелет, K — череп, V — вампир; оружие: m — нож, r — лук, s — меч, w — палочка;
 * $ — монета, ! — ключ, p — баночка лечения (под ними пол); + — дверь-выход в стене (не больше одной).
 */
export function parseRoom(ascii: string): Room {
  const rows = ascii.split('\n').filter((row) => row.trim().length > 0);
  const spawns: Position[] = [];
  const monsters: RoomMonster[] = [];
  const items: RoomItem[] = [];
  const doors: Position[] = [];
  const cleaned = rows.map((row, y) =>
    [...row]
      .map((char, x) => {
        const pos = { x, y };
        if (char === SPAWN_CHAR) spawns.push(pos);
        if (char === DOOR_CHAR) {
          doors.push(pos);
          return '#';
        }
        const entity = ENTITY_CHARS.get(char);
        if (entity?.kind === 'monster') monsters.push(bareMonster(entity.species, pos));
        if (entity?.kind === 'item') items.push({ ...entity.item, pos });
        return char === SPAWN_CHAR || entity ? '.' : char;
      })
      .join(''),
  );
  const [spawn, ...extra] = spawns;
  if (!spawn || extra.length > 0) {
    throw new Error(`Room must have exactly one '${SPAWN_CHAR}', found ${spawns.length}`);
  }
  if (doors.length > 1) throw new Error(`Room can have at most one '${DOOR_CHAR}'`);
  return { map: parseAsciiMap(cleaned.join('\n')), spawn, monsters, items, door: doors[0] ?? null };
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

export function serializeRoom({ map, spawn, monsters, items, door }: Room): string {
  const rows = serializeMap(map)
    .split('\n')
    .map((row) => [...row]);
  const put = ({ x, y }: Position, char: string): void => {
    const row = rows[y];
    if (row && x < row.length) row[x] = char;
  };
  for (const { species, pos } of monsters) put(pos, MONSTER_CHARS[species]);
  for (const item of items) put(item.pos, lootChar(item));
  if (door) put(door, DOOR_CHAR);
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
    door: null,
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
  const door = room.door && isInBounds(map, room.door) ? room.door : null;
  return setRoomSpawn(
    { map, spawn, monsters: room.monsters.filter(inside), items: room.items.filter(inside), door },
    spawn,
  );
}

/** Что стоит в клетке (монстр или предмет), или null. */
export function roomEntityAt(room: Room, pos: Position): RoomEntity | null {
  const monster = room.monsters.find((m) => samePos(m.pos, pos));
  if (monster) return { kind: 'monster', species: monster.species };
  const found = room.items.find((i) => samePos(i.pos, pos));
  if (!found) return null;
  return { kind: 'item', item: lootOf(found) };
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
  const door = room.door && samePos(room.door, pos) ? null : room.door;
  if (entity.kind === 'monster') {
    return { ...room, map, door, monsters: [...monsters, bareMonster(entity.species, pos)], items };
  }
  return { ...room, map, door, monsters, items: [...items, { ...entity.item, pos }] };
}

/**
 * Ставит дверь-выход (в комнате она одна — старая убирается). Под дверью — стена: пока дверь
 * закрыта, это стена; на точку старта не ставится. null — убрать дверь.
 */
export function setRoomDoor(room: Room, pos: Position | null): Room {
  if (!pos) return { ...room, door: null };
  if (!isInBounds(room.map, pos) || samePos(pos, room.spawn)) return room;
  const cleared = setRoomEntity(room, pos, null);
  return { ...cleared, map: setTile(cleared.map, pos, 'wall'), door: pos };
}

/** Меняет тайл. Стена убирает то, что стояло в клетке; на точку старта стену не ставит. */
export function setRoomTile(room: Room, pos: Position, tile: Tile): Room {
  if (!isInBounds(room.map, pos)) return room;
  if (tile === 'floor') {
    const door = room.door && samePos(room.door, pos) ? null : room.door; // пол на месте двери — двери нет
    return { ...room, door, map: setTile(room.map, pos, 'floor') };
  }
  if (samePos(pos, room.spawn)) return room;
  return { ...setRoomEntity(room, pos, null), map: setTile(room.map, pos, 'wall') };
}

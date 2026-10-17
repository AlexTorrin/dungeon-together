import { describe, expect, it } from 'vitest';
import { getTile } from './gameMap';
import {
  createEmptyRoom,
  isRoomPlayable,
  parseRoom,
  resizeRoom,
  roomEntityAt,
  serializeRoom,
  setRoomDoor,
  setRoomEntity,
  setRoomSpawn,
  setRoomTile,
} from './room';

describe('parseRoom', () => {
  it('finds spawn and turns it into floor', () => {
    const room = parseRoom(`
####
#.@#
####
`);
    expect(room.spawn).toEqual({ x: 2, y: 1 });
    expect(getTile(room.map, room.spawn)).toBe('floor');
  });

  it('requires exactly one spawn', () => {
    expect(() => parseRoom('#..#')).toThrow(/exactly one/);
    expect(() => parseRoom('#@@#')).toThrow(/exactly one/);
  });
});

describe('serializeRoom', () => {
  it('round-trips through parseRoom', () => {
    const ascii = ['#####', '#.@.#', '#...#', '#####'].join('\n');
    expect(serializeRoom(parseRoom(ascii))).toBe(ascii);
  });

  it('round-trips monsters, items, coins, key and the door', () => {
    const ascii = ['###+###', '#S@.mr#', '#K$!.V#', '#######'].join('\n');
    const room = parseRoom(ascii);
    expect(room.monsters).toEqual([
      { species: 'skeleton', pos: { x: 1, y: 1 }, weapon: null, coins: 0, key: false },
      { species: 'skull', pos: { x: 1, y: 2 }, weapon: null, coins: 0, key: false },
      { species: 'vampire', pos: { x: 5, y: 2 }, weapon: null, coins: 0, key: false },
    ]);
    expect(room.items).toEqual([
      { kind: 'weapon', type: 'knife', pos: { x: 4, y: 1 } },
      { kind: 'weapon', type: 'bow', pos: { x: 5, y: 1 } },
      { kind: 'coins', amount: 1, pos: { x: 2, y: 2 } },
      { kind: 'key', pos: { x: 3, y: 2 } },
    ]);
    expect(room.door).toEqual({ x: 3, y: 0 });
    expect(getTile(room.map, { x: 3, y: 0 })).toBe('wall'); // закрытая дверь — стена
    expect(getTile(room.map, { x: 1, y: 1 })).toBe('floor');
    expect(serializeRoom(room)).toBe(ascii);
  });

  it('allows at most one door', () => {
    expect(() => parseRoom('#+@+#')).toThrow(/at most one/);
  });
});

describe('setRoomEntity / setRoomTile', () => {
  const room = createEmptyRoom(6, 5); // старт в (3,2)

  it('places one thing per cell, replacing the previous one', () => {
    let next = setRoomEntity(
      room,
      { x: 1, y: 1 },
      { kind: 'item', item: { kind: 'weapon', type: 'bow' } },
    );
    next = setRoomEntity(next, { x: 1, y: 1 }, { kind: 'monster', species: 'vampire' });
    expect(roomEntityAt(next, { x: 1, y: 1 })).toEqual({ kind: 'monster', species: 'vampire' });
    expect(next.items).toEqual([]);
  });

  it('puts floor under a placed thing and never places on spawn', () => {
    const onWall = setRoomEntity(room, { x: 0, y: 0 }, { kind: 'monster', species: 'skull' });
    expect(getTile(onWall.map, { x: 0, y: 0 })).toBe('floor');
    expect(
      setRoomEntity(room, room.spawn, { kind: 'item', item: { kind: 'weapon', type: 'knife' } }),
    ).toBe(room);
  });

  it('a wall removes what stood in the cell; spawn stays floor', () => {
    const placed = setRoomEntity(room, { x: 1, y: 1 }, { kind: 'monster', species: 'skull' });
    const walled = setRoomTile(placed, { x: 1, y: 1 }, 'wall');
    expect(walled.monsters).toEqual([]);
    expect(getTile(walled.map, { x: 1, y: 1 })).toBe('wall');
    expect(setRoomTile(room, room.spawn, 'wall')).toBe(room);
  });

  it('moving spawn onto a monster removes the monster', () => {
    const placed = setRoomEntity(room, { x: 1, y: 1 }, { kind: 'monster', species: 'skull' });
    expect(setRoomSpawn(placed, { x: 1, y: 1 }).monsters).toEqual([]);
  });
});

describe('createEmptyRoom', () => {
  it('has walls on the border, floor inside and a playable spawn', () => {
    const room = createEmptyRoom(5, 4);
    expect(serializeRoom(room)).toBe(['#####', '#...#', '#.@.#', '#####'].join('\n'));
    expect(isRoomPlayable(room)).toBe(true);
  });
});

describe('setRoomSpawn', () => {
  it('moves spawn and forces floor under it', () => {
    const room = setRoomSpawn(createEmptyRoom(5, 4), { x: 0, y: 0 });
    expect(room.spawn).toEqual({ x: 0, y: 0 });
    expect(getTile(room.map, room.spawn)).toBe('floor');
  });

  it('ignores positions outside the map', () => {
    const room = createEmptyRoom(5, 4);
    expect(setRoomSpawn(room, { x: 9, y: 9 })).toBe(room);
  });
});

describe('setRoomDoor', () => {
  it('puts a single door into a wall, replacing the previous one; floor removes it', () => {
    const room = setRoomDoor(setRoomDoor(createEmptyRoom(6, 5), { x: 1, y: 0 }), { x: 4, y: 0 });
    expect(room.door).toEqual({ x: 4, y: 0 });
    expect(getTile(room.map, { x: 4, y: 0 })).toBe('wall');
    expect(setRoomTile(room, { x: 4, y: 0 }, 'floor').door).toBeNull();
  });
});

describe('resizeRoom', () => {
  it('clamps spawn to the new size and keeps floor under it', () => {
    const room = resizeRoom(setRoomSpawn(createEmptyRoom(6, 6), { x: 4, y: 4 }), 3, 3);
    expect(room.spawn).toEqual({ x: 2, y: 2 });
    expect(getTile(room.map, room.spawn)).toBe('floor');
  });

  it('drops monsters and items that end up outside the map', () => {
    const room = {
      ...createEmptyRoom(6, 6),
      monsters: [
        { species: 'skull' as const, pos: { x: 1, y: 1 }, weapon: null, coins: 0, key: false },
        { species: 'vampire' as const, pos: { x: 5, y: 5 }, weapon: null, coins: 0, key: false },
      ],
      items: [{ kind: 'weapon' as const, type: 'bow' as const, pos: { x: 4, y: 1 } }],
    };
    const resized = resizeRoom(room, 4, 4);
    expect(resized.monsters).toEqual([
      { species: 'skull', pos: { x: 1, y: 1 }, weapon: null, coins: 0, key: false },
    ]);
    expect(resized.items).toEqual([]);
  });
});

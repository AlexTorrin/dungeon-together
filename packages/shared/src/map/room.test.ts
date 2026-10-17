import { describe, expect, it } from 'vitest';
import { getTile } from './gameMap';
import {
  createEmptyRoom,
  isRoomPlayable,
  parseRoom,
  resizeRoom,
  serializeRoom,
  setRoomSpawn,
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
        { species: 'skull' as const, pos: { x: 1, y: 1 } },
        { species: 'vampire' as const, pos: { x: 5, y: 5 } },
      ],
      items: [{ type: 'darts' as const, pos: { x: 4, y: 1 } }],
    };
    const resized = resizeRoom(room, 4, 4);
    expect(resized.monsters).toEqual([{ species: 'skull', pos: { x: 1, y: 1 } }]);
    expect(resized.items).toEqual([]);
  });
});

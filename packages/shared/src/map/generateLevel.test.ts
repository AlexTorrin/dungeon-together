import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, DIFFICULTY_LIST, LEVEL } from '../config/level';
import { createGameState } from '../state/createGameState';
import { getTile, isWalkable } from './gameMap';
import { generateLevel } from './generateLevel';
import { posKey } from './geometry';
import { findPath } from './pathfinding';
import type { Position, Room } from '../types';

const SEEDS = [1, 42, 1234, 99999, 2 ** 31];

function floorCells(room: Room): Position[] {
  const cells: Position[] = [];
  for (let y = 0; y < room.map.height; y++) {
    for (let x = 0; x < room.map.width; x++) {
      if (getTile(room.map, { x, y }) === 'floor') cells.push({ x, y });
    }
  }
  return cells;
}

describe('generateLevel', () => {
  it('is deterministic: the same seed gives the same level', () => {
    expect(generateLevel(7)).toEqual(generateLevel(7));
  });

  it('different seeds give different levels', () => {
    expect(generateLevel(1).map.tiles).not.toEqual(generateLevel(2).map.tiles);
  });

  it.each(SEEDS)('seed %i: playable map with walls on the border', (seed) => {
    const room = generateLevel(seed);
    expect(room.map.width).toBe(LEVEL.width);
    expect(room.map.height).toBe(LEVEL.height);
    expect(isWalkable(room.map, room.spawn)).toBe(true);
    for (let x = 0; x < LEVEL.width; x++) {
      expect(getTile(room.map, { x, y: 0 })).toBe('wall');
      expect(getTile(room.map, { x, y: LEVEL.height - 1 })).toBe('wall');
    }
    for (let y = 0; y < LEVEL.height; y++) {
      expect(getTile(room.map, { x: 0, y })).toBe('wall');
      expect(getTile(room.map, { x: LEVEL.width - 1, y })).toBe('wall');
    }
  });

  it.each(SEEDS)('seed %i: every floor cell is reachable from spawn', (seed) => {
    const room = generateLevel(seed);
    for (const cell of floorCells(room)) {
      expect(findPath(room.map, room.spawn, cell), posKey(cell)).not.toBeNull();
    }
  });

  it.each(SEEDS)('seed %i: monsters and items on distinct floor cells, none at spawn', (seed) => {
    const room = generateLevel(seed);
    expect(room.monsters).toHaveLength(DIFFICULTIES.medium.monsters);
    expect(room.items.filter((i) => i.kind === 'weapon')).toHaveLength(LEVEL.items);
    const cells = [...room.monsters, ...room.items].map((e) => e.pos);
    for (const cell of cells) expect(isWalkable(room.map, cell)).toBe(true);
    const keys = cells.map(posKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).not.toContain(posKey(room.spawn));
  });

  it('keeps monsters out of reach of the first turn', () => {
    for (const seed of SEEDS) {
      const room = generateLevel(seed);
      for (const { pos } of room.monsters) {
        const path = findPath(room.map, room.spawn, pos);
        expect(path?.length ?? Infinity).toBeGreaterThan(2);
      }
    }
  });

  it('works with createGameState', () => {
    const state = createGameState(generateLevel(5), ['p1', 'p2'], 5);
    expect(Object.values(state.actors).filter((a) => a.kind === 'monster')).toHaveLength(
      DIFFICULTIES.medium.monsters,
    );
  });

  it.each(DIFFICULTY_LIST)(
    'difficulty %s: monsters, armed monsters and coins as configured',
    (difficulty) => {
      const config = DIFFICULTIES[difficulty];
      for (const seed of SEEDS) {
        const room = generateLevel(seed, difficulty);
        expect(room.monsters).toHaveLength(config.monsters);
        for (const m of room.monsters) expect(config.species).toContain(m.species);
        expect(room.monsters.filter((m) => m.weapon)).toHaveLength(config.armed);
        const coins =
          room.monsters.reduce((sum, m) => sum + m.coins, 0) +
          room.items.reduce((sum, i) => sum + (i.kind === 'coins' ? i.amount : 0), 0);
        expect(coins).toBeGreaterThanOrEqual(config.coins[0]);
        expect(coins).toBeLessThanOrEqual(config.coins[1]);
      }
    },
  );

  it.each(SEEDS)(
    'seed %i: the exit door is in a wall next to reachable floor, one monster has the key',
    (seed) => {
      const room = generateLevel(seed);
      expect(room.door).not.toBeNull();
      if (!room.door) return;
      expect(getTile(room.map, room.door)).toBe('wall');
      const below = { x: room.door.x, y: room.door.y + 1 };
      expect(getTile(room.map, below)).toBe('floor');
      expect(findPath(room.map, room.spawn, below)).not.toBeNull();
      expect(room.monsters.filter((m) => m.key)).toHaveLength(1);
    },
  );
});

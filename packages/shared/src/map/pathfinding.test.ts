import { describe, expect, it } from 'vitest';
import { parseAsciiMap } from './parseAsciiMap';
import { canStep, findPath } from './pathfinding';

const map = parseAsciiMap(
  [
    '#######', //
    '#.....#',
    '#.#...#',
    '#.....#',
    '#######',
  ].join('\n'),
);

describe('canStep', () => {
  it('allows diagonal steps in the open', () => {
    expect(canStep(map, { x: 3, y: 1 }, 'downRight')).toBe(true);
  });

  it('forbids cutting a wall corner diagonally', () => {
    expect(canStep(map, { x: 1, y: 1 }, 'downRight')).toBe(false); // (2,2) — стена
    expect(canStep(map, { x: 3, y: 3 }, 'upLeft')).toBe(false); // (2,2) — стена
    expect(canStep(map, { x: 1, y: 2 }, 'downRight')).toBe(false); // угол (2,2)
  });

  it('forbids stepping into walls', () => {
    expect(canStep(map, { x: 1, y: 1 }, 'up')).toBe(false);
  });
});

describe('findPath', () => {
  it('uses diagonals for the shortest path', () => {
    expect(findPath(map, { x: 3, y: 1 }, { x: 5, y: 3 })).toEqual([
      { x: 4, y: 2 },
      { x: 5, y: 3 },
    ]);
  });

  it('goes around walls without cutting corners', () => {
    const path = findPath(map, { x: 1, y: 1 }, { x: 3, y: 3 });
    expect(path?.at(-1)).toEqual({ x: 3, y: 3 });
    expect(path).not.toContainEqual({ x: 2, y: 2 });
    // По прямой (Чебышёв) — 2 шага, но обе диагонали мимо стены срезали бы угол.
    expect(path).toHaveLength(4);
  });

  it('returns [] for the same cell and null for walls or too far', () => {
    expect(findPath(map, { x: 1, y: 1 }, { x: 1, y: 1 })).toEqual([]);
    expect(findPath(map, { x: 1, y: 1 }, { x: 2, y: 2 })).toBeNull();
    expect(findPath(map, { x: 1, y: 1 }, { x: 5, y: 3 }, 3)).toBeNull();
    expect(findPath(map, { x: 1, y: 1 }, { x: 5, y: 3 }, 4)).toHaveLength(4);
  });
});

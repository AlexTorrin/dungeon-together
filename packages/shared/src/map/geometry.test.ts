import { describe, expect, it } from 'vitest';
import { chebyshev, hasLineOfSight, lineCells } from './geometry';
import { parseAsciiMap } from './parseAsciiMap';

describe('chebyshev', () => {
  it('counts diagonal steps as one', () => {
    expect(chebyshev({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(3);
    expect(chebyshev({ x: 0, y: 0 }, { x: 4, y: 1 })).toBe(4);
    expect(chebyshev({ x: 2, y: 2 }, { x: 2, y: 2 })).toBe(0);
  });
});

describe('lineCells', () => {
  it('includes both ends and steps one cell at a time', () => {
    const cells = lineCells({ x: 0, y: 0 }, { x: 4, y: 2 });
    expect(cells[0]).toEqual({ x: 0, y: 0 });
    expect(cells.at(-1)).toEqual({ x: 4, y: 2 });
    expect(cells).toHaveLength(5);
  });
});

describe('hasLineOfSight', () => {
  const map = parseAsciiMap(['.....', '..#..', '.....'].join('\n'));

  it('is blocked by a wall between the cells', () => {
    expect(hasLineOfSight(map, { x: 0, y: 1 }, { x: 4, y: 1 })).toBe(false);
  });

  it('passes around the wall and between adjacent cells', () => {
    expect(hasLineOfSight(map, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(true);
    expect(hasLineOfSight(map, { x: 1, y: 1 }, { x: 2, y: 2 })).toBe(true);
  });
});

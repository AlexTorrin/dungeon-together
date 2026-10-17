import type { Direction, Position } from './types';

export const DIRECTIONS: readonly Direction[] = [
  'up',
  'down',
  'left',
  'right',
  'upLeft',
  'upRight',
  'downLeft',
  'downRight',
];

const DELTA: Readonly<Record<Direction, Position>> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  upLeft: { x: -1, y: -1 },
  upRight: { x: 1, y: -1 },
  downLeft: { x: -1, y: 1 },
  downRight: { x: 1, y: 1 },
};

export function delta(direction: Direction): Position {
  return DELTA[direction];
}

export function step(pos: Position, direction: Direction): Position {
  const d = DELTA[direction];
  return { x: pos.x + d.x, y: pos.y + d.y };
}

export function isDiagonal(direction: Direction): boolean {
  const d = DELTA[direction];
  return d.x !== 0 && d.y !== 0;
}

/** Направление шага с from на соседнюю (в т.ч. по диагонали) клетку to; null — не соседние. */
export function directionTo(from: Position, to: Position): Direction | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return DIRECTIONS.find((d) => DELTA[d].x === dx && DELTA[d].y === dy) ?? null;
}

export function isDirection(value: unknown): value is Direction {
  return typeof value === 'string' && (DIRECTIONS as readonly string[]).includes(value);
}

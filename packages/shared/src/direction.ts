import type { Direction, Position } from './types';

export const DIRECTIONS: readonly Direction[] = ['up', 'down', 'left', 'right'];

const DELTA: Readonly<Record<Direction, Position>> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export function step(pos: Position, direction: Direction): Position {
  const d = DELTA[direction];
  return { x: pos.x + d.x, y: pos.y + d.y };
}

export function isDirection(value: unknown): value is Direction {
  return typeof value === 'string' && (DIRECTIONS as readonly string[]).includes(value);
}

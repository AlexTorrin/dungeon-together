import type { GameMap, Position } from '../types';
import { isWalkable } from './gameMap';

export const samePos = (a: Position, b: Position): boolean => a.x === b.x && a.y === b.y;

export const posKey = ({ x, y }: Position): string => `${x},${y}`;

/**
 * Расстояние Чебышёва: сколько шагов по 8 направлениям на пустой карте.
 * «Радиус 4» — это квадрат 9×9 вокруг клетки.
 */
export function chebyshev(a: Position, b: Position): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/** Клетки отрезка from → to по алгоритму Брезенхэма, включая оба конца. */
export function lineCells(from: Position, to: Position): Position[] {
  const cells: Position[] = [];
  const dx = Math.abs(to.x - from.x);
  const dy = -Math.abs(to.y - from.y);
  const sx = from.x < to.x ? 1 : -1;
  const sy = from.y < to.y ? 1 : -1;
  let err = dx + dy;
  let { x, y } = from;
  for (;;) {
    cells.push({ x, y });
    if (x === to.x && y === to.y) return cells;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/**
 * Прямая видимость: на отрезке между клетками (концы не считаются) нет стен.
 * Акторы обзор не закрывают — все двигаются одновременно.
 */
export function hasLineOfSight(map: GameMap, from: Position, to: Position): boolean {
  return lineCells(from, to)
    .slice(1, -1)
    .every((cell) => isWalkable(map, cell));
}

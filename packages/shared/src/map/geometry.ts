import type { Position } from '../types';

export const samePos = (a: Position, b: Position): boolean => a.x === b.x && a.y === b.y;

export const posKey = ({ x, y }: Position): string => `${x},${y}`;

/**
 * Расстояние Чебышёва: сколько шагов по 8 направлениям на пустой карте.
 * «Радиус 4» — это квадрат 9×9 вокруг клетки.
 */
export function chebyshev(a: Position, b: Position): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

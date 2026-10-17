import { DIRECTIONS, isDiagonal, step } from '../direction';
import type { Direction, GameMap, Position } from '../types';
import { posKey, samePos } from './geometry';
import { isWalkable } from './gameMap';

/**
 * Можно ли шагнуть из from в direction с точки зрения карты: в клетке пол,
 * а по диагонали — ещё и обе соседние прямые клетки не стены (угол срезать нельзя).
 */
export function canStep(map: GameMap, from: Position, direction: Direction): boolean {
  const to = step(from, direction);
  if (!isWalkable(map, to)) return false;
  if (!isDiagonal(direction)) return true;
  return isWalkable(map, { x: to.x, y: from.y }) && isWalkable(map, { x: from.x, y: to.y });
}

/**
 * Кратчайший путь по 8 направлениям (поиск в ширину, BFS). Возвращает клетки пути
 * без стартовой, последняя — to; [] если from === to; null если не дойти или дальше maxSteps.
 * Акторы путь не загораживают: все ходят одновременно, клетка может освободиться.
 * Порядок соседей фиксирован, поэтому из равных путей всегда выбирается один и тот же.
 */
export function findPath(
  map: GameMap,
  from: Position,
  to: Position,
  maxSteps = Number.POSITIVE_INFINITY,
): Position[] | null {
  if (samePos(from, to)) return [];
  if (!isWalkable(map, to)) return null;

  const cameFrom = new Map<string, Position>([[posKey(from), from]]);
  let frontier: Position[] = [from];
  for (let depth = 1; depth <= maxSteps && frontier.length > 0; depth++) {
    const next: Position[] = [];
    for (const pos of frontier) {
      for (const direction of DIRECTIONS) {
        if (!canStep(map, pos, direction)) continue;
        const cell = step(pos, direction);
        if (cameFrom.has(posKey(cell))) continue;
        cameFrom.set(posKey(cell), pos);
        if (samePos(cell, to)) return unwind(cameFrom, from, cell);
        next.push(cell);
      }
    }
    frontier = next;
  }
  return null;
}

function unwind(cameFrom: ReadonlyMap<string, Position>, from: Position, to: Position): Position[] {
  const path: Position[] = [];
  for (let cell = to; !samePos(cell, from);) {
    path.push(cell);
    const prev = cameFrom.get(posKey(cell));
    if (!prev) throw new Error('Broken path');
    cell = prev;
  }
  return path.reverse();
}

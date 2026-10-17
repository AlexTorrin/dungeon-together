import { FOV } from 'rot-js';
import { VIEW_RADIUS } from '../config/vision';
import type { GameMap, GameState, Position } from '../types';
import { isWalkable } from './gameMap';
import { posKey } from './geometry';

/**
 * Поле зрения (FOV): какие клетки видно из точки. Алгоритм — recursive shadowcasting из rot.js:
 * из глаза по восьми секторам расходятся «лучи», каждая стена отбрасывает тень на клетки за
 * ней. Стены, на которые падает взгляд, тоже видны (их же надо рисовать), сквозь них — нет.
 * Акторы обзор не закрывают — все двигаются одновременно.
 *
 * Возвращает ключи posKey видимых клеток, включая саму точку.
 */
export function visibleFrom(map: GameMap, from: Position, radius: number): Set<string> {
  const visible = new Set<string>([posKey(from)]);
  const fov = new FOV.RecursiveShadowcasting((x, y) => isWalkable(map, { x, y }));
  fov.compute(from.x, from.y, radius, (x, y) => {
    if (x >= 0 && y >= 0 && x < map.width && y < map.height) visible.add(posKey({ x, y }));
  });
  return visible;
}

/** Видит ли from клетку to не дальше radius. */
export function canSee(map: GameMap, from: Position, to: Position, radius: number): boolean {
  return visibleFrom(map, from, radius).has(posKey(to));
}

/**
 * Что видит команда: объединение полей зрения всех живых игроков. Видимость не хранится
 * в состоянии — она целиком выводится из позиций, хранится только память (explored).
 */
export function teamVision(state: GameState): Set<string> {
  const visible = new Set<string>();
  for (const actor of Object.values(state.actors)) {
    if (actor.kind !== 'player') continue;
    for (const key of visibleFrom(state.map, actor.pos, VIEW_RADIUS)) visible.add(key);
  }
  return visible;
}

/** Память команды после хода: исследованные клетки + то, что видно сейчас. */
export function withExplored(state: GameState): readonly boolean[] {
  const visible = teamVision(state);
  const { width } = state.map;
  return state.explored.map(
    (seen, i) => seen || visible.has(posKey({ x: i % width, y: Math.floor(i / width) })),
  );
}

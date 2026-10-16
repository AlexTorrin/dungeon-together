import { getTile, type GameMap, type Position } from '@dt/shared';
import { TILESET, type TileKind } from './tilesetIndex';

/**
 * Автотайлинг: тип клетки в shared — просто 'wall'/'floor', а какой именно спрайт стены
 * рисовать (угол, верхняя грань, боковая) решается по соседям. Это чисто визуальная задача,
 * поэтому живёт в клиенте.
 *
 * Возвращает null для «глухой» стены, у которой нет соседнего пола — её не рисуем, там фон.
 */
export function pickTileKind(map: GameMap, { x, y }: Position): TileKind | null {
  const floorAt = (dx: number, dy: number): boolean =>
    getTile(map, { x: x + dx, y: y + dy }) === 'floor';

  if (floorAt(0, 0)) return floorAt(0, -1) ? 'floor' : 'floorUnderWall';

  const n = floorAt(0, -1);
  const s = floorAt(0, 1);
  if (s && n) return 'wallBetween';
  if (s) return 'wallTop';
  if (n) return 'wallBottom';
  if (floorAt(1, 0)) return 'wallLeft';
  if (floorAt(-1, 0)) return 'wallRight';
  if (floorAt(1, 1)) return 'cornerTopLeft';
  if (floorAt(-1, 1)) return 'cornerTopRight';
  if (floorAt(1, -1)) return 'cornerBottomLeft';
  if (floorAt(-1, -1)) return 'cornerBottomRight';
  return null;
}

/** Стабильный псевдослучайный хеш координат, чтобы варианты тайлов не «мигали» между кадрами. */
function hashPosition({ x, y }: Position): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

export function pickTileIndex(map: GameMap, pos: Position): number | null {
  const kind = pickTileKind(map, pos);
  if (kind === null) return null;
  const variants: readonly number[] = TILESET[kind];
  return variants[hashPosition(pos) % variants.length] ?? null;
}

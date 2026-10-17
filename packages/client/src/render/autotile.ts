import { getTile, type GameMap, type Position } from '@dt/shared';
import { TILESET } from './tilesetIndex';

/**
 * Автотайлинг: в shared клетка — просто 'wall' или 'floor', а какой спрайт рисовать, решает
 * клиент по соседям. Это чисто визуальная задача.
 *
 * Стены — по битовой маске (bitmask autotiling): бит соседа = «там пол». Маска 0–255
 * однозначно задаёт вид стены; атлас со всеми масками собирает tools/sprites/walls.mjs
 * из кусков тайлсета пака, кадр в нём = маска × WALL_VARIANTS + вариант кладки.
 */
export const WALL_BITS = {
  n: 1,
  e: 2,
  s: 4,
  w: 8,
  ne: 16,
  se: 32,
  sw: 64,
  nw: 128,
} as const;

/** Вариантов кладки на маску в атласе — должно совпадать с VARIANTS в walls.mjs. */
export const WALL_VARIANTS = 4;

const NEIGHBOURS: readonly (readonly [dx: number, dy: number, bit: number])[] = [
  [0, -1, WALL_BITS.n],
  [1, 0, WALL_BITS.e],
  [0, 1, WALL_BITS.s],
  [-1, 0, WALL_BITS.w],
  [1, -1, WALL_BITS.ne],
  [1, 1, WALL_BITS.se],
  [-1, 1, WALL_BITS.sw],
  [-1, -1, WALL_BITS.nw],
];

/** Где вокруг клетки пол — битовая маска по 8 соседям. */
export function floorMask(map: GameMap, { x, y }: Position): number {
  let mask = 0;
  for (const [dx, dy, bit] of NEIGHBOURS) {
    if (getTile(map, { x: x + dx, y: y + dy }) === 'floor') mask |= bit;
  }
  return mask;
}

/** Что рисовать в клетке: кадр тайлсета пака (пол) или атласа стен; null — пустота. */
export type TilePick =
  | { readonly sheet: 'tileset'; readonly frame: number }
  | { readonly sheet: 'walls'; readonly frame: number };

/** Стабильный псевдослучайный хеш координат, чтобы варианты тайлов не «мигали» между кадрами. */
function hashPosition({ x, y }: Position): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

export function pickTile(map: GameMap, pos: Position): TilePick | null {
  const hash = hashPosition(pos);
  const mask = floorMask(map, pos);
  if (getTile(map, pos) === 'floor') {
    const variants = mask & WALL_BITS.n ? TILESET.floor : TILESET.floorUnderWall;
    return { sheet: 'tileset', frame: variants[hash % variants.length] ?? TILESET.floor[0] };
  }
  // Глухая стена без пола вокруг не рисуется — там фон.
  if (mask === 0) return null;
  return { sheet: 'walls', frame: mask * WALL_VARIANTS + (hash % WALL_VARIANTS) };
}

/** Видна ли у стены кирпичная грань (пол снизу, не тонкая перегородка) — сюда вешаем факелы. */
export function hasWallFace(map: GameMap, pos: Position): boolean {
  if (getTile(map, pos) === 'floor') return false;
  const mask = floorMask(map, pos);
  return (mask & WALL_BITS.s) !== 0 && (mask & WALL_BITS.n) === 0;
}

// Спрайт 16×16 из ASCII-картинки в стиле пака: свои цвета + обводка цветом фона.
import { Buffer } from 'node:buffer';
import { URL, fileURLToPath } from 'node:url';
import { readPng } from './png.mjs';

export const SIZE = 16;
export const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** Цвет обводки у предметов пака — он же цвет фона сцены. */
const OUTLINE = [0x25, 0x13, 0x1a];
const EMPTY = '.';
const SIDES = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** '#adc1cf' → [0xad, 0xc1, 0xcf] */
export function hex(color) {
  return [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
}

/**
 * ASCII-картинка (SIZE строк по SIZE символов, '.' — пусто) → RGBA.
 * Пустые пиксели рядом с непустыми (по 4 сторонам) становятся обводкой — как у предметов пака.
 */
export function renderSprite(art, colors) {
  if (art.length !== SIZE || art.some((row) => row.length !== SIZE)) {
    throw new Error(`Sprite must be ${SIZE} rows of ${SIZE} chars`);
  }
  const at = (x, y) => (x < 0 || y < 0 || x >= SIZE || y >= SIZE ? EMPTY : art[y][x]);
  const rgba = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const char = at(x, y);
      const offset = (y * SIZE + x) * 4;
      if (char !== EMPTY) {
        const color = colors[char];
        if (!color) throw new Error(`No color for '${char}' at (${x}, ${y})`);
        rgba.set([...hex(color), 255], offset);
      } else if (SIDES.some(([dx, dy]) => at(x + dx, y + dy) !== EMPTY)) {
        rgba.set([...OUTLINE, 255], offset);
      }
    }
  }
  return rgba;
}

/**
 * Превью: спрайт, увеличенный в scale раз, на плитке пола из тайлсета (кадр 6) —
 * чтобы оценить, как он будет смотреться в игре.
 */
export function previewOnFloor(rgba, scale = 10) {
  const tiles = readPng(`${ROOT}assets/character and tileset/Dungeon_Tileset.png`);
  const FLOOR_X = 6 * SIZE;
  const size = SIZE * scale;
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = Math.floor(x / scale);
      const sy = Math.floor(y / scale);
      const s = (sy * SIZE + sx) * 4;
      const f = (sy * tiles.width + FLOOR_X + sx) * 4;
      const px = rgba[s + 3] ? rgba.subarray(s, s + 4) : tiles.data.subarray(f, f + 4);
      out.set(px, (y * size + x) * 4);
    }
  }
  return { size, data: out };
}

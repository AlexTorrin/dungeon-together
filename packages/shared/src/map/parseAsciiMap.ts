import type { GameMap, Tile } from '../types';

const CHAR_TO_TILE: Readonly<Record<string, Tile>> = {
  '#': 'wall',
  '.': 'floor',
  ' ': 'wall',
};

/**
 * Собирает карту из ASCII: '#' и ' ' — стена, '.' — пол.
 * Короткие строки дополняются стенами до ширины самой длинной.
 */
export function parseAsciiMap(ascii: string): GameMap {
  const rows = ascii.split('\n').filter((row) => row.trim().length > 0);
  const width = Math.max(0, ...rows.map((row) => row.length));
  const tiles: Tile[] = [];

  for (const [y, row] of rows.entries()) {
    for (let x = 0; x < width; x++) {
      const char = row[x] ?? '#';
      const tile = CHAR_TO_TILE[char];
      if (!tile) throw new Error(`Unknown map char '${char}' at (${x}, ${y})`);
      tiles.push(tile);
    }
  }

  return { width, height: rows.length, tiles };
}

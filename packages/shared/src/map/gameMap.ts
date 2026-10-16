import type { GameMap, Position, Tile } from '../types';

export function isInBounds(map: GameMap, { x, y }: Position): boolean {
  return x >= 0 && y >= 0 && x < map.width && y < map.height;
}

/** За пределами карты считаем, что стена — так соседей у края проверять проще. */
export function getTile(map: GameMap, pos: Position): Tile {
  if (!isInBounds(map, pos)) return 'wall';
  return map.tiles[pos.y * map.width + pos.x] ?? 'wall';
}

export function isWalkable(map: GameMap, pos: Position): boolean {
  return getTile(map, pos) === 'floor';
}

export function createFilledMap(width: number, height: number, tile: Tile): GameMap {
  return { width, height, tiles: Array.from({ length: width * height }, () => tile) };
}

/** Возвращает новую карту с изменённой клеткой; клетки вне карты игнорируются. */
export function setTile(map: GameMap, pos: Position, tile: Tile): GameMap {
  if (!isInBounds(map, pos) || getTile(map, pos) === tile) return map;
  const tiles = [...map.tiles];
  tiles[pos.y * map.width + pos.x] = tile;
  return { ...map, tiles };
}

/** Меняет размер карты от левого верхнего угла: новые клетки — стены, лишние обрезаются. */
export function resizeMap(map: GameMap, width: number, height: number): GameMap {
  const tiles: Tile[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) tiles.push(getTile(map, { x, y }));
  }
  return { width, height, tiles };
}

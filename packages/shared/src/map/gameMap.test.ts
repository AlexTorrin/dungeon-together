import { describe, expect, it } from 'vitest';
import { createFilledMap, getTile, resizeMap, setTile } from './gameMap';
import { serializeMap } from './room';

describe('setTile', () => {
  it('returns a new map and leaves the original untouched', () => {
    const map = createFilledMap(2, 2, 'wall');
    const next = setTile(map, { x: 1, y: 0 }, 'floor');
    expect(getTile(next, { x: 1, y: 0 })).toBe('floor');
    expect(getTile(map, { x: 1, y: 0 })).toBe('wall');
  });

  it('returns the same map for out-of-bounds or no-op changes', () => {
    const map = createFilledMap(2, 2, 'wall');
    expect(setTile(map, { x: 5, y: 0 }, 'floor')).toBe(map);
    expect(setTile(map, { x: 0, y: 0 }, 'wall')).toBe(map);
  });
});

describe('resizeMap', () => {
  it('pads with walls when growing and crops when shrinking', () => {
    const map = createFilledMap(2, 2, 'floor');
    expect(serializeMap(resizeMap(map, 3, 2))).toBe('..#\n..#');
    expect(serializeMap(resizeMap(map, 1, 1))).toBe('.');
  });
});

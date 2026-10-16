import { describe, expect, it } from 'vitest';
import { parseAsciiMap } from './parseAsciiMap';
import { getTile } from './gameMap';
import { DEMO_ROOM } from './demoMap';

describe('parseAsciiMap', () => {
  it('parses walls and floors row by row', () => {
    const map = parseAsciiMap(`
###
#.#
###
`);
    expect(map.width).toBe(3);
    expect(map.height).toBe(3);
    expect(getTile(map, { x: 1, y: 1 })).toBe('floor');
    expect(getTile(map, { x: 0, y: 1 })).toBe('wall');
  });

  it('pads short rows with walls', () => {
    const map = parseAsciiMap('#..\n#');
    expect(map.width).toBe(3);
    expect(getTile(map, { x: 2, y: 1 })).toBe('wall');
  });

  it('treats out-of-bounds as wall', () => {
    const map = parseAsciiMap('.');
    expect(getTile(map, { x: -1, y: 0 })).toBe('wall');
    expect(getTile(map, { x: 1, y: 0 })).toBe('wall');
  });

  it('throws on unknown chars', () => {
    expect(() => parseAsciiMap('#?#')).toThrow(/Unknown map char/);
  });
});

describe('DEMO_ROOM', () => {
  it('has spawn on floor', () => {
    expect(getTile(DEMO_ROOM.map, DEMO_ROOM.spawn)).toBe('floor');
  });
});

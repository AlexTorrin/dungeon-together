import { describe, expect, it } from 'vitest';
import { applyCommand } from '../rules/applyCommand';
import { createGameState } from '../state/createGameState';
import { makeState, playerAt } from '../testing';
import type { Direction } from '../types';
import { posKey } from './geometry';
import { canSee, teamVision, visibleFrom } from './fov';
import { parseAsciiMap } from './parseAsciiMap';
import { parseRoom } from './room';

const map = parseAsciiMap(
  ['###########', '#.........#', '#....#....#', '#.........#', '###########'].join('\n'),
);

describe('visibleFrom', () => {
  it('sees open floor, the walls around it and itself', () => {
    const seen = visibleFrom(map, { x: 1, y: 1 }, 20);
    expect(seen.has('1,1')).toBe(true);
    expect(seen.has('3,3')).toBe(true);
    expect(seen.has('0,0')).toBe(true); // стена в поле зрения тоже видна
  });

  it('a wall casts a shadow behind it', () => {
    expect(canSee(map, { x: 2, y: 2 }, { x: 8, y: 2 }, 20)).toBe(false); // за колонной (5,2)
    expect(canSee(map, { x: 2, y: 2 }, { x: 5, y: 2 }, 20)).toBe(true); // сама колонна видна
  });

  it('is limited by radius', () => {
    expect(canSee(map, { x: 1, y: 1 }, { x: 4, y: 1 }, 3)).toBe(true);
    expect(canSee(map, { x: 1, y: 1 }, { x: 9, y: 1 }, 3)).toBe(false);
  });
});

describe('team vision and memory', () => {
  const ROOM = `
###############
#@............#
#######.#######
#.............#
###############
`;

  it('the team sees what any player sees', () => {
    const state = makeState(ROOM, [playerAt('p1', 1, 1), playerAt('p2', 13, 3)]);
    const vision = teamVision(state);
    expect(vision.has(posKey({ x: 2, y: 1 }))).toBe(true);
    expect(vision.has(posKey({ x: 12, y: 3 }))).toBe(true);
  });

  it('memory grows as players walk and never forgets', () => {
    const room = parseRoom(ROOM);
    let state = createGameState(room, ['p1'], 1);
    const at = (x: number, y: number): boolean | undefined =>
      state.explored[y * room.map.width + x];
    expect(at(1, 1)).toBe(true); // старт
    expect(at(13, 3)).toBe(false); // нижний коридор за стеной не виден

    const go = (direction: Direction): void => {
      state = applyCommand(state, {
        type: 'submitAction',
        playerId: 'p1',
        action: { type: 'move', direction },
      }).state;
    };
    for (let i = 0; i < 6; i++) go('right'); // к проходу (7,1)
    go('down'); // в проход (7,2)
    expect(at(13, 3)).toBe(false); // из прохода видно только узкий веер вниз
    go('down'); // в нижний коридор (7,3)
    expect(state.actors['p1']?.pos).toEqual({ x: 7, y: 3 });
    expect(at(13, 3)).toBe(true); // теперь коридор виден целиком
    expect(at(1, 1)).toBe(true); // старт помнится, хотя его уже может быть не видно
  });
});

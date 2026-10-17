import { describe, expect, it } from 'vitest';
import { step } from '../direction';
import { chebyshev } from '../map/geometry';
import { findPath } from '../map/pathfinding';
import { seedRng } from '../rng';
import { makeState, monsterAt, playerAt, weapon } from '../testing';
import type { MonsterActor } from '../types';
import { canAttack } from './combat';
import { chooseMonsterAction } from './monsterAi';

const ARENA = `
################
#@.............#
#..............#
#..............#
################
`;

function monsterOf(state: ReturnType<typeof makeState>, id: string): MonsterActor {
  const actor = state.actors[id];
  if (actor?.kind !== 'monster') throw new Error(`no monster ${id}`);
  return actor;
}

describe('chooseMonsterAction', () => {
  it('attacks a player in reach: at the player or a cell the player can step to', () => {
    const state = makeState(ARENA, [playerAt('p1', 5, 2), monsterAt('m', 'skeleton', 4, 2)]);
    const monster = monsterOf(state, 'm');
    const targets = new Set<string>();
    for (let seed = 0; seed < 50; seed++) {
      const [action] = chooseMonsterAction(state, monster, seedRng(seed));
      if (action.type !== 'attack') throw new Error(`expected attack, got ${action.type}`);
      expect(canAttack(state.map, monster, action.target)).toBe(true);
      expect(chebyshev(action.target, { x: 5, y: 2 })).toBeLessThanOrEqual(1);
      targets.add(`${action.target.x},${action.target.y}`);
    }
    // Иногда бьёт туда, где игрок стоит, иногда «угадывает» шаг в сторону.
    expect(targets.has('5,2')).toBe(true);
    expect(targets.size).toBeGreaterThan(1);
  });

  it('uses the weapon range: a ranged monster attacks from afar', () => {
    const state = makeState(ARENA, [
      playerAt('p1', 9, 2),
      monsterAt('m', 'vampire', 5, 2, { weapon: weapon('r', 'ranged') }),
    ]);
    const [action] = chooseMonsterAction(state, monsterOf(state, 'm'), seedRng(1));
    expect(action.type).toBe('attack');
  });

  it('an unarmed monster goes for a nearby item before chasing', () => {
    const state = makeState(
      ARENA,
      [playerAt('p1', 1, 2), monsterAt('m', 'skull', 6, 2)],
      [{ id: 'i', type: 'melee', pos: { x: 8, y: 2 } }],
    );
    expect(chooseMonsterAction(state, monsterOf(state, 'm'), seedRng(1))[0]).toEqual({
      type: 'move',
      direction: 'right',
    });
  });

  it('chases a player within aggro radius along the shortest path', () => {
    const state = makeState(ARENA, [playerAt('p1', 1, 1), monsterAt('m', 'skull', 5, 3)]);
    const [action] = chooseMonsterAction(state, monsterOf(state, 'm'), seedRng(1));
    if (action.type !== 'move') throw new Error(`expected move, got ${action.type}`);
    // Кратчайших путей несколько; важно, что шаг сокращает путь до игрока с 4 до 3.
    const after = step({ x: 5, y: 3 }, action.direction);
    expect(findPath(state.map, after, { x: 1, y: 1 })).toHaveLength(3);
  });

  it('does not notice a player it cannot see, even if the path is short', () => {
    const WALLED = `
#########
#@..#...#
#...#...#
#.......#
#########
`;
    // Игрок за стеной (5,1), монстр в (3,1): по пути 4–5 шагов, но прямой видимости нет.
    const state = makeState(WALLED, [playerAt('p1', 5, 1), monsterAt('m', 'skull', 3, 1)]);
    expect(chooseMonsterAction(state, monsterOf(state, 'm'), seedRng(1))[0]).toEqual({
      type: 'wait',
    });
  });

  it('waits when nobody is around', () => {
    const state = makeState(ARENA, [playerAt('p1', 1, 1), monsterAt('m', 'skull', 14, 3)]);
    expect(chooseMonsterAction(state, monsterOf(state, 'm'), seedRng(1))[0]).toEqual({
      type: 'wait',
    });
  });

  it("does not peek at the players' choices this turn", () => {
    const state = makeState(ARENA, [playerAt('p1', 5, 2), monsterAt('m', 'skeleton', 4, 2)]);
    const peeked = {
      ...state,
      pendingPlans: { p1: [{ type: 'move' as const, direction: 'right' as const }] },
    };
    for (let seed = 0; seed < 20; seed++) {
      expect(chooseMonsterAction(peeked, monsterOf(peeked, 'm'), seedRng(seed))).toEqual(
        chooseMonsterAction(state, monsterOf(state, 'm'), seedRng(seed)),
      );
    }
  });
});

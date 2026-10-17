import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../commands';
import { seedRng } from '../rng';
import { makeState, monsterAt, playerAt, weapon } from '../testing';
import type { Action, GameState, Plan, PlayerId } from '../types';
import { applyCommand } from './applyCommand';
import { chooseMonsterPlan } from './monsterAi';
import { isPlanValid, simulatePlan } from './plan';

const ARENA = `
##############
#@...........#
#............#
#............#
##############
`;

function turn(state: GameState, plans: Record<PlayerId, Plan>) {
  let next = state;
  const events: GameEvent[] = [];
  for (const [playerId, plan] of Object.entries(plans)) {
    const result = applyCommand(next, { type: 'submitPlan', playerId, plan });
    next = result.state;
    events.push(...result.events);
  }
  return { state: next, events };
}

const wait: Action = { type: 'wait' };
const right: Action = { type: 'move', direction: 'right' };
const hit = (x: number, y: number): Action => ({ type: 'attack', target: { x, y } });
const equip = (itemId: string): Action => ({ type: 'equip', itemId });
const drop = (itemId: string): Action => ({ type: 'drop', itemId });
const sword = weapon('sw', 'sword');

describe('sword: 2 action points, strikes in phase 2', () => {
  it('a sword blow takes the whole turn and lands in phase 2', () => {
    const { map } = makeState(ARENA, []);
    const sim = simulatePlan(map, playerAt('p1', 1, 1, { weapon: sword }), [hit(2, 1)]);
    expect(sim?.phases).toEqual([wait, hit(2, 1)]);
    expect(sim?.phaseOf).toEqual([1]);
  });

  it('does not fit with anything else into one turn', () => {
    const { map } = makeState(ARENA, []);
    const p = playerAt('p1', 1, 1, { weapon: sword });
    expect(isPlanValid(map, p, [right, hit(3, 1)])).toBe(false);
    expect(
      isPlanValid(map, playerAt('p1', 1, 1, { backpack: [sword] }), [equip('sw'), hit(2, 1)]),
    ).toBe(false);
  });

  it('hits hard, but a target leaving in phase 1 dodges the swing', () => {
    const start = (): GameState =>
      makeState(ARENA, [playerAt('p1', 1, 1, { weapon: sword }), playerAt('p2', 2, 1)]);
    const stayed = turn(start(), { p1: [hit(2, 1)], p2: [wait, wait] }).state;
    expect(stayed.actors['p2']?.hp).toBe(10 - 6);
    const dodged = turn(start(), { p1: [hit(2, 1)], p2: [right, wait] }).state;
    expect(dodged.actors['p2']?.hp).toBe(10);
  });
});

describe('wand and bow range', () => {
  it('a wand reaches 6 cells, a bow only 4', () => {
    const { map } = makeState(ARENA, []);
    expect(
      isPlanValid(map, playerAt('p1', 1, 1, { weapon: weapon('w', 'wand') }), [hit(7, 1)]),
    ).toBe(true);
    expect(
      isPlanValid(map, playerAt('p1', 1, 1, { weapon: weapon('b', 'bow') }), [hit(7, 1)]),
    ).toBe(false);
    expect(
      isPlanValid(map, playerAt('p1', 1, 1, { weapon: weapon('b', 'bow') }), [hit(5, 1)]),
    ).toBe(true);
  });
});

describe('equip and drop', () => {
  it('equip swaps hands with the backpack item, then the new weapon is used', () => {
    const state = makeState(ARENA, [
      playerAt('p1', 1, 1, { weapon: weapon('k', 'knife'), backpack: [weapon('w', 'wand')] }),
      playerAt('p2', 6, 1),
    ]);
    const { state: next, events } = turn(state, { p1: [equip('w'), hit(6, 1)], p2: [wait, wait] });
    expect(next.actors['p1']?.weapon).toEqual({ id: 'w', type: 'wand' });
    expect(next.actors['p1']?.backpack).toEqual([{ id: 'k', type: 'knife' }]);
    expect(next.actors['p2']?.hp).toBe(10 - 3);
    expect(events).toContainEqual({ type: 'itemEquipped', actorId: 'p1', itemId: 'w' });
  });

  it('rejects equipping or dropping what the player does not have', () => {
    const state = makeState(ARENA, [playerAt('p1', 1, 1)]);
    const rejected = { type: 'planRejected', playerId: 'p1', reason: 'invalidPlan' };
    expect(turn(state, { p1: [equip('nope')] }).events).toEqual([rejected]);
    expect(turn(state, { p1: [drop('nope')] }).events).toEqual([rejected]);
  });

  it('drop puts the item on the floor; the dropper standing still does not pick it back up', () => {
    const state = makeState(ARENA, [
      playerAt('p1', 2, 1, { weapon: weapon('k', 'knife') }),
      playerAt('p2', 4, 1),
    ]);
    const { state: next, events } = turn(state, { p1: [drop('k'), wait], p2: [wait, wait] });
    expect(next.actors['p1']?.weapon).toBeNull();
    expect(next.items['k']).toEqual({ id: 'k', type: 'knife', pos: { x: 2, y: 1 } });
    expect(events).toContainEqual({
      type: 'itemDropped',
      actorId: 'p1',
      itemId: 'k',
      at: { x: 2, y: 1 },
    });

    // Союзник шагает на клетку (герой уходит с неё) — и подбирает.
    const handed = turn(next, {
      p1: [{ type: 'move', direction: 'down' }, wait],
      p2: [
        { type: 'move', direction: 'left' },
        { type: 'move', direction: 'left' },
      ],
    }).state;
    expect(handed.actors['p2']?.backpack).toEqual([{ id: 'k', type: 'knife' }]);
  });

  it('a full backpack leaves extra items on the floor', () => {
    const full = [1, 2, 3, 4].map((i) => weapon(`f${i}`, 'knife'));
    const state = makeState(
      ARENA,
      [playerAt('p1', 1, 1, { backpack: full })],
      [{ id: 'extra', type: 'bow', pos: { x: 2, y: 1 } }],
    );
    const { state: next } = turn(state, { p1: [right] });
    expect(next.actors['p1']?.backpack).toHaveLength(4);
    expect(next.items['extra']?.pos).toEqual({ x: 2, y: 1 });
  });

  it('the dead drop everything: hands and backpack', () => {
    const state = makeState(ARENA, [
      playerAt('p1', 1, 1, { weapon: weapon('k', 'knife') }),
      playerAt('p2', 2, 1, { hp: 1, weapon: weapon('b', 'bow'), backpack: [weapon('w', 'wand')] }),
    ]);
    const { state: next } = turn(state, { p1: [hit(2, 1)], p2: [wait, wait] });
    expect(Object.keys(next.items).sort()).toEqual(['b', 'w']);
  });
});

describe('monsters use the same inventory rules', () => {
  const monsterOf = (state: GameState, id: string) => {
    const m = state.actors[id];
    if (m?.kind !== 'monster') throw new Error('no monster');
    return m;
  };

  it('an unarmed monster takes a weapon from its backpack first', () => {
    const state = makeState(ARENA, [
      playerAt('p1', 1, 1),
      monsterAt('m', 'skeleton', 2, 1, { backpack: [weapon('k', 'knife')] }),
    ]);
    const [plan] = chooseMonsterPlan(state, monsterOf(state, 'm'), seedRng(1));
    expect(plan[0]).toEqual(equip('k'));
    expect(plan[1]?.type).toBe('attack');
  });

  it('a sword monster next to a player swings once for the whole turn', () => {
    const state = makeState(ARENA, [
      playerAt('p1', 1, 1),
      monsterAt('m', 'vampire', 2, 1, { weapon: sword }),
    ]);
    const [plan] = chooseMonsterPlan(state, monsterOf(state, 'm'), seedRng(1));
    expect(plan).toHaveLength(1);
    expect(plan[0]?.type).toBe('attack');
  });

  it('a sword monster that only reaches the player after a step does not swing this turn', () => {
    const state = makeState(ARENA, [
      playerAt('p1', 1, 1),
      monsterAt('m', 'vampire', 3, 1, { weapon: sword }),
    ]);
    const [plan] = chooseMonsterPlan(state, monsterOf(state, 'm'), seedRng(1));
    expect(plan.map((a) => a.type)).toEqual(['move', 'wait']);
  });
});

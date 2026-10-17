import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../commands';
import { makeState, monsterAt, playerAt, weapon } from '../testing';
import type { Action, GameState, PlayerId } from '../types';
import { applyCommand } from './applyCommand';
import { attackableCells, canAttack } from './combat';

const ARENA = `
###########
#@........#
#.........#
#....#....#
#.........#
#.........#
###########
`;

function turn(state: GameState, actions: Record<PlayerId, Action>) {
  let next = state;
  const events: GameEvent[] = [];
  for (const [playerId, action] of Object.entries(actions)) {
    const result = applyCommand(next, { type: 'submitPlan', playerId, plan: [action] });
    next = result.state;
    events.push(...result.events);
  }
  return { state: next, events };
}

const hit = (x: number, y: number): Action => ({ type: 'attack', target: { x, y } });
const wait: Action = { type: 'wait' };

describe('canAttack', () => {
  const state = makeState(ARENA, []);

  it('melee and fists reach the 8 neighbours, not further', () => {
    for (const w of [null, weapon('w', 'knife')]) {
      const p = playerAt('p', 2, 2, { weapon: w });
      expect(canAttack(state.map, p, { x: 3, y: 3 })).toBe(true);
      expect(canAttack(state.map, p, { x: 1, y: 1 })).toBe(true);
      expect(canAttack(state.map, p, { x: 4, y: 2 })).toBe(false);
      expect(attackableCells(state.map, p)).toHaveLength(8);
    }
  });

  it('ranged reaches any cell within 4 (diagonals included) in line of sight', () => {
    const p = playerAt('p', 1, 1, { weapon: weapon('w', 'bow') });
    expect(canAttack(state.map, p, { x: 5, y: 1 })).toBe(true);
    expect(canAttack(state.map, p, { x: 5, y: 5 })).toBe(true);
    expect(canAttack(state.map, p, { x: 6, y: 1 })).toBe(false);
  });

  it('walls block line of sight; own tile and walls are not targets', () => {
    const p = playerAt('p', 3, 3, { weapon: weapon('w', 'bow') });
    expect(canAttack(state.map, p, { x: 7, y: 3 })).toBe(false); // за колонной (5,3)
    expect(canAttack(state.map, p, { x: 5, y: 3 })).toBe(false); // сама колонна
    expect(canAttack(state.map, p, { x: 3, y: 3 })).toBe(false);
  });
});

describe('attacks hit tiles after movement', () => {
  it('hits whoever steps into the target tile', () => {
    const state = makeState(ARENA, [playerAt('p1', 1, 1), playerAt('p2', 3, 1)]);
    const { state: next, events } = turn(state, {
      p1: hit(2, 1),
      p2: { type: 'move', direction: 'left' },
    });
    expect(next.actors['p2']?.hp).toBe(9);
    expect(events).toContainEqual({ type: 'damaged', actorId: 'p2', by: 'p1', amount: 1, hp: 9 });
  });

  it('misses a target who steps away, and an empty tile can be hit', () => {
    const state = makeState(ARENA, [playerAt('p1', 1, 1), playerAt('p2', 2, 1)]);
    const { state: next, events } = turn(state, {
      p1: hit(2, 1),
      p2: { type: 'move', direction: 'right' },
    });
    expect(next.actors['p2']?.hp).toBe(10);
    expect(events).toContainEqual({ type: 'attacked', actorId: 'p1', target: { x: 2, y: 1 } });
    expect(events.some((e) => e.type === 'damaged')).toBe(false);
  });

  it('the attacker stays in place and does not reserve the target tile', () => {
    const state = makeState(ARENA, [playerAt('p1', 1, 1), playerAt('p2', 2, 2)]);
    const { state: next } = turn(state, { p1: hit(2, 1), p2: { type: 'move', direction: 'up' } });
    expect(next.actors['p1']?.pos).toEqual({ x: 1, y: 1 });
    expect(next.actors['p2']?.pos).toEqual({ x: 2, y: 1 });
  });

  it('uses weapon damage and stacks hits on the same tile', () => {
    const state = makeState(ARENA, [
      playerAt('p1', 1, 1, { weapon: weapon('m', 'knife') }),
      playerAt('p2', 5, 1, { weapon: weapon('r', 'bow') }),
      playerAt('p3', 2, 1),
    ]);
    const { state: next } = turn(state, { p1: hit(2, 1), p2: hit(2, 1), p3: wait });
    expect(next.actors['p3']?.hp).toBe(10 - 3 - 2);
  });

  it('ignores attacks out of reach', () => {
    const state = makeState(ARENA, [playerAt('p1', 1, 1)]);
    expect(turn(state, { p1: hit(3, 1) })).toEqual({
      state,
      events: [{ type: 'planRejected', playerId: 'p1', reason: 'invalidPlan' }],
    });
  });
});

describe('death and items', () => {
  it('removes the dead and drops their weapon', () => {
    const state = makeState(ARENA, [
      playerAt('p1', 1, 1, { weapon: weapon('m', 'knife') }),
      playerAt('p2', 2, 1, { hp: 3, weapon: weapon('r', 'bow') }),
    ]);
    const { state: next, events } = turn(state, { p1: hit(2, 1), p2: wait });
    expect(next.actors['p2']).toBeUndefined();
    expect(next.items['r']).toEqual({ id: 'r', type: 'bow', pos: { x: 2, y: 1 } });
    expect(events).toContainEqual({ type: 'died', actorId: 'p2', at: { x: 2, y: 1 } });
    expect(events).toContainEqual({
      type: 'itemDropped',
      actorId: 'p2',
      itemId: 'r',
      at: { x: 2, y: 1 },
    });
  });

  it('attacks are simultaneous: a dying attacker still deals damage', () => {
    const state = makeState(ARENA, [
      playerAt('p1', 1, 1, { hp: 1 }),
      playerAt('p2', 2, 1, { hp: 1 }),
    ]);
    const { state: next, events } = turn(state, { p1: hit(2, 1), p2: hit(1, 1) });
    expect(Object.keys(next.actors)).toEqual([]);
    expect(next.status).toBe('lost');
    expect(events.at(-1)).toEqual({ type: 'gameOver', status: 'lost' });
  });

  it('stepping onto items puts them into the backpack, hands stay as they were', () => {
    const state = makeState(
      ARENA,
      [playerAt('p1', 1, 1, { weapon: weapon('old', 'knife') })],
      [
        { id: 'a', type: 'bow', pos: { x: 2, y: 1 } },
        { id: 'b', type: 'sword', pos: { x: 2, y: 1 } },
      ],
    );
    const { state: next, events } = turn(state, { p1: { type: 'move', direction: 'right' } });
    expect(next.actors['p1']?.weapon).toEqual({ id: 'old', type: 'knife' });
    expect(next.actors['p1']?.backpack).toEqual([
      { id: 'a', type: 'bow' },
      { id: 'b', type: 'sword' },
    ]);
    expect(next.items).toEqual({});
    expect(events).toContainEqual({ type: 'itemPickedUp', actorId: 'p1', itemId: 'a' });
  });
});

describe('diagonal moves', () => {
  it('moves diagonally', () => {
    const state = makeState(ARENA, [playerAt('p1', 1, 1)]);
    const { state: next } = turn(state, { p1: { type: 'move', direction: 'downRight' } });
    expect(next.actors['p1']?.pos).toEqual({ x: 2, y: 2 });
  });

  it('cannot cut a wall corner', () => {
    // (4,3) → (5,2): клетка свободна, но угол колонны (5,3) мешает.
    const state = makeState(ARENA, [playerAt('p1', 4, 3)]);
    const { state: next, events } = turn(state, { p1: { type: 'move', direction: 'upRight' } });
    expect(next.actors['p1']?.pos).toEqual({ x: 4, y: 3 });
    expect(events).toContainEqual(expect.objectContaining({ actorId: 'p1', reason: 'wall' }));
  });

  it('forbids diagonal swaps but allows crossing paths', () => {
    const swap = makeState(ARENA, [playerAt('p1', 1, 1), playerAt('p2', 2, 2)]);
    const swapped = turn(swap, {
      p1: { type: 'move', direction: 'downRight' },
      p2: { type: 'move', direction: 'upLeft' },
    }).state;
    expect(swapped.actors['p1']?.pos).toEqual({ x: 1, y: 1 });

    const cross = makeState(ARENA, [playerAt('p1', 1, 1), playerAt('p2', 2, 1)]);
    const crossed = turn(cross, {
      p1: { type: 'move', direction: 'downRight' },
      p2: { type: 'move', direction: 'downLeft' },
    }).state;
    expect(crossed.actors['p1']?.pos).toEqual({ x: 2, y: 2 });
    expect(crossed.actors['p2']?.pos).toEqual({ x: 1, y: 2 });
  });
});

describe('game over', () => {
  it('is won when the last monster dies', () => {
    const state = makeState(ARENA, [
      playerAt('p1', 1, 1, { weapon: weapon('m', 'knife') }),
      monsterAt('m1', 'skull', 2, 1, { hp: 1 }),
    ]);
    const { state: next, events } = turn(state, { p1: hit(2, 1) });
    expect(next.status).toBe('won');
    expect(events.at(-1)).toEqual({ type: 'gameOver', status: 'won' });
    expect(turn(next, { p1: wait })).toEqual({
      state: next,
      events: [{ type: 'planRejected', playerId: 'p1', reason: 'gameOver' }],
    });
  });

  it('a room without monsters is not won by itself', () => {
    const state = makeState(ARENA, [playerAt('p1', 1, 1)]);
    expect(turn(state, { p1: wait }).state.status).toBe('playing');
  });
});

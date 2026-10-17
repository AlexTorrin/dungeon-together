import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../commands';
import { findPath } from '../map/pathfinding';
import { seedRng } from '../rng';
import { makeState, monsterAt, playerAt } from '../testing';
import type { Action, GameState, Plan, PlayerId } from '../types';
import { applyCommand } from './applyCommand';
import { chooseMonsterPlan } from './monsterAi';
import { isPlanValid, simulatePlan, type PlanSimulation } from './plan';

const ARENA = `
############
#@.........#
#..........#
#..........#
############
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

const right: Action = { type: 'move', direction: 'right' };
const left: Action = { type: 'move', direction: 'left' };
const wait: Action = { type: 'wait' };
const hit = (x: number, y: number): Action => ({ type: 'attack', target: { x, y } });

describe('plan helpers', () => {
  const { map } = makeState(ARENA, []);
  const at = (sim: PlanSimulation | null): unknown => sim?.before.map((a) => a.pos);

  it('pads a short plan with waiting and rejects plans over the action points', () => {
    expect(simulatePlan(map, playerAt('p1', 1, 1), [right])?.phases).toEqual([right, wait]);
    expect(simulatePlan(map, playerAt('p1', 1, 1), [right, left, wait])).toBeNull();
  });

  it('expects positions after own successful steps, stops at walls', () => {
    expect(at(simulatePlan(map, playerAt('p1', 1, 1), [right, right]))).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 },
    ]);
    expect(at(simulatePlan(map, playerAt('p1', 1, 1), [left, right]))).toEqual([
      { x: 1, y: 1 },
      { x: 1, y: 1 }, // слева стена — остаётся на месте
    ]);
  });

  it('checks a phase-2 attack from where the first step leads', () => {
    const { map } = makeState(ARENA, []);
    const p = playerAt('p1', 1, 1);
    expect(isPlanValid(map, p, [right, hit(3, 1)])).toBe(true); // с (2,1) достаёт до (3,1)
    expect(isPlanValid(map, p, [wait, hit(3, 1)])).toBe(false); // с (1,1) — нет
    expect(isPlanValid(map, p, [])).toBe(false);
  });
});

describe('two phases per turn', () => {
  it('two steps in one turn, each phase reported', () => {
    const state = makeState(ARENA, [playerAt('p1', 1, 1)]);
    const { state: next, events } = turn(state, { p1: [right, right] });
    expect(next.actors['p1']?.pos).toEqual({ x: 3, y: 1 });
    expect(events.filter((e) => e.type === 'moved')).toHaveLength(2);
    expect(events.filter((e) => e.type === 'phaseResolved')).toEqual([
      { type: 'phaseResolved', phase: 1 },
      { type: 'phaseResolved', phase: 2 },
    ]);
    expect(next.turn).toBe(2);
  });

  it('step then attack: the attack lands after the step', () => {
    const state = makeState(ARENA, [playerAt('p1', 1, 1), playerAt('p2', 3, 1)]);
    const { state: next } = turn(state, { p1: [right, hit(3, 1)], p2: [wait, wait] });
    expect(next.actors['p2']?.hp).toBe(9);
  });

  it('hit and run: attack in phase 1, then step away', () => {
    const state = makeState(ARENA, [playerAt('p1', 1, 1), playerAt('p2', 2, 1)]);
    const { state: next } = turn(state, {
      p1: [hit(2, 1), { type: 'move', direction: 'down' }],
      p2: [wait, wait],
    });
    expect(next.actors['p2']?.hp).toBe(9);
    expect(next.actors['p1']?.pos).toEqual({ x: 1, y: 2 });
  });

  it('timing matters: leaving in phase 1 dodges a phase-2 blow, leaving in phase 2 does not', () => {
    const start = (): GameState => makeState(ARENA, [playerAt('p1', 1, 1), playerAt('p2', 2, 1)]);
    const dodged = turn(start(), { p1: [wait, hit(2, 1)], p2: [right, wait] }).state;
    expect(dodged.actors['p2']?.hp).toBe(10);
    const caught = turn(start(), { p1: [hit(2, 1), wait], p2: [wait, right] }).state;
    expect(caught.actors['p2']?.hp).toBe(9);
  });

  it('killed in phase 1 does not act in phase 2', () => {
    const state = makeState(ARENA, [playerAt('p1', 1, 1), playerAt('p2', 2, 1, { hp: 1 })]);
    const { state: next, events } = turn(state, { p1: [hit(2, 1), wait], p2: [wait, hit(1, 1)] });
    expect(next.actors['p2']).toBeUndefined();
    expect(next.actors['p1']?.hp).toBe(10);
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'attacked', actorId: 'p2' }));
  });

  it('a phase-2 attack that no longer reaches fizzles into waiting', () => {
    // p1 рассчитывал шагнуть на (2,1) и ударить (3,1), но (2,1) занял стоящий p2.
    const state = makeState(ARENA, [
      playerAt('p1', 1, 1),
      playerAt('p2', 2, 1),
      playerAt('p3', 3, 1),
    ]);
    const { state: next, events } = turn(state, {
      p1: [right, hit(3, 1)],
      p2: [wait, wait],
      p3: [wait, wait],
    });
    expect(next.actors['p1']?.pos).toEqual({ x: 1, y: 1 });
    expect(next.actors['p3']?.hp).toBe(10);
    expect(events).not.toContainEqual(expect.objectContaining({ type: 'attacked', actorId: 'p1' }));
  });

  it('ignores invalid plans: too long, or an attack out of reach', () => {
    const state = makeState(ARENA, [playerAt('p1', 1, 1)]);
    const rejected = {
      state,
      events: [{ type: 'planRejected', playerId: 'p1', reason: 'invalidPlan' }],
    };
    expect(turn(state, { p1: [right, right, right] })).toEqual(rejected);
    expect(turn(state, { p1: [wait, hit(5, 1)] })).toEqual(rejected);
  });
});

describe('cancelPlan', () => {
  const two = (): GameState => makeState(ARENA, [playerAt('p1', 1, 1), playerAt('p2', 1, 3)]);

  it('takes back a submitted plan before the turn resolves; a new one is accepted', () => {
    const submitted = turn(two(), { p1: [right, right] }).state;
    const cancelled = applyCommand(submitted, { type: 'cancelPlan', playerId: 'p1' });
    expect(cancelled.events).toEqual([{ type: 'planCancelled', playerId: 'p1', turn: 1 }]);
    expect(cancelled.state.pendingPlans).toEqual({});
    const { state: next } = turn(cancelled.state, { p1: [wait, wait], p2: [wait, wait] });
    expect(next.actors['p1']?.pos).toEqual({ x: 1, y: 1 });
  });

  it('does nothing without a submitted plan', () => {
    const state = two();
    expect(applyCommand(state, { type: 'cancelPlan', playerId: 'p1' })).toEqual({
      state,
      events: [],
    });
  });
});

describe('monster plans', () => {
  it('a chasing monster plans two steps toward the player', () => {
    const state = makeState(ARENA, [playerAt('p1', 1, 1), monsterAt('m', 'skull', 7, 1)]);
    const monster = state.actors['m'];
    if (monster?.kind !== 'monster') throw new Error('no monster');
    const [plan] = chooseMonsterPlan(state, monster, seedRng(1));
    expect(plan.map((a) => a.type)).toEqual(['move', 'move']);
    const { state: next } = turn(state, { p1: [wait, wait] });
    const after = next.actors['m']?.pos;
    expect(after && findPath(next.map, after, { x: 1, y: 1 })).toHaveLength(4);
  });

  it('a monster next to a player attacks in both phases', () => {
    const state = makeState(ARENA, [playerAt('p1', 1, 1), monsterAt('m', 'skull', 2, 1)]);
    const monster = state.actors['m'];
    if (monster?.kind !== 'monster') throw new Error('no monster');
    const [plan] = chooseMonsterPlan(state, monster, seedRng(3));
    expect(plan.map((a) => a.type)).toEqual(['attack', 'attack']);
  });
});

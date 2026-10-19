import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../commands';
import { getTile, setTile } from '../map/gameMap';
import { makeState, monsterAt, playerAt, weapon } from '../testing';
import type { Action, GameState, Plan, PlayerId } from '../types';
import { applyCommand } from './applyCommand';

// Дверь — в верхней стене над (4,1); монстр далеко, чтобы уровень не кончался победой сам.
const ROOM = `
##########
#@.......#
#........#
##########
`;
const DOOR = { x: 4, y: 0 };

function withDoor(state: GameState, open = false): GameState {
  // Открытая дверь — проход: в карте на её месте пол.
  const map = open ? setTile(state.map, DOOR, 'floor') : state.map;
  return { ...state, map, door: { pos: DOOR, open } };
}

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
const up: Action = { type: 'move', direction: 'up' };
const far = (): ReturnType<typeof monsterAt> => monsterAt('far', 'skull', 8, 2);

describe('coins and keys', () => {
  it('are picked up into counters, not the backpack', () => {
    const state = makeState(
      ROOM,
      [playerAt('p1', 1, 1), far()],
      [
        { id: 'c', kind: 'coins', amount: 2, pos: { x: 2, y: 1 } },
        { id: 'k', kind: 'key', pos: { x: 2, y: 1 } },
      ],
    );
    const { state: next } = turn(state, { p1: [right, wait] });
    expect(next.actors['p1']).toMatchObject({ coins: 2, keys: 1, backpack: [] });
    expect(next.items).toEqual({});
  });

  it('can be dropped for a teammate: coins as a pile, the key as an item', () => {
    const state = makeState(ROOM, [playerAt('p1', 1, 1, { coins: 3, keys: 1 }), far()]);
    const { state: next, events } = turn(state, {
      p1: [{ type: 'dropCoins', amount: 2 }, { type: 'dropKey' }],
    });
    expect(next.actors['p1']).toMatchObject({ coins: 1, keys: 0 });
    const dropped = Object.values(next.items).map((i) =>
      i.kind === 'coins'
        ? { kind: i.kind, amount: i.amount, pos: i.pos }
        : { kind: i.kind, pos: i.pos },
    );
    expect(dropped).toEqual([
      { kind: 'coins', amount: 2, pos: { x: 1, y: 1 } },
      { kind: 'key', pos: { x: 1, y: 1 } },
    ]);
    expect(events.filter((e) => e.type === 'itemDropped')).toHaveLength(2);
  });

  it('rejects dropping more coins than you have, or a key you do not have', () => {
    const state = makeState(ROOM, [playerAt('p1', 1, 1, { coins: 1 }), far()]);
    const rejected = [{ type: 'planRejected', playerId: 'p1', reason: 'invalidPlan' }];
    expect(turn(state, { p1: [{ type: 'dropCoins', amount: 2 }] }).events).toEqual(rejected);
    expect(turn(state, { p1: [{ type: 'dropKey' }] }).events).toEqual(rejected);
  });

  it('a killed monster drops its weapon, coins and key', () => {
    const state = makeState(ROOM, [
      playerAt('p1', 1, 1, { weapon: weapon('k', 'knife') }),
      monsterAt('m', 'skull', 2, 1, { hp: 1, coins: 2, keys: 1, weapon: weapon('b', 'bow') }),
      far(),
    ]);
    const { state: next } = turn(state, { p1: [{ type: 'attack', target: { x: 2, y: 1 } }] });
    const kinds = Object.values(next.items)
      .map((i) => i.kind)
      .sort();
    expect(kinds).toEqual(['coins', 'key', 'weapon']);
    expect(Object.values(next.items).find((i) => i.kind === 'coins')).toMatchObject({ amount: 2 });
  });
});

describe('the exit door', () => {
  it('opens with a key from next to it; the key is spent and the wall becomes a passage', () => {
    const state = withDoor(makeState(ROOM, [playerAt('p1', 4, 1, { keys: 1 }), far()]));
    const { state: next, events } = turn(state, { p1: [{ type: 'openDoor' }, wait] });
    expect(next.door).toEqual({ pos: DOOR, open: true });
    expect(getTile(next.map, DOOR)).toBe('floor');
    expect(next.actors['p1']?.keys).toBe(0);
    expect(events).toContainEqual({ type: 'doorOpened', actorId: 'p1', at: DOOR });
  });

  it('cannot be opened without a key or from afar', () => {
    const rejected = [{ type: 'planRejected', playerId: 'p1', reason: 'invalidPlan' }];
    const noKey = withDoor(makeState(ROOM, [playerAt('p1', 4, 1), far()]));
    expect(turn(noKey, { p1: [{ type: 'openDoor' }] }).events).toEqual(rejected);
    const afar = withDoor(makeState(ROOM, [playerAt('p1', 1, 2, { keys: 1 }), far()]));
    expect(turn(afar, { p1: [{ type: 'openDoor' }] }).events).toEqual(rejected);
  });

  it('a player stepping into the open door leaves the level with everything carried', () => {
    const state = withDoor(
      makeState(ROOM, [
        playerAt('p1', 4, 1, { keys: 1, coins: 3, weapon: weapon('k', 'knife') }),
        far(),
      ]),
    );
    const { state: next, events } = turn(state, { p1: [{ type: 'openDoor' }, up] });
    expect(next.actors['p1']).toBeUndefined();
    expect(next.escaped['p1']).toEqual({
      coins: 3,
      weapon: { id: 'k', type: 'knife' },
      armor: null,
      backpack: [],
    });
    expect(events).toContainEqual({ type: 'exited', actorId: 'p1', at: DOOR });
    expect(next.status).toBe('won'); // на уровне никого, кто-то вышел — уровень пройден
  });

  it('with two players the level goes on until nobody is left on it', () => {
    const state = withDoor(
      makeState(ROOM, [playerAt('p1', 4, 1), playerAt('p2', 5, 1), far()]),
      true,
    );
    const first = turn(state, { p1: [up, wait], p2: [wait, wait] }).state;
    expect(first.escaped['p1']).toBeDefined();
    expect(first.status).toBe('playing'); // p2 ещё на уровне
    const second = turn(first, { p2: [{ type: 'move', direction: 'left' }, up] }).state;
    expect(second.escaped['p2']).toBeDefined();
    expect(second.status).toBe('won');
  });
});

describe('end of level', () => {
  it('killing the last monster passes the level; the living carry their loot out', () => {
    const state = makeState(ROOM, [
      playerAt('p1', 1, 1, { coins: 2, weapon: weapon('k', 'knife') }),
      monsterAt('m', 'skull', 2, 1, { hp: 1 }),
    ]);
    const { state: next } = turn(state, { p1: [{ type: 'attack', target: { x: 2, y: 1 } }] });
    expect(next.status).toBe('won');
    expect(next.escaped['p1']).toMatchObject({ coins: 2 });
  });

  it('everyone dead and nobody escaped is a loss', () => {
    const state = makeState(ROOM, [playerAt('p1', 1, 1, { hp: 1 }), monsterAt('m', 'skull', 2, 1)]);
    let next = state;
    for (let i = 0; i < 5 && next.status === 'playing'; i++)
      next = turn(next, { p1: [wait, wait] }).state;
    expect(next.status).toBe('lost');
    expect(next.escaped).toEqual({});
  });
});

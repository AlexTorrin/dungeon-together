import { describe, expect, it } from 'vitest';
import { makeState, monsterAt, playerAt, weapon } from '../testing';
import type { GameState } from '../types';
import { applyCommand } from './applyCommand';

const ROOM = `
########
#@.....#
#......#
########
`;

const twoPlayers = (): GameState =>
  makeState(ROOM, [
    playerAt('p1', 1, 1, {
      weapon: weapon('w1', 'bow'),
      backpack: [weapon('w2', 'knife')],
      coins: 2,
      keys: 1,
    }),
    playerAt('p2', 3, 1),
    monsterAt('m1', 'skull', 6, 2),
  ]);

describe('leave', () => {
  it('ушедший исчезает с уровня, всё, что нёс, падает на его клетку', () => {
    const { state, events } = applyCommand(twoPlayers(), { type: 'leave', playerId: 'p1' });
    expect(state.actors['p1']).toBeUndefined();
    expect(events[0]).toEqual({ type: 'playerLeft', playerId: 'p1', at: { x: 1, y: 1 } });
    const dropped = Object.values(state.items).filter((i) => i.pos.x === 1 && i.pos.y === 1);
    expect(dropped.map((i) => i.kind).sort()).toEqual(['coins', 'key', 'weapon', 'weapon']);
    expect(dropped.find((i) => i.kind === 'coins')).toMatchObject({ amount: 2 });
    expect(state.status).toBe('playing');
    expect(state.escaped['p1']).toBeUndefined();
  });

  it('если остальные уже ждут — ход разрешается сразу', () => {
    let state = twoPlayers();
    state = applyCommand(state, {
      type: 'submitPlan',
      playerId: 'p2',
      plan: [{ type: 'wait' }],
    }).state;
    const { state: next, events } = applyCommand(state, { type: 'leave', playerId: 'p1' });
    expect(events.some((e) => e.type === 'turnResolved')).toBe(true);
    expect(next.turn).toBe(state.turn + 1);
    expect(next.pendingPlans).toEqual({});
  });

  it('план ушедшего отзывается и не ждётся', () => {
    let state = twoPlayers();
    state = applyCommand(state, {
      type: 'submitPlan',
      playerId: 'p1',
      plan: [{ type: 'wait' }],
    }).state;
    const { state: next, events } = applyCommand(state, { type: 'leave', playerId: 'p1' });
    expect(next.pendingPlans).toEqual({});
    expect(events.some((e) => e.type === 'turnResolved')).toBe(false);
  });

  it('ушёл последний — поражение, а если кто-то вышел дверью — победа', () => {
    const solo = makeState(ROOM, [playerAt('p1', 1, 1), monsterAt('m1', 'skull', 6, 2)]);
    const lost = applyCommand(solo, { type: 'leave', playerId: 'p1' });
    expect(lost.state.status).toBe('lost');
    expect(lost.events.at(-1)).toEqual({ type: 'gameOver', status: 'lost' });

    const withEscaped: GameState = {
      ...solo,
      escaped: { p2: { coins: 1, weapon: null, armor: null, backpack: [] } },
    };
    expect(applyCommand(withEscaped, { type: 'leave', playerId: 'p1' }).state.status).toBe('won');
  });

  it('неизвестный игрок, монстр или конец игры — ничего не происходит', () => {
    const state = twoPlayers();
    expect(applyCommand(state, { type: 'leave', playerId: 'nobody' }).events).toEqual([]);
    expect(applyCommand(state, { type: 'leave', playerId: 'm1' }).events).toEqual([]);
    const over: GameState = { ...state, status: 'lost' };
    expect(applyCommand(over, { type: 'leave', playerId: 'p1' }).events).toEqual([]);
  });
});

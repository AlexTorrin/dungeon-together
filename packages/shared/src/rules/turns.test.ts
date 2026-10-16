import { describe, expect, it } from 'vitest';
import { parseRoom } from '../map/room';
import { createGameState } from '../state/createGameState';
import type { Action, GameState, PlayerId, Position } from '../types';
import { applyCommand } from './applyCommand';

const room = parseRoom(`
######
#@...#
#..#.#
######
`);

/** Состояние с игроками в явно заданных позициях. */
function stateWith(positions: Record<PlayerId, Position>): GameState {
  const base = createGameState(room, []);
  const players = Object.fromEntries(
    Object.entries(positions).map(([id, pos]) => [id, { id, pos }]),
  );
  return { ...base, players };
}

function submit(state: GameState, playerId: PlayerId, action: Action) {
  return applyCommand(state, { type: 'submitAction', playerId, action });
}

const move = (direction: 'up' | 'down' | 'left' | 'right'): Action => ({ type: 'move', direction });
const posOf = (state: GameState, id: PlayerId) => state.players[id]?.pos;

describe('turn order: single player', () => {
  it('resolves the turn immediately', () => {
    const state = stateWith({ p1: { x: 1, y: 1 } });
    const { state: next, events } = submit(state, 'p1', move('right'));

    expect(posOf(next, 'p1')).toEqual({ x: 2, y: 1 });
    expect(next.turn).toBe(2);
    expect(next.pendingActions).toEqual({});
    expect(events.map((e) => e.type)).toEqual(['actionSubmitted', 'moved', 'turnResolved']);
  });

  it('bumps into walls and still finishes the turn', () => {
    const { state: next, events } = submit(stateWith({ p1: { x: 1, y: 1 } }), 'p1', move('up'));
    expect(posOf(next, 'p1')).toEqual({ x: 1, y: 1 });
    expect(next.turn).toBe(2);
    expect(events).toContainEqual({
      type: 'bumped',
      actorId: 'p1',
      at: { x: 1, y: 0 },
      direction: 'up',
      reason: 'wall',
    });
  });

  it('supports waiting', () => {
    const { state: next, events } = submit(stateWith({ p1: { x: 1, y: 1 } }), 'p1', {
      type: 'wait',
    });
    expect(next.turn).toBe(2);
    expect(events).toContainEqual({ type: 'waited', actorId: 'p1' });
  });
});

describe('turn order: several players', () => {
  it('waits until every player has chosen', () => {
    const state = stateWith({ p1: { x: 1, y: 1 }, p2: { x: 1, y: 2 } });
    const first = submit(state, 'p1', move('right'));

    expect(posOf(first.state, 'p1')).toEqual({ x: 1, y: 1 });
    expect(first.state.turn).toBe(1);
    expect(first.events).toEqual([{ type: 'actionSubmitted', playerId: 'p1', turn: 1 }]);

    const second = submit(first.state, 'p2', move('right'));
    expect(posOf(second.state, 'p1')).toEqual({ x: 2, y: 1 });
    expect(posOf(second.state, 'p2')).toEqual({ x: 2, y: 2 });
    expect(second.state.turn).toBe(2);
  });

  it('locks the first choice: a second submit in the same turn is ignored', () => {
    const state = stateWith({ p1: { x: 1, y: 1 }, p2: { x: 1, y: 2 } });
    const first = submit(state, 'p1', move('right'));
    const again = submit(first.state, 'p1', move('down'));
    expect(again).toEqual({ state: first.state, events: [] });
  });

  it('ignores unknown players', () => {
    const state = stateWith({ p1: { x: 1, y: 1 } });
    expect(submit(state, 'ghost', move('right'))).toEqual({ state, events: [] });
  });

  it('does not depend on the order in which players chose', () => {
    const state = stateWith({ p1: { x: 1, y: 1 }, p2: { x: 2, y: 1 } });
    const a = submit(submit(state, 'p1', move('right')).state, 'p2', move('right')).state;
    const b = submit(submit(state, 'p2', move('right')).state, 'p1', move('right')).state;
    expect(a.players).toEqual(b.players);
  });
});

describe('simultaneous move conflicts', () => {
  function resolve(positions: Record<PlayerId, Position>, actions: Record<PlayerId, Action>) {
    let state = stateWith(positions);
    let events: ReturnType<typeof submit>['events'] = [];
    for (const [id, action] of Object.entries(actions)) {
      const result = submit(state, id, action);
      state = result.state;
      events = [...events, ...result.events];
    }
    return { state, events };
  }

  it('follows a player who leaves the tile in the same turn (chain)', () => {
    const { state } = resolve(
      { p1: { x: 1, y: 1 }, p2: { x: 2, y: 1 }, p3: { x: 3, y: 1 } },
      { p1: move('right'), p2: move('right'), p3: move('right') },
    );
    expect(posOf(state, 'p1')).toEqual({ x: 2, y: 1 });
    expect(posOf(state, 'p2')).toEqual({ x: 3, y: 1 });
    expect(posOf(state, 'p3')).toEqual({ x: 4, y: 1 });
  });

  it('blocks everyone when the head of the chain is blocked', () => {
    const { state, events } = resolve(
      { p1: { x: 2, y: 1 }, p2: { x: 3, y: 1 }, p3: { x: 4, y: 1 } },
      { p1: move('right'), p2: move('right'), p3: move('right') },
    );
    expect(posOf(state, 'p1')).toEqual({ x: 2, y: 1 });
    expect(posOf(state, 'p2')).toEqual({ x: 3, y: 1 });
    expect(events).toContainEqual(expect.objectContaining({ actorId: 'p3', reason: 'wall' }));
    expect(events).toContainEqual(expect.objectContaining({ actorId: 'p2', reason: 'occupied' }));
    expect(events).toContainEqual(expect.objectContaining({ actorId: 'p1', reason: 'occupied' }));
  });

  it('bounces both players contesting the same tile', () => {
    const { state, events } = resolve(
      { p1: { x: 1, y: 1 }, p2: { x: 2, y: 2 } },
      { p1: move('right'), p2: move('up') },
    );
    expect(posOf(state, 'p1')).toEqual({ x: 1, y: 1 });
    expect(posOf(state, 'p2')).toEqual({ x: 2, y: 2 });
    expect(events.filter((e) => e.type === 'bumped' && e.reason === 'contested')).toHaveLength(2);
  });

  it('does not let two players swap places', () => {
    const { state, events } = resolve(
      { p1: { x: 1, y: 1 }, p2: { x: 2, y: 1 } },
      { p1: move('right'), p2: move('left') },
    );
    expect(posOf(state, 'p1')).toEqual({ x: 1, y: 1 });
    expect(posOf(state, 'p2')).toEqual({ x: 2, y: 1 });
    expect(events.filter((e) => e.type === 'bumped' && e.reason === 'swap')).toHaveLength(2);
  });

  it('blocks a move into a player who waits', () => {
    const { state, events } = resolve(
      { p1: { x: 1, y: 1 }, p2: { x: 2, y: 1 } },
      { p1: move('right'), p2: { type: 'wait' } },
    );
    expect(posOf(state, 'p1')).toEqual({ x: 1, y: 1 });
    expect(events).toContainEqual(expect.objectContaining({ actorId: 'p1', reason: 'occupied' }));
  });
});

describe('createGameState', () => {
  it('puts players on distinct floor tiles nearest to spawn', () => {
    const state = createGameState(room, ['p1', 'p2', 'p3']);
    const positions = Object.values(state.players).map((p) => `${p.pos.x},${p.pos.y}`);
    expect(positions[0]).toBe('1,1');
    expect(new Set(positions).size).toBe(3);
  });

  it('throws when the room is too small', () => {
    expect(() => createGameState(parseRoom('#@#'), ['p1', 'p2'])).toThrow(/room for 1/);
  });
});

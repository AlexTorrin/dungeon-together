import { describe, expect, it } from 'vitest';
import { parseRoom } from '../map/room';
import { createGameState } from '../state/createGameState';
import { PLAYER_MAX_HP } from '../config/actors';
import type { Action, Actor, GameState, PlayerId, Position, Room } from '../types';
import { applyCommand } from './applyCommand';

const room = parseRoom(`
######
#@...#
#..#.#
######
`);

const player = (id: PlayerId, pos: Position): Actor => ({
  kind: 'player',
  id,
  pos,
  hp: PLAYER_MAX_HP,
  maxHp: PLAYER_MAX_HP,
  weapon: null,
});

/** Состояние с игроками в явно заданных позициях. */
function stateWith(positions: Record<PlayerId, Position>): GameState {
  const base = createGameState(room, []);
  const actors = Object.fromEntries(
    Object.entries(positions).map(([id, pos]) => [id, player(id, pos)]),
  );
  return { ...base, actors };
}

function submit(state: GameState, playerId: PlayerId, action: Action) {
  return applyCommand(state, { type: 'submitAction', playerId, action });
}

const move = (direction: 'up' | 'down' | 'left' | 'right'): Action => ({ type: 'move', direction });
const posOf = (state: GameState, id: PlayerId) => state.actors[id]?.pos;

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
    expect(a.actors).toEqual(b.actors);
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
    const positions = Object.values(state.actors).map((p) => `${p.pos.x},${p.pos.y}`);
    expect(positions[0]).toBe('1,1');
    expect(new Set(positions).size).toBe(3);
  });

  it('throws when the room is too small', () => {
    expect(() => createGameState(parseRoom('#@#'), ['p1', 'p2'])).toThrow(/room for 1/);
  });

  it('creates players with full hp and no weapon, game in progress', () => {
    const state = createGameState(room, ['p1']);
    expect(state.actors['p1']).toEqual(player('p1', { x: 1, y: 1 }));
    expect(state.status).toBe('playing');
    expect(state.items).toEqual({});
  });

  it('places monsters and items from the room and keeps players off monster tiles', () => {
    const withMonster: Room = {
      ...room,
      monsters: [{ species: 'skull', pos: { x: 1, y: 1 } }],
      items: [{ type: 'bone', pos: { x: 4, y: 1 } }],
    };
    const state = createGameState(withMonster, ['p1']);
    expect(state.actors['monster-1']).toEqual({
      kind: 'monster',
      id: 'monster-1',
      species: 'skull',
      pos: { x: 1, y: 1 },
      hp: 3,
      maxHp: 3,
      weapon: null,
    });
    expect(state.actors['p1']?.pos).not.toEqual({ x: 1, y: 1 });
    expect(state.items).toEqual({ 'item-1': { id: 'item-1', type: 'bone', pos: { x: 4, y: 1 } } });
  });

  it('rejects duplicate player ids', () => {
    expect(() => createGameState(room, ['p1', 'p1'])).toThrow(/Duplicate/);
  });
});

describe('attack (combat is not implemented yet)', () => {
  const attack = (direction: 'up' | 'down' | 'left' | 'right'): Action => ({
    type: 'attack',
    direction,
  });

  it('does not move the attacker', () => {
    const { state: next, events } = submit(
      stateWith({ p1: { x: 1, y: 1 } }),
      'p1',
      attack('right'),
    );
    expect(posOf(next, 'p1')).toEqual({ x: 1, y: 1 });
    expect(events).toContainEqual({ type: 'waited', actorId: 'p1' });
    expect(next.turn).toBe(2);
  });

  it('does not reserve the target tile: another player can step into it', () => {
    let state = stateWith({ p1: { x: 1, y: 1 }, p2: { x: 2, y: 2 } });
    state = submit(state, 'p1', attack('right')).state;
    state = submit(state, 'p2', move('up')).state;
    expect(posOf(state, 'p2')).toEqual({ x: 2, y: 1 });
  });

  it('blocks a move into the attacker, who stays in place', () => {
    let state = stateWith({ p1: { x: 1, y: 1 }, p2: { x: 2, y: 1 } });
    state = submit(state, 'p1', attack('down')).state;
    const { events } = submit(state, 'p2', move('left'));
    expect(events).toContainEqual(expect.objectContaining({ actorId: 'p2', reason: 'occupied' }));
  });
});

describe('monsters in the turn', () => {
  const withSkull = (): GameState => {
    const base = stateWith({ p1: { x: 1, y: 1 } });
    const state = createGameState(
      { ...room, monsters: [{ species: 'skull', pos: { x: 2, y: 1 } }] },
      [],
    );
    return { ...base, actors: { ...base.actors, ...state.actors } };
  };

  it('does not wait for monsters and treats them as obstacles', () => {
    const { state, events } = submit(withSkull(), 'p1', move('right'));
    expect(state.turn).toBe(2);
    expect(posOf(state, 'p1')).toEqual({ x: 1, y: 1 });
    expect(events).toContainEqual(expect.objectContaining({ actorId: 'p1', reason: 'occupied' }));
    expect(events).toContainEqual({ type: 'waited', actorId: 'monster-1' });
  });

  it('ignores actions submitted for a monster', () => {
    const state = withSkull();
    expect(submit(state, 'monster-1', move('left'))).toEqual({ state, events: [] });
  });
});

describe('submitAction guards', () => {
  it.each(['constructor', '__proto__', 'toString', 'hasOwnProperty'])(
    'ignores prototype key %s as player id',
    (id) => {
      const state = stateWith({ p1: { x: 1, y: 1 } });
      expect(submit(state, id, move('right'))).toEqual({ state, events: [] });
    },
  );

  it('ignores actions after the game is over', () => {
    const state: GameState = { ...stateWith({ p1: { x: 1, y: 1 } }), status: 'lost' };
    expect(submit(state, 'p1', move('right'))).toEqual({ state, events: [] });
  });

  it('does not mutate the input state', () => {
    const state = stateWith({ p1: { x: 1, y: 1 }, p2: { x: 1, y: 2 } });
    const snapshot: unknown = JSON.parse(JSON.stringify(state));
    const first = submit(state, 'p1', move('right'));
    submit(first.state, 'p2', move('right'));
    expect(state).toEqual(snapshot);
  });
});

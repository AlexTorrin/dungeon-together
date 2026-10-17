import { describe, expect, it } from 'vitest';
import { parseRoom } from './map/room';
import { MAX_PLAYER_ID_LENGTH, parseAction, parseCommand } from './parseCommand';
import { applyCommand } from './rules/applyCommand';
import { createGameState } from './state/createGameState';

/** Как данные придут по сети: строка JSON → unknown. */
const fromJson = (json: string): unknown => JSON.parse(json);

describe('parseAction', () => {
  it.each([
    [{ type: 'wait' }, { type: 'wait' }],
    [
      { type: 'move', direction: 'up' },
      { type: 'move', direction: 'up' },
    ],
    [
      { type: 'move', direction: 'upLeft' },
      { type: 'move', direction: 'upLeft' },
    ],
    [
      { type: 'attack', target: { x: 3, y: -1 } },
      { type: 'attack', target: { x: 3, y: -1 } },
    ],
  ])('accepts %j', (raw, expected) => {
    expect(parseAction(raw)).toEqual(expected);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a string', 'wait'],
    ['a number', 42],
    ['an array', [{ type: 'wait' }]],
    ['no type', { direction: 'up' }],
    ['unknown type', { type: 'teleport', direction: 'up' }],
    ['move without direction', { type: 'move' }],
    ['unknown direction', { type: 'move', direction: 'sideways' }],
    ['direction of wrong type', { type: 'move', direction: 1 }],
    ['attack by direction', { type: 'attack', direction: 'left' }],
    ['attack without target', { type: 'attack' }],
    ['fractional target', { type: 'attack', target: { x: 1.5, y: 2 } }],
    ['string target coords', { type: 'attack', target: { x: '1', y: 2 } }],
    ['huge target coords', { type: 'attack', target: { x: 1e300, y: 2 } }],
    ['inherited type', Object.create({ type: 'wait' }) as unknown],
  ])('rejects %s', (_name, raw) => {
    expect(parseAction(raw)).toBeNull();
  });

  it('keeps only known fields', () => {
    const parsed = parseAction({ type: 'move', direction: 'down', hp: 999, extra: { a: 1 } });
    expect(parsed).toStrictEqual({ type: 'move', direction: 'down' });
    expect(parseAction({ type: 'wait', direction: 'up' })).toStrictEqual({ type: 'wait' });
    expect(parseAction({ type: 'attack', target: { x: 1, y: 2, z: 3 } })).toStrictEqual({
      type: 'attack',
      target: { x: 1, y: 2 },
    });
  });
});

describe('parseCommand', () => {
  const valid = { type: 'submitAction', playerId: 'p1', action: { type: 'wait' } };

  it('accepts a well-formed command', () => {
    expect(parseCommand(valid)).toStrictEqual(valid);
  });

  it.each([
    ['null', null],
    ['an array', [valid]],
    ['unknown command type', { ...valid, type: 'cheat' }],
    ['missing playerId', { type: 'submitAction', action: { type: 'wait' } }],
    ['non-string playerId', { ...valid, playerId: 1 }],
    ['empty playerId', { ...valid, playerId: '' }],
    ['too long playerId', { ...valid, playerId: 'x'.repeat(MAX_PLAYER_ID_LENGTH + 1) }],
    ['missing action', { type: 'submitAction', playerId: 'p1' }],
    ['bad action', { ...valid, action: { type: 'move', direction: 'sideways' } }],
  ])('rejects %s', (_name, raw) => {
    expect(parseCommand(raw)).toBeNull();
  });

  it('builds a fresh object: extra fields and __proto__ from JSON do not get through', () => {
    const raw = fromJson(
      '{"type":"submitAction","playerId":"p1","action":{"type":"wait","__proto__":{"x":1}},' +
        '"__proto__":{"polluted":true},"turn":999}',
    );
    const parsed = parseCommand(raw);
    expect(parsed).toStrictEqual(valid);
    expect(Object.getPrototypeOf(parsed)).toBe(Object.prototype);
    expect(Object.getPrototypeOf(parsed?.action)).toBe(Object.prototype);
  });
});

describe('parseCommand + applyCommand', () => {
  it('a junk direction never reaches the turn, so it cannot block the other players', () => {
    let state = createGameState(parseRoom('#####\n#@..#\n#...#\n#####'), ['p1', 'p2'], 1);
    const junk = parseCommand(
      fromJson('{"type":"submitAction","playerId":"p1","action":{"type":"move","direction":"x"}}'),
    );
    expect(junk).toBeNull();

    for (const json of [
      '{"type":"submitAction","playerId":"p1","action":{"type":"wait"}}',
      '{"type":"submitAction","playerId":"p2","action":{"type":"wait"}}',
    ]) {
      const command = parseCommand(fromJson(json));
      if (!command) throw new Error(`should parse: ${json}`);
      state = applyCommand(state, command).state;
    }
    expect(state.turn).toBe(2);
  });
});

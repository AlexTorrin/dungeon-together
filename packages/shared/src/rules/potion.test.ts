import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../commands';
import { generateLevel } from '../map/generateLevel';
import { parseRoom, serializeRoom } from '../map/room';
import { makeState, monsterAt, playerAt, potion, weapon } from '../testing';
import type { GameState, Plan, PlayerId } from '../types';
import { applyCommand } from './applyCommand';
import { isPlanValid } from './plan';

const ROOM = `
#######
#@....#
#.....#
#######
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

const drink = { type: 'drink', itemId: 'h1' } as const;
const wait = { type: 'wait' } as const;

describe('баночка лечения', () => {
  it('возвращает половину максимума HP, не выше максимума, и исчезает', () => {
    const state = makeState(ROOM, [playerAt('p1', 1, 1, { hp: 3, backpack: [potion('h1')] })]);
    const { state: next, events } = turn(state, { p1: [drink] });
    expect(next.actors['p1']).toMatchObject({ hp: 8, backpack: [] });
    expect(events).toContainEqual({ type: 'drank', actorId: 'p1', itemId: 'h1', healed: 5, hp: 8 });

    const almostFull = makeState(ROOM, [playerAt('p1', 1, 1, { hp: 8, backpack: [potion('h1')] })]);
    expect(turn(almostFull, { p1: [drink] }).state.actors['p1']?.hp).toBe(10);
  });

  it('стоит 2 ОД: вместе с другим действием в план не влезает', () => {
    const state = makeState(ROOM, [playerAt('p1', 1, 1, { backpack: [potion('h1')] })]);
    const me = state.actors['p1'];
    if (!me) throw new Error('нет игрока');
    expect(isPlanValid(state, me, [drink])).toBe(true);
    expect(isPlanValid(state, me, [drink, wait])).toBe(false);
    expect(isPlanValid(state, me, [{ type: 'drink', itemId: 'нет' }])).toBe(false);
  });

  it('лечит во второй фазе, раньше ударов этой фазы', () => {
    const state = makeState(ROOM, [
      playerAt('p1', 1, 1, { hp: 2, backpack: [potion('h1')] }),
      playerAt('p2', 2, 1, { weapon: weapon('k', 'knife') }),
    ]);
    // Удар ножом (3) во второй фазе: без баночки 2 HP — смерть, с баночкой 2 + 5 − 3 = 4.
    const hit = { type: 'attack', target: { x: 1, y: 1 } } as const;
    const { state: next } = turn(state, { p1: [drink], p2: [wait, hit] });
    expect(next.actors['p1']?.hp).toBe(4);
  });

  it('в руки не берётся — ни в забеге, ни в плане', () => {
    const state = makeState(ROOM, [playerAt('p1', 1, 1, { backpack: [potion('h1')] })]);
    const me = state.actors['p1'];
    if (!me) throw new Error('нет игрока');
    expect(isPlanValid(state, me, [{ type: 'equip', itemId: 'h1' }])).toBe(false);
  });

  it('подбирается в рюкзак, выбрасывается и роняется при смерти — баночкой', () => {
    let state = makeState(
      ROOM,
      [playerAt('p1', 1, 1), monsterAt('m1', 'skull', 5, 2, { hp: 1, backpack: [potion('h2')] })],
      [{ kind: 'potion', id: 'h1', pos: { x: 2, y: 1 } }],
    );
    state = turn(state, { p1: [{ type: 'move', direction: 'right' }] }).state;
    expect(state.actors['p1']?.backpack).toEqual([potion('h1')]);

    state = turn(state, { p1: [{ type: 'drop', itemId: 'h1' }] }).state;
    expect(state.items['h1']).toEqual({ kind: 'potion', id: 'h1', pos: { x: 2, y: 1 } });

    // Соседний монстр бьёт, а не уходит — удар ножом по его клетке точно попадёт.
    const dying = makeState(ROOM, [
      playerAt('p1', 1, 1, { weapon: weapon('k', 'knife') }),
      monsterAt('m1', 'skull', 2, 1, { hp: 1, backpack: [potion('h2')] }),
    ]);
    const stab = { type: 'attack', target: { x: 2, y: 1 } } as const;
    const after = turn(dying, { p1: [stab] }).state;
    expect(after.items['h2']?.kind).toBe('potion');
  });

  it('в редакторе — символ p; генератор кладёт её редко (около 10% уровней)', () => {
    const room = parseRoom('####\n#@p#\n####');
    expect(room.items).toEqual([{ kind: 'potion', pos: { x: 2, y: 1 } }]);
    expect(serializeRoom(room)).toContain('p');

    const seeds = Array.from({ length: 200 }, (_, i) => i + 1);
    const withPotion = seeds.filter((seed) =>
      generateLevel(seed).items.some((i) => i.kind === 'potion'),
    ).length;
    expect(withPotion).toBeGreaterThan(5);
    expect(withPotion).toBeLessThan(45);
  });
});

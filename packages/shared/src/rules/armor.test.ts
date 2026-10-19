import { describe, expect, it } from 'vitest';
import type { GameEvent } from '../commands';
import { damageThrough } from '../config/armor';
import { generateLevel } from '../map/generateLevel';
import { parseRoom, serializeRoom } from '../map/room';
import { armor, makeState, monsterAt, playerAt, potion, weapon } from '../testing';
import type { GameState, Plan, PlayerId } from '../types';
import { applyCommand } from './applyCommand';
import { chooseMonsterAction } from './monsterAi';
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

const hit = (x: number, y: number) => ({ type: 'attack', target: { x, y } }) as const;

describe('броня', () => {
  it('срезает урон каждого удара на защиту, но не ниже 1', () => {
    expect(damageThrough(6, null)).toBe(6);
    expect(damageThrough(6, 'leather')).toBe(5);
    expect(damageThrough(6, 'mail')).toBe(4);
    expect(damageThrough(1, 'mail')).toBe(1);
    expect(damageThrough(2, 'mail')).toBe(1);
  });

  it('по надевшему проходит меньше урона — и в событии damaged тоже', () => {
    const state = makeState(ROOM, [
      playerAt('p1', 1, 1, { armor: armor('a1', 'mail') }),
      playerAt('p2', 2, 1, { weapon: weapon('k', 'knife') }),
    ]);
    const { state: next, events } = turn(state, { p1: [{ type: 'wait' }], p2: [hit(1, 1)] });
    expect(next.actors['p1']?.hp).toBe(9); // нож 3 − кольчуга 2
    expect(events).toContainEqual({ type: 'damaged', actorId: 'p1', by: 'p2', amount: 1, hp: 9 });
  });

  it('надеть — equip за 1 ОД: прежняя броня уходит в рюкзак на её место', () => {
    const state = makeState(ROOM, [
      playerAt('p1', 1, 1, {
        armor: armor('a1', 'leather'),
        backpack: [potion('h1'), armor('a2', 'mail')],
      }),
    ]);
    const me = state.actors['p1'];
    if (!me) throw new Error('нет игрока');
    const wear = { type: 'equip', itemId: 'a2' } as const;
    expect(isPlanValid(state, me, [wear, { type: 'wait' }])).toBe(true);

    const { state: next, events } = turn(state, { p1: [wear] });
    expect(next.actors['p1']).toMatchObject({
      armor: armor('a2', 'mail'),
      backpack: [potion('h1'), armor('a1', 'leather')],
      weapon: null,
    });
    expect(events).toContainEqual({ type: 'itemEquipped', actorId: 'p1', itemId: 'a2' });
  });

  it('броню не взять в руки, оружие не надеть: в руках остаётся оружие', () => {
    const state = makeState(ROOM, [
      playerAt('p1', 1, 1, {
        weapon: weapon('k', 'knife'),
        backpack: [armor('a1', 'leather'), weapon('b', 'bow')],
      }),
    ]);
    const { state: next } = turn(state, { p1: [{ type: 'equip', itemId: 'a1' }] });
    expect(next.actors['p1']).toMatchObject({
      weapon: weapon('k', 'knife'),
      armor: armor('a1', 'leather'),
      backpack: [weapon('b', 'bow')],
    });
  });

  it('снимается выбрасыванием, подбирается в рюкзак, роняется при смерти', () => {
    let state = makeState(
      ROOM,
      [playerAt('p1', 1, 1, { armor: armor('a1', 'leather') })],
      [{ kind: 'armor', id: 'a2', type: 'mail', pos: { x: 2, y: 1 } }],
    );
    state = turn(state, { p1: [{ type: 'drop', itemId: 'a1' }] }).state;
    expect(state.actors['p1']?.armor).toBeNull();
    expect(state.items['a1']).toEqual({
      kind: 'armor',
      id: 'a1',
      type: 'leather',
      pos: { x: 1, y: 1 },
    });

    state = turn(state, { p1: [{ type: 'move', direction: 'right' }] }).state;
    expect(state.actors['p1']?.backpack).toEqual([armor('a2', 'mail')]);

    const dying = makeState(ROOM, [
      playerAt('p1', 1, 1, { weapon: weapon('k', 'sword') }),
      monsterAt('m1', 'skull', 2, 1, { hp: 1, armor: armor('a3', 'mail') }),
    ]);
    const after = turn(dying, { p1: [hit(2, 1)] }).state;
    expect(after.items['a3']).toMatchObject({ kind: 'armor', type: 'mail' });
  });

  it('вынесенная броня уходит с героем (escaped)', () => {
    const state = makeState(ROOM, [
      playerAt('p1', 1, 1, { weapon: weapon('k', 'knife'), armor: armor('a1', 'leather') }),
      monsterAt('m1', 'skull', 2, 1, { hp: 1 }),
    ]);
    const { state: next } = turn(state, { p1: [hit(2, 1)] });
    expect(next.status).toBe('won');
    expect(next.escaped['p1']?.armor).toEqual(armor('a1', 'leather'));
  });

  it('монстр надевает броню из рюкзака', () => {
    const state = makeState(ROOM, [
      monsterAt('m1', 'skeleton', 5, 2, {
        weapon: weapon('k', 'knife'),
        backpack: [armor('a1', 'leather'), armor('a2', 'mail')],
      }),
    ]);
    const monster = state.actors['m1'];
    if (monster?.kind !== 'monster') throw new Error('нет монстра');
    const [action] = chooseMonsterAction(state, monster, state.rng);
    expect(action).toEqual({ type: 'equip', itemId: 'a2' });
  });

  it('в редакторе — l и c; генератор изредка кладёт броню по сложности', () => {
    const room = parseRoom('#####\n#@lc#\n#####');
    expect(room.items).toEqual([
      { kind: 'armor', type: 'leather', pos: { x: 2, y: 1 } },
      { kind: 'armor', type: 'mail', pos: { x: 3, y: 1 } },
    ]);
    expect(serializeRoom(room)).toBe('#####\n#@lc#\n#####');

    const seeds = Array.from({ length: 200 }, (_, i) => i + 1);
    const armorOf = (seed: number, difficulty: 'easy' | 'hard') =>
      generateLevel(seed, difficulty).items.flatMap((i) => (i.kind === 'armor' ? [i.type] : []));
    const easy = seeds.flatMap((seed) => armorOf(seed, 'easy'));
    expect(easy.length).toBeGreaterThan(20);
    expect(easy.length).toBeLessThan(80);
    expect(new Set(easy)).toEqual(new Set(['leather']));
    expect(new Set(seeds.flatMap((seed) => armorOf(seed, 'hard')))).toEqual(new Set(['mail']));
  });
});

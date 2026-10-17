import { describe, expect, it } from 'vitest';
import { parseRoom } from '../map/room';
import { createGameState } from '../state/createGameState';
import type { Carried } from '../types';
import { EMPTY_PROFILE, buy, finishRun, move, sell, startRun, type Profile } from './profile';

const rich: Profile = { ...EMPTY_PROFILE, coins: 10 };

describe('магазин', () => {
  it('покупка списывает цену и кладёт в рюкзак', () => {
    expect(buy(rich, 'knife')).toEqual({ ...rich, coins: 8, backpack: ['knife'] });
  });

  it('без монет и не из ассортимента купить нельзя', () => {
    expect(buy({ ...rich, coins: 1 }, 'bow')).toBeNull();
    expect(buy(rich, 'sword')).toBeNull();
  });

  it('при полном рюкзаке покупка уходит в сундук', () => {
    const full: Profile = { ...rich, backpack: ['knife', 'knife', 'bow', 'bow'] };
    expect(buy(full, 'bow')?.chest).toEqual(['bow']);
  });

  it('продажа — за полцены с округлением вниз', () => {
    const p: Profile = { ...EMPTY_PROFILE, hands: 'sword', backpack: ['knife'], chest: ['wand'] };
    expect(sell(p, { place: 'hands' })).toEqual({ ...p, hands: null, coins: 3 });
    expect(sell(p, { place: 'backpack', index: 0 })?.coins).toBe(1);
    expect(sell(p, { place: 'chest', index: 0 })?.coins).toBe(4);
    expect(sell(EMPTY_PROFILE, { place: 'hands' })).toBeNull();
  });
});

describe('перекладывание', () => {
  it('в руки — прежнее оружие встаёт на место взятого', () => {
    const p: Profile = { ...EMPTY_PROFILE, hands: 'knife', chest: ['bow', 'sword'] };
    expect(move(p, { place: 'chest', index: 1 }, 'hands')).toEqual({
      ...p,
      hands: 'sword',
      chest: ['bow', 'knife'],
    });
  });

  it('в полный рюкзак нельзя, в сундук — всегда', () => {
    const p: Profile = {
      ...EMPTY_PROFILE,
      hands: 'wand',
      backpack: ['knife', 'knife', 'bow', 'bow'],
    };
    expect(move(p, { place: 'hands' }, 'backpack')).toBeNull();
    expect(move(p, { place: 'hands' }, 'chest')).toEqual({ ...p, hands: null, chest: ['wand'] });
    expect(move(p, { place: 'chest', index: 0 }, 'hands')).toBeNull();
  });
});

describe('забег', () => {
  const p: Profile = { coins: 5, hands: 'bow', backpack: ['knife'], chest: ['sword'] };

  it('старт забирает руки и рюкзак, кошелёк и сундук остаются', () => {
    const { profile, loadout } = startRun(p);
    expect(loadout).toEqual({ weapon: 'bow', backpack: ['knife'] });
    expect(profile).toEqual({ coins: 5, hands: null, backpack: [], chest: ['sword'] });
  });

  it('вынесенное возвращается, монеты — в кошелёк; погиб — ничего', () => {
    const { profile } = startRun(p);
    const carried: Carried = {
      coins: 3,
      weapon: { id: 'item-9', type: 'wand' },
      backpack: [{ id: 'item-2', type: 'knife' }],
    };
    expect(finishRun(profile, carried)).toEqual({
      coins: 8,
      hands: 'wand',
      backpack: ['knife'],
      chest: ['sword'],
    });
    expect(finishRun(profile, undefined)).toEqual(profile);
  });

  it('вынесенное добавляется, а не заменяет: занятые руки и полный рюкзак — в сундук', () => {
    const busy: Profile = { coins: 0, hands: 'knife', backpack: ['bow', 'bow', 'bow'], chest: [] };
    const carried: Carried = {
      coins: 0,
      weapon: { id: 'item-1', type: 'sword' },
      backpack: [{ id: 'item-2', type: 'wand' }],
    };
    expect(finishRun(busy, carried)).toEqual({
      coins: 0,
      hands: 'knife',
      backpack: ['bow', 'bow', 'bow', 'sword'],
      chest: ['wand'],
    });
  });

  it('герой приходит на уровень с инвентарём из хаба', () => {
    const room = parseRoom('#####\n#@..#\n#####');
    const state = createGameState(room, ['p1', 'p2'], 1, {
      p1: { weapon: 'bow', backpack: ['knife', 'sword'] },
    });
    expect(state.actors['p1']).toMatchObject({
      weapon: { type: 'bow' },
      backpack: [{ type: 'knife' }, { type: 'sword' }],
    });
    expect(state.actors['p2']).toMatchObject({ weapon: null, backpack: [] });
    const ids = [
      state.actors['p1']?.weapon?.id,
      ...(state.actors['p1']?.backpack ?? []).map((i) => i.id),
    ];
    expect(new Set(ids).size).toBe(3);
  });
});
